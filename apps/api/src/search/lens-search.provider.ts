import { Injectable } from "@nestjs/common";

export const AYIN_LENS_EMBEDDING_PROVIDER = Symbol("AYIN_LENS_EMBEDDING_PROVIDER");

export type EmbeddingPurpose = "QUERY" | "CATALOG";

export interface EmbeddingProviderInfo {
  providerKey: string;
  model: string;
  modelVersion: string;
  dimensions: number;
}

export interface EmbeddingInput {
  key: string;
  text: string;
}

export interface EmbeddingOutput {
  key: string;
  values: number[];
}

export interface AyinLensEmbeddingProvider {
  isConfigured(): boolean;
  info(): EmbeddingProviderInfo;
  embed(inputs: readonly EmbeddingInput[], purpose: EmbeddingPurpose): Promise<EmbeddingOutput[]>;
}

@Injectable()
export class UnconfiguredAyinLensEmbeddingProvider implements AyinLensEmbeddingProvider {
  isConfigured() {
    return false;
  }

  info(): EmbeddingProviderInfo {
    return {
      providerKey: "unconfigured",
      model: "unconfigured",
      modelVersion: "unconfigured",
      dimensions: 0,
    };
  }

  async embed(): Promise<EmbeddingOutput[]> {
    throw new Error("AYIN Lens embedding provider is not configured.");
  }
}
