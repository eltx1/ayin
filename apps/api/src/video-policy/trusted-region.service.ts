import { timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { normalizeTerritoryCode } from "./country-codes.js";

export type HeaderBag = Record<string, string | string[] | undefined>;

@Injectable()
export class TrustedRegionService {
  countryFromHeaders(headers: HeaderBag): string | undefined {
    if (process.env.AYIN_TRUST_CLOUDFLARE_REGION === "true") {
      const cloudflare = normalizeTerritoryCode(firstHeader(headers["cf-ipcountry"]));
      if (cloudflare) return cloudflare;
    }

    const expectedToken = process.env.AYIN_INTERNAL_EDGE_TOKEN?.trim();
    const suppliedToken = firstHeader(headers["x-ayin-edge-token"]);
    if (!expectedToken || !suppliedToken || !safeTokenEqual(expectedToken, suppliedToken)) {
      return undefined;
    }
    return normalizeTerritoryCode(firstHeader(headers["x-ayin-edge-country"]));
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeTokenEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
