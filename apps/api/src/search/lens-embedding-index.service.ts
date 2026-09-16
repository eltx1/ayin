import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import {
  AYIN_LENS_EMBEDDING_PROVIDER,
  type AyinLensEmbeddingProvider,
  type EmbeddingProviderInfo,
} from "./lens-search.provider.js";
import {
  LensSemanticRuntimeConfig,
  type LensSemanticRuntimeConfigSnapshot,
} from "./lens-semantic-config.js";
import type { SearchCandidateType } from "./search-postgres.service.js";

const semanticTypes = new Set<SearchCandidateType>(["VIDEO", "MOVIE", "SERIES"]);

export interface LensSemanticCandidate {
  id: string;
  type: SearchCandidateType;
  slug: string | null;
  similarity: number;
}

interface PublicEmbeddingDocument {
  key: string;
  entityType: "VIDEO" | "MOVIE" | "SERIES";
  entityId: string;
  slug: string | null;
  text: string;
  contentHash: string;
  sourceUpdatedAt: Date;
}

@Injectable()
export class LensEmbeddingIndexService {
  private budgetWindowStartedAt = 0;
  private providerCallsInWindow = 0;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
    @Inject(AYIN_LENS_EMBEDDING_PROVIDER)
    private readonly provider: AyinLensEmbeddingProvider,
    @Inject(LensSemanticRuntimeConfig) private readonly runtimeConfig: LensSemanticRuntimeConfig,
  ) {}

  providerConfigured() {
    return this.provider.isConfigured();
  }

  providerInfo() {
    return this.provider.info();
  }

  async semanticCandidates(query: string): Promise<LensSemanticCandidate[]> {
    if (!this.provider.isConfigured()) return [];
    const config = this.runtimeConfig.snapshot();
    const info = this.assertProviderInfo(this.provider.info());
    await this.ensureWarmIndex(info, config);
    this.consumeProviderCalls(1, config.maxProviderCallsPerMinute);

    const output = await this.provider.embed(
      [{ key: "query", text: query.slice(0, config.maxEmbeddingTextChars) }],
      "QUERY",
    );
    const queryVector = output.find((item) => item.key === "query")?.values;
    if (!queryVector) throw new Error("Embedding provider omitted the query vector.");
    assertVector(queryVector, info.dimensions);

    const rows = await this.database.client.catalogSearchEmbedding.findMany({
      where: {
        providerKey: info.providerKey,
        model: info.model,
        modelVersion: info.modelVersion,
        dimensions: info.dimensions,
      },
      orderBy: [{ embeddedAt: "desc" }, { entityType: "asc" }, { entityId: "asc" }],
      take: config.maxVectorScan,
      select: {
        entityType: true,
        entityId: true,
        slug: true,
        embedding: true,
      },
    });

    return rows
      .flatMap<LensSemanticCandidate>((row) => {
        if (!semanticTypes.has(row.entityType as SearchCandidateType)) return [];
        if (!Array.isArray(row.embedding) || row.embedding.length !== info.dimensions) return [];
        const similarity = cosineSimilarity(queryVector, row.embedding);
        if (similarity < config.minSimilarity) return [];
        return [
          {
            id: row.entityId,
            type: row.entityType as SearchCandidateType,
            slug: row.slug,
            similarity,
          },
        ];
      })
      .toSorted(
        (a, b) =>
          b.similarity - a.similarity || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
      )
      .slice(0, config.maxSemanticCandidates);
  }

  async refreshPublicCatalog(requestedLimit?: number) {
    if (!this.provider.isConfigured()) {
      return { status: "UNCONFIGURED" as const, considered: 0, embedded: 0, cached: 0 };
    }
    const config = this.runtimeConfig.snapshot();
    const info = this.assertProviderInfo(this.provider.info());
    const limit = Math.min(
      Math.max(requestedLimit ?? config.maxRefreshItems, 1),
      config.maxRefreshItems,
    );
    const documents = await this.collectPublicDocuments(limit, config.maxEmbeddingTextChars);
    if (!documents.length)
      return { status: "READY" as const, considered: 0, embedded: 0, cached: 0 };

    const existing = await this.database.client.catalogSearchEmbedding.findMany({
      where: {
        providerKey: info.providerKey,
        model: info.model,
        modelVersion: info.modelVersion,
        OR: documents.map((document) => ({
          entityType: document.entityType,
          entityId: document.entityId,
        })),
      },
      select: { entityType: true, entityId: true, contentHash: true },
    });
    const cachedHash = new Map(
      existing.map((item) => [`${item.entityType}:${item.entityId}`, item.contentHash] as const),
    );
    const changed = documents.filter(
      (document) => cachedHash.get(`${document.entityType}:${document.entityId}`) !== document.contentHash,
    );

    let embedded = 0;
    for (let start = 0; start < changed.length; start += config.providerBatchSize) {
      const batch = changed.slice(start, start + config.providerBatchSize);
      this.consumeProviderCalls(1, config.maxProviderCallsPerMinute);
      const outputs = await this.provider.embed(
        batch.map((document) => ({ key: document.key, text: document.text })),
        "CATALOG",
      );
      const outputByKey = new Map(outputs.map((output) => [output.key, output.values] as const));
      for (const document of batch) {
        const vector = outputByKey.get(document.key);
        if (!vector) throw new Error(`Embedding provider omitted catalog vector ${document.key}.`);
        assertVector(vector, info.dimensions);
        await this.database.client.catalogSearchEmbedding.upsert({
          where: {
            entityType_entityId_providerKey_model_modelVersion: {
              entityType: document.entityType,
              entityId: document.entityId,
              providerKey: info.providerKey,
              model: info.model,
              modelVersion: info.modelVersion,
            },
          },
          update: {
            slug: document.slug,
            dimensions: info.dimensions,
            embedding: vector,
            contentHash: document.contentHash,
            sourceUpdatedAt: document.sourceUpdatedAt,
            embeddedAt: new Date(),
          },
          create: {
            entityType: document.entityType,
            entityId: document.entityId,
            slug: document.slug,
            providerKey: info.providerKey,
            model: info.model,
            modelVersion: info.modelVersion,
            dimensions: info.dimensions,
            embedding: vector,
            contentHash: document.contentHash,
            sourceUpdatedAt: document.sourceUpdatedAt,
          },
        });
        embedded += 1;
      }
    }

    return {
      status: "READY" as const,
      considered: documents.length,
      embedded,
      cached: documents.length - changed.length,
    };
  }

  private async ensureWarmIndex(
    info: EmbeddingProviderInfo,
    config: LensSemanticRuntimeConfigSnapshot,
  ) {
    const existing = await this.database.client.catalogSearchEmbedding.count({
      where: {
        providerKey: info.providerKey,
        model: info.model,
        modelVersion: info.modelVersion,
        dimensions: info.dimensions,
        embeddedAt: {
          gte: new Date(Date.now() - config.refreshStaleHours * 60 * 60 * 1000),
        },
      },
    });
    if (existing === 0) await this.refreshPublicCatalog(config.maxRefreshItems);
  }

  private async collectPublicDocuments(limit: number, maxTextChars: number) {
    const perType = Math.max(1, Math.ceil(limit / 3));
    const [videos, movies, series] = await Promise.all([
      this.database.client.video.findMany({
        where: {
          status: "PUBLISHED",
          visibility: "PUBLIC",
          removedAt: null,
          channel: { status: "ACTIVE", removedAt: null },
          mediaAssets: {
            some: {
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              removedAt: null,
              mimeType: "video/mp4",
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: perType,
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          updatedAt: true,
          channel: { select: { name: true } },
        },
      }),
      this.database.client.movie.findMany({
        where: { status: "PUBLISHED", primaryVideoId: { not: null } },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: perType,
        select: {
          id: true,
          slug: true,
          title: true,
          synopsis: true,
          originalLanguage: true,
          updatedAt: true,
          localizations: {
            orderBy: { locale: "asc" },
            take: 6,
            select: { locale: true, title: true, synopsis: true, shortDescription: true, updatedAt: true },
          },
          genres: {
            orderBy: { position: "asc" },
            take: 8,
            select: { genre: { select: { name: true } } },
          },
        },
      }),
      this.database.client.series.findMany({
        where: { status: "PUBLISHED" },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: perType,
        select: {
          id: true,
          slug: true,
          title: true,
          synopsis: true,
          originalLanguage: true,
          updatedAt: true,
          localizations: {
            orderBy: { locale: "asc" },
            take: 6,
            select: { locale: true, title: true, synopsis: true, shortDescription: true, updatedAt: true },
          },
          genres: {
            orderBy: { position: "asc" },
            take: 8,
            select: { genre: { select: { name: true } } },
          },
        },
      }),
    ]);

    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(
      videos.map((video) => video.id),
      {},
    );
    const allowedVideos = videos.filter((video) => allowedVideoIds.has(video.id));
    const metadata = allowedVideos.length
      ? await this.database.client.videoCreatorMetadata.findMany({
          where: { videoId: { in: allowedVideos.map((video) => video.id) } },
          select: { videoId: true, tags: true, category: true, primaryLanguage: true },
        })
      : [];
    const metadataByVideo = new Map(metadata.map((item) => [item.videoId, item] as const));

    const documents: PublicEmbeddingDocument[] = [];
    for (const video of allowedVideos) {
      const item = metadataByVideo.get(video.id);
      documents.push(
        publicDocument(
          "VIDEO",
          video.id,
          video.slug,
          [
            video.title,
            video.description,
            video.channel.name,
            item?.primaryLanguage,
            item?.category?.replaceAll("_", " "),
            ...(item?.tags ?? []),
          ],
          video.updatedAt,
          maxTextChars,
        ),
      );
    }
    for (const movie of movies) {
      documents.push(
        publicDocument(
          "MOVIE",
          movie.id,
          movie.slug,
          [
            movie.title,
            movie.synopsis,
            movie.originalLanguage,
            ...movie.genres.map((item) => item.genre.name),
            ...movie.localizations.flatMap((item) => [
              item.locale,
              item.title,
              item.synopsis,
              item.shortDescription,
            ]),
          ],
          maxDate(movie.updatedAt, movie.localizations.map((item) => item.updatedAt)),
          maxTextChars,
        ),
      );
    }
    for (const item of series) {
      documents.push(
        publicDocument(
          "SERIES",
          item.id,
          item.slug,
          [
            item.title,
            item.synopsis,
            item.originalLanguage,
            ...item.genres.map((genre) => genre.genre.name),
            ...item.localizations.flatMap((localized) => [
              localized.locale,
              localized.title,
              localized.synopsis,
              localized.shortDescription,
            ]),
          ],
          maxDate(item.updatedAt, item.localizations.map((localized) => localized.updatedAt)),
          maxTextChars,
        ),
      );
    }
    return documents.slice(0, limit);
  }

  private assertProviderInfo(info: EmbeddingProviderInfo) {
    if (
      !info.providerKey.trim() ||
      !info.model.trim() ||
      !info.modelVersion.trim() ||
      !Number.isInteger(info.dimensions) ||
      info.dimensions <= 0 ||
      info.dimensions > 8192
    ) {
      throw new Error("Embedding provider metadata is invalid.");
    }
    return info;
  }

  private consumeProviderCalls(calls: number, maximum: number) {
    const now = Date.now();
    if (now - this.budgetWindowStartedAt >= 60_000) {
      this.budgetWindowStartedAt = now;
      this.providerCallsInWindow = 0;
    }
    if (this.providerCallsInWindow + calls > maximum) {
      throw new Error("AYIN Lens provider call budget exhausted for this minute.");
    }
    this.providerCallsInWindow += calls;
  }
}

function publicDocument(
  entityType: PublicEmbeddingDocument["entityType"],
  entityId: string,
  slug: string | null,
  fields: Array<string | null | undefined>,
  sourceUpdatedAt: Date,
  maxTextChars: number,
): PublicEmbeddingDocument {
  const text = fields
    .flatMap((field) => (field ? [field.normalize("NFKC").replaceAll(/\s+/g, " ").trim()] : []))
    .filter(Boolean)
    .join("\n")
    .slice(0, maxTextChars);
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    slug,
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    sourceUpdatedAt,
  };
}

function maxDate(base: Date, values: Date[]): Date {
  return values.reduce((latest, value) => (value > latest ? value : latest), base);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function assertVector(vector: readonly number[], dimensions: number) {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding provider returned an invalid vector.");
  }
}
