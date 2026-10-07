import { AccountScopeError } from "./account-scope";
import type { AyinIdentity } from "./api";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountScopeError(0, "INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new AccountScopeError(0, "INVALID_RESPONSE");
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!uuid.test(result)) throw new AccountScopeError(0, "INVALID_RESPONSE");
  return result.toLowerCase();
}
function slug(value: unknown): string {
  const result = text(value, 128);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(result)) throw new AccountScopeError(0, "INVALID_RESPONSE");
  return result;
}
function channelHandle(value: unknown): string {
  const result = text(value, 80);
  // Match ChannelService's public handle contract. Channel handles may contain
  // Unicode letters/numbers and interior dots; profile/TV slugs remain distinct.
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}._-]{0,78}[\p{L}\p{N}])?$/u.test(result))
    throw new AccountScopeError(0, "INVALID_RESPONSE");
  return result;
}
export function parseAccountIdentity(value: unknown): AyinIdentity {
  const raw = record(value),
    account = record(raw.account),
    channel = record(raw.channel),
    profile = record(raw.profile),
    creatorTv = record(raw.creatorTv);
  return {
    account: {
      id: id(account.id),
      displayName: text(account.displayName),
      email: text(account.email, 320),
    },
    channel: {
      id: id(channel.id),
      handle: channelHandle(channel.handle),
      name: text(channel.name),
    },
    profile: { id: id(profile.id), name: text(profile.name), slug: slug(profile.slug) },
    creatorTv: { id: id(creatorTv.id), name: text(creatorTv.name), slug: slug(creatorTv.slug) },
  };
}
