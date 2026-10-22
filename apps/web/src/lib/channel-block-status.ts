import { requestAccountScope } from "./account-scope";

/** Account-wide safety check, including Kids surfaces, without reading social state. */
export async function readChannelBlockStatus(channelId: string, signal: AbortSignal) {
  const result = await requestAccountScope(
    "/user-blocks/channels/" + channelId,
    "GET",
    (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        !("accountId" in value) ||
        typeof value.accountId !== "string" ||
        !("channelId" in value) ||
        value.channelId !== channelId ||
        !("blocked" in value) ||
        typeof value.blocked !== "boolean"
      )
        throw new Error("INVALID_CHANNEL_BLOCK_STATUS");
      return { accountId: value.accountId, blocked: value.blocked };
    },
    { signal, maxResponseBytes: 4096 },
  );
  if (result.accountId !== result.value.accountId) throw new Error("ACCOUNT_CHANGED");
  return result.value.blocked;
}
