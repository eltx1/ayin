export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: number | null;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNotificationItem(value: unknown): value is NotificationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.type === "string" &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    (item.body === null || typeof item.body === "string") &&
    (item.readAt === null || isDateString(item.readAt)) &&
    isDateString(item.createdAt)
  );
}

export function parseNotificationPage(value: unknown): NotificationPage {
  if (!value || typeof value !== "object") throw new Error("INVALID_NOTIFICATIONS");
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page.items) ||
    page.items.length > 50 ||
    !page.items.every(isNotificationItem)
  ) {
    throw new Error("INVALID_NOTIFICATIONS");
  }
  const nextCursor = page.nextCursor;
  if (
    nextCursor !== null &&
    (typeof nextCursor !== "number" || !Number.isInteger(nextCursor) || nextCursor < 0)
  ) {
    throw new Error("INVALID_NOTIFICATIONS");
  }
  return { items: page.items, nextCursor: nextCursor as number | null };
}

export function mergeNotificationPages(
  current: readonly NotificationItem[],
  incoming: readonly NotificationItem[],
): NotificationItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

export function notificationTypeKey(type: string) {
  switch (type) {
    case "SYSTEM":
      return "notifications.typeSystem" as const;
    case "CHANNEL":
      return "notifications.typeChannel" as const;
    case "VIDEO":
      return "notifications.typeVideo" as const;
    case "COMMENT":
      return "notifications.typeComment" as const;
    case "SUBSCRIPTION":
      return "notifications.typeSubscription" as const;
    case "MODERATION":
      return "notifications.typeModeration" as const;
    case "MONETIZATION":
      return "notifications.typeMonetization" as const;
    default:
      return "notifications.typeOther" as const;
  }
}
