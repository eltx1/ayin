import { describe, expect, it } from "vitest";
import { fcmPayload, fcmResultFromResponse } from "./fcm-http-v1.service.js";

describe("FCM HTTP v1 delivery", () => {
  it("invalidates only explicit unregistered token errors", () => {
    expect(fcmResultFromResponse(404, { error: { status: "NOT_FOUND" } }).invalidToken).toBe(false);
    expect(fcmResultFromResponse(400, { error: { status: "INVALID_ARGUMENT" } }).invalidToken).toBe(
      false,
    );
    expect(
      fcmResultFromResponse(403, {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "SENDER_ID_MISMATCH",
            },
          ],
        },
      }).invalidToken,
    ).toBe(false);
    expect(
      fcmResultFromResponse(404, {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      }).invalidToken,
    ).toBe(true);
  });
  it("does not log or return provider message text and requires acceptance evidence", () => {
    expect(fcmResultFromResponse(200, {})).toEqual({
      accepted: false,
      code: "HTTP_200",
      invalidToken: false,
    });
    expect(fcmResultFromResponse(400, { error: { status: "bad secret token message" } }).code).toBe(
      "PROVIDER_ERROR",
    );
    expect(fcmResultFromResponse(200, { name: "projects/test/messages/123" }).accepted).toBe(true);
  });
  it("uses data-only Android and bounded APNs alerts with no silent push promise", () => {
    const input = {
      token: "test-address",
      platform: "android",
      notificationId: "notice-id",
      accountId: "recipient-id",
      type: "system",
      title: "AYIN",
      body: "You have a new notification.",
    };
    const android = fcmPayload(input).message;
    expect(android).not.toHaveProperty("notification");
    expect(android).toHaveProperty("data.recipientAccountId", "recipient-id");
    expect(android).toHaveProperty("android.ttl", "3600s");
    const ios = fcmPayload({ ...input, platform: "ios" }).message;
    expect(ios).toHaveProperty("apns.headers.apns-push-type", "alert");
    expect(ios).not.toHaveProperty("apns.payload.aps.content-available");
    expect(ios).not.toHaveProperty("apns.payload.aps.mutable-content");
  });
});
