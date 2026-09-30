import { describe, expect, it } from "vitest";

import {
  mergeNotificationPages,
  notificationTypeKey,
  parseNotificationPage,
} from "./notifications";

const item = {
  id: "notification-one",
  type: "SYSTEM",
  title: "A real update",
  body: null,
  readAt: null,
  createdAt: "2026-09-30T12:00:00.000Z",
};

describe("notification client contracts", () => {
  it("parses bounded pages without turning malformed data into an empty state", () => {
    expect(parseNotificationPage({ items: [item], nextCursor: 20 })).toEqual({
      items: [item],
      nextCursor: 20,
    });
    for (const invalid of [
      null,
      {},
      { items: "not-an-array", nextCursor: null },
      { items: [{ ...item, createdAt: "invalid" }], nextCursor: null },
      { items: [item], nextCursor: -1 },
    ]) {
      expect(() => parseNotificationPage(invalid)).toThrow("INVALID_NOTIFICATIONS");
    }
  });

  it("deduplicates paged results without reordering existing notifications", () => {
    const next = { ...item, id: "notification-two", title: "Second" };
    expect(mergeNotificationPages([item], [item, next]).map((entry) => entry.id)).toEqual([
      "notification-one",
      "notification-two",
    ]);
  });

  it("maps known and future notification types to human-facing labels", () => {
    expect(notificationTypeKey("SUBSCRIPTION")).toBe("notifications.typeSubscription");
    expect(notificationTypeKey("FUTURE_TYPE")).toBe("notifications.typeOther");
  });
});
