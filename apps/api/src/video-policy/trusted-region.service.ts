import { timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { normalizeTerritoryCode } from "./country-codes.js";

export type HeaderBag = Record<string, string | string[] | undefined>;

@Injectable()
export class TrustedRegionService {
  countryFromHeaders(headers: HeaderBag): string | undefined {
    // Presence, even malformed/empty, identifies a server hop. Never reinterpret
    // unknown visitor context as the server's Cloudflare egress country.
    const has = (name: string) => Object.hasOwn(headers, name);
    if (has("x-ayin-edge-context") || has("x-ayin-edge-token") || has("x-ayin-edge-country")) {
      if (has("x-ayin-edge-context") && singleHeader(headers["x-ayin-edge-context"]) !== "server") {
        return undefined;
      }
      const expectedToken = process.env.AYIN_INTERNAL_EDGE_TOKEN?.trim();
      const suppliedToken = singleHeader(headers["x-ayin-edge-token"]);
      if (!expectedToken || !suppliedToken || !safeTokenEqual(expectedToken, suppliedToken)) {
        return undefined;
      }
      return normalizeTerritoryCode(singleHeader(headers["x-ayin-edge-country"]));
    }

    if (process.env.AYIN_TRUST_CLOUDFLARE_REGION === "true") {
      return normalizeTerritoryCode(singleHeader(headers["cf-ipcountry"]));
    }
    return undefined;
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  // Node/proxies may expose duplicates as arrays or comma-joined strings.
  return typeof value === "string" && !value.includes(",") ? value : undefined;
}

function safeTokenEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
