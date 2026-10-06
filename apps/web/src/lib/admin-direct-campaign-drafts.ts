import type { CampaignInput, DirectCampaignInput } from "./admin-advertising";
import type {
  AdvertiserRecord,
  CampaignRecord,
  DirectCommand,
  DirectKind,
} from "./admin-direct-campaign-workspace";
import type {
  AdvertiserDraft,
  CampaignDraft,
} from "@/components/admin/admin-direct-campaign-fields";

export type DirectEditor =
  | { kind: "advertiser"; original: AdvertiserRecord | null; draft: AdvertiserDraft }
  | { kind: "campaign"; original: CampaignRecord | null; draft: CampaignDraft };
export const newAdvertiserDraft = (): AdvertiserDraft => ({ name: "", status: "ACTIVE" });
export const newCampaignDraft = (): CampaignDraft => ({
  advertiserId: "",
  name: "",
  status: "DRAFT",
  startsAt: "",
  endsAt: "",
  budget: "",
  currency: "USD",
  pricingModel: "CPM",
  rate: "1.000000",
  priority: "100",
  impressionGoal: "",
  frequencyCap: "3",
  pacing: "EVEN",
  placementKeys: "",
  countries: "",
  regions: "",
  categories: "",
  devices: [],
  channelIds: [],
  videoIds: [],
});
function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}
export function campaignDraft(record: CampaignRecord): CampaignDraft {
  const d = record.direct,
    t = d?.targeting;
  return {
    ...newCampaignDraft(),
    advertiserId: record.advertiserId,
    name: record.name,
    status: record.status,
    startsAt: localDateTime(record.startsAt),
    endsAt: localDateTime(record.endsAt),
    budget: record.budget ?? "",
    currency: record.currency ?? "",
    pricingModel: d?.pricing.model ?? "CPM",
    rate: d ? (d.pricing.model === "CPM" ? d.pricing.cpm : d.pricing.fixedPrice) : "1.000000",
    priority: String(d?.priority ?? 100),
    impressionGoal: d?.impressionGoal == null ? "" : String(d.impressionGoal),
    frequencyCap: String(d?.frequencyCap ?? 3),
    pacing: d?.pacing ?? "EVEN",
    placementKeys: t?.placementKeys?.join(", ") ?? "",
    countries: t?.countries?.join(", ") ?? "",
    regions: t?.regions?.join(", ") ?? "",
    categories: t?.categories?.join(", ") ?? "",
    devices: [...(t?.devices ?? [])],
    channelIds: [...(t?.channelIds ?? [])],
    videoIds: [...(t?.videoIds ?? [])],
  };
}
export function editorDraft(
  kind: DirectKind,
  record?: AdvertiserRecord | CampaignRecord,
): DirectEditor {
  if (kind === "advertiser") {
    const original = record as AdvertiserRecord | undefined;
    return {
      kind,
      original: original ?? null,
      draft: original ? { name: original.name, status: original.status } : newAdvertiserDraft(),
    };
  }
  const original = record as CampaignRecord | undefined;
  return {
    kind,
    original: original ?? null,
    draft: original ? campaignDraft(original) : newCampaignDraft(),
  };
}
export const draftSignature = (editor: DirectEditor) => JSON.stringify(editor.draft);
export function editorDirty(editor: DirectEditor | null) {
  return (
    !!editor &&
    draftSignature(editor) !==
      draftSignature(editorDraft(editor.kind, editor.original ?? undefined))
  );
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function list(value: string, upper = false) {
  return [
    ...new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (upper ? v.toUpperCase() : v)),
    ),
  ];
}
function integer(value: string, min: number, max: number) {
  if (!/^\d+$/.test(value)) throw Error("INVALID_INPUT");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error("INVALID_INPUT");
  return n;
}
function money(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed) || trimmed.length > 40) throw Error("INVALID_INPUT");
  return trimmed;
}
function iso(value: string) {
  if (!value) return null;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw Error("INVALID_INPUT");
  return time.toISOString();
}
export function campaignValues(
  draft: CampaignDraft,
  original: CampaignRecord | null,
): Partial<CampaignInput> {
  const base = original ? campaignDraft(original) : null;
  const result: Partial<CampaignInput> = {};
  for (const key of ["name", "status", "startsAt", "endsAt", "budget", "currency"] as const) {
    if (base && draft[key] === base[key]) continue;
    if (key === "name") {
      const name = draft.name.trim();
      if (name.length < 2 || name.length > 160) throw Error("INVALID_INPUT");
      result.name = name;
    } else if (key === "status") result.status = draft.status;
    else if (key === "startsAt" || key === "endsAt") result[key] = iso(draft[key]);
    else if (key === "budget") result.budget = draft.budget.trim() ? money(draft.budget) : null;
    else {
      result.currency = draft.currency.trim().toUpperCase() || null;
      if (result.currency !== null && result.currency.length !== 3) throw Error("INVALID_INPUT");
    }
  }
  const starts = result.startsAt !== undefined ? result.startsAt : original?.startsAt;
  const ends = result.endsAt !== undefined ? result.endsAt : original?.endsAt;
  if (starts && ends && Date.parse(ends) <= Date.parse(starts)) throw Error("INVALID_INPUT");
  const directKeys = [
    "pricingModel",
    "rate",
    "priority",
    "impressionGoal",
    "frequencyCap",
    "pacing",
    "placementKeys",
    "countries",
    "regions",
    "categories",
    "devices",
    "channelIds",
    "videoIds",
  ] as const;
  if (!base || directKeys.some((key) => !same(draft[key], base[key]))) {
    const old = original?.direct;
    const changed = (key: (typeof directKeys)[number]) => !base || !same(draft[key], base[key]);
    const t = old?.targeting;
    const targeting = {
      placementKeys:
        !changed("placementKeys") && t?.placementKeys ? t.placementKeys : list(draft.placementKeys),
      countries: !changed("countries") && t?.countries ? t.countries : list(draft.countries, true),
      regions: !changed("regions") && t?.regions ? t.regions : list(draft.regions),
      categories: !changed("categories") && t?.categories ? t.categories : list(draft.categories),
      devices: draft.devices,
      channelIds: draft.channelIds,
      videoIds: draft.videoIds,
    };
    if (targeting.countries.some((v) => v.length !== 2)) throw Error("INVALID_INPUT");
    const direct: DirectCampaignInput = {
      priority: changed("priority") || !old ? integer(draft.priority, 1, 1000) : old.priority,
      pricing:
        !changed("pricingModel") && !changed("rate") && old
          ? old.pricing
          : draft.pricingModel === "CPM"
            ? { model: "CPM", cpm: money(draft.rate), fixedPrice: null }
            : { model: "FIXED", cpm: null, fixedPrice: money(draft.rate) },
      impressionGoal:
        changed("impressionGoal") || !old
          ? draft.impressionGoal.trim()
            ? integer(draft.impressionGoal, 1, Number.MAX_SAFE_INTEGER)
            : null
          : old.impressionGoal,
      frequencyCap:
        changed("frequencyCap") || !old ? integer(draft.frequencyCap, 0, 100) : old.frequencyCap,
      pacing: draft.pacing,
      targeting,
    };
    result.direct = direct;
  }
  return result;
}
export function editorCommand(
  editor: DirectEditor,
  mutationId: string,
  advertisers: AdvertiserRecord[],
  action: "create" | "update" | "delete",
): DirectCommand {
  let values: Record<string, unknown> = {};
  if (action !== "delete") {
    if (editor.kind === "advertiser") {
      const name = editor.draft.name.trim();
      if (name.length < 2 || name.length > 160) throw Error("INVALID_INPUT");
      values = { name, status: editor.draft.status };
    } else {
      values = { ...campaignValues(editor.draft, editor.original) };
      if (action === "create") {
        const parent = advertisers.find((r) => r.id === editor.draft.advertiserId);
        if (!parent) throw Error("INVALID_INPUT");
        values.advertiserId = parent.id;
        values.expectedAdvertiserUpdatedAt = parent.updatedAt;
      }
    }
  }
  return { mutationId, kind: editor.kind, action, original: editor.original, values };
}
// A background/manual read updates clean editors only. Dirty or uncertain
// intent keeps its original version so it cannot silently overwrite newer data.
export function reconcileDirectEditor(
  editor: DirectEditor | null,
  advertisers: AdvertiserRecord[],
  campaigns: CampaignRecord[],
  locked = false,
) {
  if (!editor?.original || locked || editorDirty(editor)) return editor;
  const latest = (editor.kind === "advertiser" ? advertisers : campaigns).find(
    (r) => r.id === editor.original?.id,
  );
  return latest ? editorDraft(editor.kind, latest) : editor;
}
