import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { z } from "zod";

const credentialsSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
  client_email: z.email(),
  private_key: z.string().min(100),
});
const tokenSchema = z.object({
  access_token: z.string().min(20),
  expires_in: z.number().min(1).max(3600),
});
export interface FcmMessage {
  token: string;
  platform: string;
  notificationId: string;
  accountId: string;
  type: string;
  title: string;
  body: string;
}
export interface FcmResult {
  accepted: boolean;
  code: string;
  invalidToken: boolean;
  messageId?: string;
}

export function fcmResultFromResponse(status: number, raw: unknown): FcmResult {
  const value = raw as {
    name?: unknown;
    error?: { status?: unknown; details?: Array<{ "@type"?: unknown; errorCode?: unknown }> };
  } | null;
  if (status >= 200 && status < 300 && typeof value?.name === "string")
    return {
      accepted: true,
      code: "ACCEPTED",
      invalidToken: false,
      messageId: value.name.slice(0, 240),
    };
  const detail = value?.error?.details?.find(
    (item) => item["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError",
  );
  const code =
    typeof detail?.errorCode === "string"
      ? detail.errorCode
      : typeof value?.error?.status === "string"
        ? value.error.status
        : `HTTP_${status}`;
  // Only an explicit FCM UNREGISTERED diagnosis revokes a token. Generic 404,
  // INVALID_ARGUMENT and project/auth errors must not destroy good registrations.
  return {
    accepted: false,
    code: /^[A-Z0-9_]{1,80}$/.test(code) ? code : "PROVIDER_ERROR",
    invalidToken: detail?.errorCode === "UNREGISTERED",
  };
}
export function fcmPayload(message: FcmMessage) {
  const data = {
    notificationId: message.notificationId,
    recipientAccountId: message.accountId,
    type: message.type,
    title: message.title,
    body: message.body,
  };
  return {
    message: {
      token: message.token,
      data,
      ...(message.platform === "ios"
        ? {
            apns: {
              headers: {
                "apns-push-type": "alert",
                "apns-priority": "10",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
              },
              payload: {
                aps: {
                  alert: { title: message.title, body: message.body },
                  sound: "default",
                  "thread-id": "ayin_updates",
                },
              },
            },
          }
        : { android: { priority: "HIGH", ttl: "3600s", collapse_key: message.notificationId } }),
    },
  };
}
@Injectable()
export class FcmHttpV1Service {
  private cached: { token: string; projectId: string; expiresAt: number } | null = null;
  private refresh: Promise<{ token: string; projectId: string; expiresAt: number }> | null = null;
  isConfigured() {
    return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FCM_PROJECT_ID);
  }
  async send(message: FcmMessage): Promise<FcmResult> {
    if (!this.isConfigured())
      return { accepted: false, code: "FCM_NOT_CONFIGURED", invalidToken: false };
    try {
      const auth = await this.accessToken();
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
          body: JSON.stringify(fcmPayload(message)),
          signal: AbortSignal.timeout(10000),
        },
      );
      return fcmResultFromResponse(response.status, await response.json().catch(() => null));
    } catch {
      // Do not log exception messages: provider payloads and file errors may include secrets.
      // Do not retry an ambiguous timeout; provider acceptance may already have occurred.
      return { accepted: false, code: "FCM_TRANSPORT_OR_CREDENTIALS_ERROR", invalidToken: false };
    }
  }
  private async accessToken() {
    if (this.cached && this.cached.expiresAt > Date.now() + 60000) return this.cached;
    if (!this.refresh)
      this.refresh = this.refreshToken().finally(() => {
        this.refresh = null;
      });
    return this.refresh;
  }
  private async refreshToken() {
    const credentials = credentialsSchema.parse(
      JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8")),
    );
    const projectId = process.env.FCM_PROJECT_ID!;
    if (projectId !== credentials.project_id)
      throw new Error("FCM project does not match credentials.");
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(credentials.private_key)
      .toString("base64url");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("FCM OAuth authorization failed.");
    const result = tokenSchema.parse(await response.json());
    this.cached = {
      token: result.access_token,
      projectId,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    return this.cached;
  }
}
