import { Injectable } from "@nestjs/common";

import { MediaUploadError } from "./media-upload.service.js";

interface Counter {
  count: number;
  resetAt: number;
}

// A 5 GiB source has at most 1,024 parts at the minimum 5 MiB part size.
// Keep grants bounded independently of low-volume create/complete/cancel work.
export const UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE = 1_200;
export const UPLOAD_RECOVERY_READS_PER_MINUTE = 600;

@Injectable()
export class UploadRateLimiter {
  private readonly counters = new Map<string, Counter>();

  consume(key: string, limit = process.env.APP_ENV === "test" ? 1_000 : 12): void {
    const now = Date.now();
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    if (current.count >= limit) {
      throw new MediaUploadError(
        "UPLOAD_RATE_LIMITED",
        "Too many upload requests. Try again shortly.",
        429,
      );
    }
    current.count += 1;
  }
}
