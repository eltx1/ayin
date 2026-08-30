import { Injectable } from "@nestjs/common";

import { MediaUploadError } from "./media-upload.service.js";

interface Counter {
  count: number;
  resetAt: number;
}

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
