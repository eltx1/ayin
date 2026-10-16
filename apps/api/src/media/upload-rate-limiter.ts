import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { BoundedRateCounter } from "../security/bounded-rate-counter.js";
import { MediaUploadError } from "./media-upload-error.js";

// Signing and recovery polling scale with file parts, not with new upload sessions.
// Separate cancellation capacity remains available even after a signing burst.
export const UPLOAD_REQUEST_LIMITS = {
  authorization: 600,
  control: 60,
  cancellation: 60,
  outcome: 120,
  inspection: 60,
} as const;

@Injectable()
export class UploadRateLimiter implements OnModuleDestroy {
  private readonly counters = new BoundedRateCounter({ windowMs: 60_000 });

  consume(key: string, limit = process.env.APP_ENV === "test" ? 1_000 : 12): void {
    if (!this.counters.consume(key, limit)) {
      throw new MediaUploadError(
        "UPLOAD_RATE_LIMITED",
        "Too many upload requests. Try again shortly.",
        429,
      );
    }
  }

  onModuleDestroy(): void {
    this.counters.destroy();
  }
}
