import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { GamProductionService } from "./gam-production.service.js";

export type AuthorizedSellerFileKind = "ads" | "app-ads";

const maxFileLength = 64 * 1024;
const maxLineLength = 1024;
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const sellerIdPattern = /^[^\s,]{1,160}$/u;
const certificationIdPattern = /^[a-z0-9_-]{1,160}$/iu;
const variableNamePattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const forbiddenPlaceholderPattern = /(?:<[^>]+>|REPLACE[_ -]?ME|YOUR[_ -]?(?:ID|PUBLISHER|SELLER)|example\.com|placeholder)/iu;

const storageKey: Record<AuthorizedSellerFileKind, string> = {
  ads: "adsTxtManualContent",
  "app-ads": "appAdsTxtManualContent",
};

export interface AuthorizedSellerFileSnapshot {
  kind: AuthorizedSellerFileKind;
  manualText: string;
  automaticRows: string[];
  finalText: string;
}

@Injectable()
export class AuthorizedSellerFileService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(GamProductionService) private readonly gam: GamProductionService,
  ) {}

  async snapshot(kind: AuthorizedSellerFileKind): Promise<AuthorizedSellerFileSnapshot> {
    const manualText = await this.readManual(kind);
    const automaticRows = this.gam.authorizedSellerRows();
    return {
      kind,
      manualText,
      automaticRows,
      finalText: this.render(manualText, automaticRows),
    };
  }

  async snapshots() {
    const [ads, appAds] = await Promise.all([this.snapshot("ads"), this.snapshot("app-ads")]);
    return { ads, appAds };
  }

  async update(
    actorAccountId: string,
    kind: AuthorizedSellerFileKind,
    inputText: string,
    reason: string,
  ): Promise<AuthorizedSellerFileSnapshot> {
    const normalized = validateAuthorizedSellerText(inputText);
    await this.database.client.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: {
          namespace_key: {
            namespace: "ADVERTISING",
            key: storageKey[kind],
          },
        },
        update: {
          value: normalized,
          valueType: "STRING",
          schemaVersion: 1,
          description: `${kind}.txt manually managed authorized seller content`,
        },
        create: {
          namespace: "ADVERTISING",
          key: storageKey[kind],
          value: normalized,
          valueType: "STRING",
          schemaVersion: 1,
          description: `${kind}.txt manually managed authorized seller content`,
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "AUTHORIZED_SELLER_FILE_UPDATED",
        entityType: "AuthorizedSellerFile",
        entityId: kind,
        reason,
        metadata: {
          kind,
          manualLineCount: normalized ? normalized.split("\n").length : 0,
          manualByteLength: Buffer.byteLength(normalized, "utf8"),
        } as Prisma.InputJsonObject,
      });
    });
    return this.snapshot(kind);
  }

  private async readManual(kind: AuthorizedSellerFileKind): Promise<string> {
    const row = await this.database.client.platformSetting.findUnique({
      where: {
        namespace_key: {
          namespace: "ADVERTISING",
          key: storageKey[kind],
        },
      },
      select: { schemaVersion: true, value: true, valueType: true },
    });
    if (!row || row.schemaVersion !== 1 || row.valueType !== "STRING") return "";
    return typeof row.value === "string" ? row.value : "";
  }

  private render(manualText: string, automaticRows: string[]): string {
    const manualLines = manualText ? manualText.split("\n") : [];
    const seen = new Set(
      manualLines
        .map((line) => canonicalSellerRecord(line))
        .filter((line): line is string => Boolean(line)),
    );
    const additions = automaticRows.filter((row) => {
      const canonical = canonicalSellerRecord(row);
      return !canonical || !seen.has(canonical);
    });

    const sections: string[] = [];
    if (manualText.trim()) sections.push(manualText.trim());
    if (additions.length > 0) {
      sections.push(["# Automatically generated from AYIN's configured Google seller account", ...additions].join("\n"));
    }
    return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
  }
}

export function validateAuthorizedSellerText(raw: string): string {
  const normalized = raw.replace(/\r\n?/gu, "\n").trim();
  if (Buffer.byteLength(normalized, "utf8") > maxFileLength) {
    throw new Error("Authorized seller file is too large.");
  }
  if (!normalized) return "";

  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    if (rawLine.length > maxLineLength) {
      throw new Error(`Line ${index + 1} exceeds ${maxLineLength} characters.`);
    }
    validateLine(rawLine, index + 1);
  }
  return lines.map((line) => line.trimEnd()).join("\n");
}

function validateLine(rawLine: string, lineNumber: number) {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  if (forbiddenPlaceholderPattern.test(trimmed)) {
    throw new Error(`Line ${lineNumber} contains a placeholder and cannot be published.`);
  }

  const statement = stripInlineComment(trimmed).trim();
  if (!statement) return;

  const equalsIndex = statement.indexOf("=");
  if (equalsIndex > 0 && !statement.slice(0, equalsIndex).includes(",")) {
    validateVariable(statement, lineNumber);
    return;
  }

  const fields = statement.split(",").map((value) => value.trim());
  if (fields.length !== 3 && fields.length !== 4) {
    throw new Error(`Line ${lineNumber} must contain 3 or 4 comma-separated seller fields.`);
  }
  const [domain, sellerId, relationship, certificationId] = fields;
  if (!domain || !domainPattern.test(domain)) {
    throw new Error(`Line ${lineNumber} has an invalid advertising-system domain.`);
  }
  if (!sellerId || !sellerIdPattern.test(sellerId)) {
    throw new Error(`Line ${lineNumber} has an invalid seller or publisher identifier.`);
  }
  if (relationship?.toUpperCase() !== "DIRECT" && relationship?.toUpperCase() !== "RESELLER") {
    throw new Error(`Line ${lineNumber} relationship must be DIRECT or RESELLER.`);
  }
  if (certificationId && !certificationIdPattern.test(certificationId)) {
    throw new Error(`Line ${lineNumber} has an invalid certification-authority identifier.`);
  }
}

function validateVariable(statement: string, lineNumber: number) {
  const equalsIndex = statement.indexOf("=");
  const key = statement.slice(0, equalsIndex).trim().toUpperCase();
  const value = statement.slice(equalsIndex + 1).trim();
  if (!variableNamePattern.test(key) || !value || value.length > 512) {
    throw new Error(`Line ${lineNumber} has an invalid ads.txt variable declaration.`);
  }

  if (["OWNERDOMAIN", "SUBDOMAIN", "INVENTORYPARTNERDOMAIN"].includes(key)) {
    if (!domainPattern.test(value.toLowerCase())) {
      throw new Error(`Line ${lineNumber} ${key} must contain a valid domain.`);
    }
  }

  if (key === "MANAGERDOMAIN") {
    const [domain, country, ...extra] = value.split(",").map((part) => part.trim());
    if (!domain || !domainPattern.test(domain.toLowerCase()) || extra.length > 0) {
      throw new Error(`Line ${lineNumber} MANAGERDOMAIN has invalid syntax.`);
    }
    if (country && !/^[A-Z]{2}$/u.test(country.toUpperCase())) {
      throw new Error(`Line ${lineNumber} MANAGERDOMAIN country must be a two-letter code.`);
    }
  }
}

function stripInlineComment(line: string) {
  const commentIndex = line.indexOf("#");
  return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
}

function canonicalSellerRecord(rawLine: string): string | null {
  const statement = stripInlineComment(rawLine).trim();
  if (!statement || statement.includes("=")) return null;
  const fields = statement.split(",").map((field) => field.trim());
  if (fields.length !== 3 && fields.length !== 4) return null;
  return [
    fields[0]?.toLowerCase(),
    fields[1],
    fields[2]?.toUpperCase(),
    fields[3]?.toLowerCase() ?? "",
  ].join("|");
}
