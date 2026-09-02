"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  createAdPlacement,
  createAdvertiser,
  createCampaign,
  createCreative,
  deleteAdvertiser,
  deleteCampaign,
  deleteCreative,
  getAdvertisers,
  getAdvertisingOverview,
  getCampaigns,
  getCreatives,
  getGamDiagnostics,
  getPageAdSettings,
  getSellerFiles,
  saveSellerFile,
  setAdvertisingKillSwitch,
  updateAdPlacement,
  updateAdvertiser,
  updateCampaign,
  updateCreative,
  updatePageAdSettings,
  type AdDevice,
  type AdPlacement,
  type Advertiser,
  type AdvertiserStatus,
  type Campaign,
  type CampaignInput,
  type CampaignStatus,
  type Creative,
  type CreativeInput,
  type CreativeStatus,
  type CreativeType,
  type GamDiagnostics,
  type PageAdSettings,
  type SellerFiles,
} from "@/lib/admin-advertising";
import {
  searchAdminAdvertisingTargets,
  type AdminAdvertisingChannelTarget,
  type AdminAdvertisingVideoTarget,
} from "@/lib/admin-operations-directory";

type Overview = Awaited<ReturnType<typeof getAdvertisingOverview>>;

type CampaignDraft = {
  name: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  budget: string;
  currency: string;
  pricingModel: "CPM" | "FIXED";
  rate: string;
  priority: string;
  impressionGoal: string;
  frequencyCap: string;
  pacing: "EVEN" | "ASAP";
  placementKeys: string;
  countries: string;
  regions: string;
  categories: string;
  devices: AdDevice[];
  channelIds: string[];
  videoIds: string[];
};

const emptyCampaignDraft: CampaignDraft = {
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
};

function splitList(value: string, upper = false) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].map((item) =>
    upper ? item.toUpperCase() : item,
  );
}

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function draftFromCampaign(campaign: Campaign): CampaignDraft {
  const direct = campaign.direct;
  const pricing = direct?.pricing;
  const targeting = direct?.targeting ?? {};
  return {
    name: campaign.name,
    status: campaign.status,
    startsAt: localDateTime(campaign.startsAt),
    endsAt: localDateTime(campaign.endsAt),
    budget: campaign.budget ?? "",
    currency: campaign.currency ?? "USD",
    pricingModel: pricing?.model ?? "CPM",
    rate:
      pricing?.model === "FIXED"
        ? pricing.fixedPrice
        : pricing?.model === "CPM"
          ? pricing.cpm
          : "1.000000",
    priority: String(direct?.priority ?? 100),
    impressionGoal: direct?.impressionGoal === null || direct?.impressionGoal === undefined ? "" : String(direct.impressionGoal),
    frequencyCap: String(direct?.frequencyCap ?? 3),
    pacing: direct?.pacing ?? "EVEN",
    placementKeys: (targeting.placementKeys ?? []).join(", "),
    countries: (targeting.countries ?? []).join(", "),
    regions: (targeting.regions ?? []).join(", "),
    categories: (targeting.categories ?? []).join(", "),
    devices: targeting.devices ?? [],
    channelIds: targeting.channelIds ?? [],
    videoIds: targeting.videoIds ?? [],
  };
}

function campaignInput(draft: CampaignDraft): CampaignInput {
  const rate = draft.rate.trim();
  return {
    name: draft.name.trim(),
    status: draft.status,
    startsAt: isoOrNull(draft.startsAt),
    endsAt: isoOrNull(draft.endsAt),
    budget: draft.budget.trim() || null,
    currency: draft.currency.trim() ? draft.currency.trim().toUpperCase() : null,
    direct: {
      priority: Number(draft.priority),
      pricing:
        draft.pricingModel === "FIXED"
          ? { model: "FIXED", cpm: null, fixedPrice: rate }
          : { model: "CPM", cpm: rate, fixedPrice: null },
      impressionGoal: draft.impressionGoal.trim() ? Number(draft.impressionGoal) : null,
      frequencyCap: Number(draft.frequencyCap),
      pacing: draft.pacing,
      targeting: {
        placementKeys: splitList(draft.placementKeys),
        countries: splitList(draft.countries, true),
        regions: splitList(draft.regions),
        categories: splitList(draft.categories),
        devices: draft.devices,
        channelIds: draft.channelIds,
        videoIds: draft.videoIds,
      },
    },
  };
}

export function AdminAdvertisingControl() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [gam, setGam] = useState<GamDiagnostics | null>(null);
  const [pageAds, setPageAds] = useState<PageAdSettings | null>(null);
  const [sellerFiles, setSellerFiles] = useState<SellerFiles | null>(null);
  const [adsText, setAdsText] = useState("");
  const [appAdsText, setAppAdsText] = useState("");
  const [killReason, setKillReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextAdvertisers, nextCampaigns, nextCreatives, nextGam, nextPageAds, nextSellerFiles] =
        await Promise.all([
          getAdvertisingOverview(),
          getAdvertisers(),
          getCampaigns(),
          getCreatives(),
          getGamDiagnostics(),
          getPageAdSettings(),
          getSellerFiles(),
        ]);
      setOverview(nextOverview);
      setAdvertisers(nextAdvertisers);
      setCampaigns(nextCampaigns);
      setCreatives(nextCreatives);
      setGam(nextGam);
      setPageAds(nextPageAds);
      setSellerFiles(nextSellerFiles);
      setAdsText(nextSellerFiles.ads.manualText);
      setAppAdsText(nextSellerFiles.appAds.manualText);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Advertising control center could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Advertising change was not saved.");
    } finally {
      setBusy(false);
    }
  }

  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "ACTIVE").length;
  const activeCreatives = creatives.filter((creative) => creative.status === "ACTIVE").length;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>AYIN Advertising</span>
          <h1>Advertising Control Center</h1>
          <p className={styles.muted}>
            Operate demand, inventory, GAM readiness, page ads, direct campaigns, creatives, seller
            declarations and emergency controls without relying on raw API calls.
          </p>
        </div>
        <Link className={styles.button} href="/admin/video-ads">
          In-player video ads →
        </Link>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      <section className={styles.metrics} aria-label="Advertising summary">
        <article className={styles.metric}>
          <span className={styles.muted}>Master advertising</span>
          <strong>{overview?.emergencyKillSwitch ? "KILLED" : "READY"}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>GAM production</span>
          <strong>{gam?.readyForLiveRequests ? "LIVE READY" : gam?.testMode ? "TEST" : "NOT READY"}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Active campaigns</span>
          <strong>{activeCampaigns}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Active creatives</span>
          <strong>{activeCreatives}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Placements</span>
          <strong>{overview?.placements.length ?? 0}</strong>
        </article>
      </section>

      <section className={styles.commandGrid}>
        <article className={styles.card}>
          <h2>Emergency control</h2>
          <p className={styles.muted}>
            One audited switch stops or restores all advertising decisions across AYIN.
          </p>
          <textarea
            minLength={3}
            placeholder="Operator reason"
            value={killReason}
            onChange={(event) => setKillReason(event.target.value)}
          />
          <button
            className={overview?.emergencyKillSwitch ? styles.button : styles.danger}
            disabled={busy || killReason.trim().length < 3}
            type="button"
            onClick={() =>
              void act(
                () => setAdvertisingKillSwitch(!overview?.emergencyKillSwitch, killReason.trim()),
                overview?.emergencyKillSwitch ? "Advertising restored." : "Advertising emergency stop enabled.",
              ).then(() => setKillReason(""))
            }
          >
            {overview?.emergencyKillSwitch ? "Restore all advertising" : "Kill all advertising"}
          </button>
        </article>

        <article className={styles.card}>
          <h2>Google Ad Manager diagnostics</h2>
          {gam ? (
            <>
              <p>Configured: <strong>{gam.configured ? "Yes" : "No"}</strong></p>
              <p>Production enabled: <strong>{gam.productionEnabled ? "Yes" : "No"}</strong></p>
              <p>Test mode: <strong>{gam.testMode ? "Yes" : "No"}</strong></p>
              <p>Network: <strong>{gam.networkCode ?? "Not configured"}</strong></p>
              <p>Publisher: <strong>{gam.publisherId ?? "Not configured"}</strong></p>
              <p>Video ad unit: <strong>{gam.videoAdUnitConfigured ? "Configured" : "Missing"}</strong></p>
              <p>Display prefix: <strong>{gam.displayAdUnitPrefixConfigured ? "Configured" : "Missing"}</strong></p>
              <p>ads.txt seller row: <strong>{gam.adsTxtConfigured ? "Configured" : "Missing"}</strong></p>
              {gam.missing.length ? (
                <p className={styles.muted}>Missing production environment values: {gam.missing.join(", ")}</p>
              ) : null}
            </>
          ) : (
            <p className={styles.muted}>Loading GAM diagnostics…</p>
          )}
        </article>

        <article className={styles.card}>
          <h2>Ad event counters</h2>
          {Object.entries(overview?.eventCounters ?? {}).length ? (
            Object.entries(overview?.eventCounters ?? {}).map(([event, count]) => (
              <p key={event}>{event}: <strong>{count.toLocaleString()}</strong></p>
            ))
          ) : (
            <p className={styles.muted}>No recorded ad events yet.</p>
          )}
        </article>
      </section>

      {pageAds ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Outside-player page ads</h2>
              <p className={styles.muted}>
                Control GPT/house delivery globally. Individual page placements are managed in the
                Inventory section below.
              </p>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.check}>
              <input
                checked={pageAds.masterEnabled}
                type="checkbox"
                onChange={(event) => setPageAds({ ...pageAds, masterEnabled: event.target.checked })}
              />
              Page ads enabled
            </label>
            <label className={styles.check}>
              <input
                checked={pageAds.googleGptEnabled}
                type="checkbox"
                onChange={(event) => setPageAds({ ...pageAds, googleGptEnabled: event.target.checked })}
              />
              Google GPT enabled
            </label>
            <label>
              House image URL
              <input
                value={pageAds.house.imageUrl ?? ""}
                onChange={(event) =>
                  setPageAds({ ...pageAds, house: { ...pageAds.house, imageUrl: event.target.value || null } })
                }
              />
            </label>
            <label>
              House click URL
              <input
                value={pageAds.house.clickUrl ?? ""}
                onChange={(event) =>
                  setPageAds({ ...pageAds, house: { ...pageAds.house, clickUrl: event.target.value || null } })
                }
              />
            </label>
            <label className={styles.fullField}>
              House creative alt text
              <input
                value={pageAds.house.altText ?? ""}
                onChange={(event) =>
                  setPageAds({ ...pageAds, house: { ...pageAds.house, altText: event.target.value || null } })
                }
              />
            </label>
          </div>
          <button
            className={styles.button}
            disabled={busy}
            type="button"
            onClick={() => void act(() => updatePageAdSettings(pageAds), "Page advertising defaults updated.")}
          >
            Save page ad settings
          </button>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2>Authorized sellers · ads.txt / app-ads.txt</h2>
        <p className={styles.muted}>
          Manual SSP/exchange relationships are validated before publication. GAM rows are generated
          only from real configured seller information.
        </p>
        <div className={styles.commandGrid}>
          <SellerEditor
            automaticRows={sellerFiles?.ads.automaticRows ?? []}
            finalText={sellerFiles?.ads.finalText ?? ""}
            label="Web ads.txt"
            onChange={setAdsText}
            onSave={() => void act(() => saveSellerFile("ads", adsText), "ads.txt validated and published.")}
            value={adsText}
          />
          <SellerEditor
            automaticRows={sellerFiles?.appAds.automaticRows ?? []}
            finalText={sellerFiles?.appAds.finalText ?? ""}
            label="Apps / CTV app-ads.txt"
            onChange={setAppAdsText}
            onSave={() => void act(() => saveSellerFile("app-ads", appAdsText), "app-ads.txt validated and published.")}
            value={appAdsText}
          />
        </div>
      </section>

      <InventoryManager
        busy={busy}
        placements={overview?.placements ?? []}
        onAct={act}
      />

      <AdvertiserManager advertisers={advertisers} busy={busy} onAct={act} />

      <CampaignManager
        advertisers={advertisers}
        busy={busy}
        campaigns={campaigns}
        placements={overview?.placements ?? []}
        onAct={act}
      />

      <CreativeManager
        busy={busy}
        campaigns={campaigns}
        creatives={creatives}
        onAct={act}
      />
    </>
  );
}

function InventoryManager({
  placements,
  busy,
  onAct,
}: {
  placements: AdPlacement[];
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [family, setFamily] = useState<AdPlacement["inventoryFamily"]>("OUTSIDE_PLAYER");
  const [format, setFormat] = useState<AdPlacement["format"]>("DISPLAY");
  const [routePatterns, setRoutePatterns] = useState("/*");
  const [sizeWidth, setSizeWidth] = useState("300");
  const [sizeHeight, setSizeHeight] = useState("250");
  const [demandSource, setDemandSource] = useState<"GOOGLE_GPT" | "HOUSE">("HOUSE");
  const [adUnitPath, setAdUnitPath] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const config =
      family === "OUTSIDE_PLAYER"
        ? {
            routePatterns: splitList(routePatterns),
            sizes: [[Number(sizeWidth), Number(sizeHeight)]],
            responsive: [],
            devices: ["MOBILE", "DESKTOP"],
            audience: "ANY",
            categories: [],
            demand: { source: demandSource, adUnitPath: demandSource === "GOOGLE_GPT" ? adUnitPath.trim() || null : null },
            fallback: "HOUSE",
          }
        : { managedBy: "AYIN_ADMIN" };
    await onAct(
      () => createAdPlacement({ key: key.trim(), name: name.trim(), inventoryFamily: family, format, enabled: false, config }),
      `Placement ${key.trim()} created disabled for safe review.`,
    );
    setKey("");
    setName("");
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2>Inventory & placements</h2>
          <p className={styles.muted}>
            Create inventory disabled by default, then enable it after reviewing routing and demand.
          </p>
        </div>
      </div>
      <form className={styles.formGrid} onSubmit={(event) => void submit(event)}>
        <label>Placement key<input required minLength={2} maxLength={120} value={key} onChange={(event) => setKey(event.target.value)} /></label>
        <label>Name<input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Inventory family<select value={family} onChange={(event) => setFamily(event.target.value as AdPlacement["inventoryFamily"])}><option value="OUTSIDE_PLAYER">Outside player</option><option value="IN_PLAYER_VIDEO">In-player video</option></select></label>
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as AdPlacement["format"])}><option value="DISPLAY">Display</option><option value="NATIVE">Native</option><option value="PRE_ROLL">Pre-roll</option><option value="MID_ROLL">Mid-roll</option><option value="POST_ROLL">Post-roll</option></select></label>
        {family === "OUTSIDE_PLAYER" ? (
          <>
            <label>Route patterns<input value={routePatterns} onChange={(event) => setRoutePatterns(event.target.value)} placeholder="/*, /watch/*" /></label>
            <label>Primary size<div className={styles.actions}><input type="number" min={1} max={4096} value={sizeWidth} onChange={(event) => setSizeWidth(event.target.value)} /><input type="number" min={1} max={4096} value={sizeHeight} onChange={(event) => setSizeHeight(event.target.value)} /></div></label>
            <label>Demand source<select value={demandSource} onChange={(event) => setDemandSource(event.target.value as "GOOGLE_GPT" | "HOUSE")}><option value="HOUSE">AYIN house</option><option value="GOOGLE_GPT">Google GPT</option></select></label>
            {demandSource === "GOOGLE_GPT" ? <label>Ad unit path<input value={adUnitPath} onChange={(event) => setAdUnitPath(event.target.value)} /></label> : null}
          </>
        ) : null}
        <button className={styles.button} disabled={busy} type="submit">Create placement</button>
      </form>
      <div className={styles.grid}>
        {placements.map((placement) => (
          <PlacementCard key={placement.id} placement={placement} busy={busy} onAct={onAct} />
        ))}
      </div>
    </section>
  );
}

function PlacementCard({ placement, busy, onAct }: { placement: AdPlacement; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [name, setName] = useState(placement.name);
  const [format, setFormat] = useState(placement.format);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}><div><strong>{placement.key}</strong><p className={styles.muted}>{placement.inventoryFamily}</p></div><span className={styles.statusBadge}>{placement.enabled ? "ENABLED" : "DISABLED"}</span></div>
      <div className={styles.formGrid}>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as AdPlacement["format"])}><option value="DISPLAY">DISPLAY</option><option value="NATIVE">NATIVE</option><option value="PRE_ROLL">PRE_ROLL</option><option value="MID_ROLL">MID_ROLL</option><option value="POST_ROLL">POST_ROLL</option></select></label>
      </div>
      <details><summary>Placement config</summary><pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{JSON.stringify(placement.config, null, 2)}</pre></details>
      <div className={styles.actions}>
        <button className={styles.button} disabled={busy} type="button" onClick={() => void onAct(() => updateAdPlacement(placement.id, { name: name.trim(), format }), `Placement ${placement.key} updated.`)}>Save</button>
        <button className={placement.enabled ? styles.danger : styles.button} disabled={busy} type="button" onClick={() => void onAct(() => updateAdPlacement(placement.id, { enabled: !placement.enabled }), `Placement ${placement.key} ${placement.enabled ? "disabled" : "enabled"}.`)}>{placement.enabled ? "Disable" : "Enable"}</button>
      </div>
    </article>
  );
}

function AdvertiserManager({ advertisers, busy, onAct }: { advertisers: Advertiser[]; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<AdvertiserStatus>("ACTIVE");
  return (
    <section className={styles.card}>
      <h2>Advertisers</h2>
      <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; void onAct(() => createAdvertiser({ name: name.trim(), status }), "Advertiser created.").then(() => setName("")); }}>
        <input minLength={2} maxLength={160} placeholder="Advertiser name" value={name} onChange={(event) => setName(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value as AdvertiserStatus)}><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="DISABLED">Disabled</option></select>
        <button className={styles.button} disabled={busy || name.trim().length < 2} type="submit">Create advertiser</button>
      </form>
      <div className={styles.grid}>{advertisers.map((advertiser) => <AdvertiserCard advertiser={advertiser} busy={busy} key={advertiser.id} onAct={onAct} />)}</div>
    </section>
  );
}

function AdvertiserCard({ advertiser, busy, onAct }: { advertiser: Advertiser; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [name, setName] = useState(advertiser.name);
  const [status, setStatus] = useState<AdvertiserStatus>(advertiser.status);
  return (
    <article className={styles.cardInset}>
      <div className={styles.formGrid}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdvertiserStatus)}><option value="ACTIVE">ACTIVE</option><option value="PAUSED">PAUSED</option><option value="DISABLED">DISABLED</option></select></label></div>
      <div className={styles.actions}>
        <button className={styles.button} disabled={busy} type="button" onClick={() => void onAct(() => updateAdvertiser(advertiser.id, { name: name.trim(), status }), `Advertiser ${name.trim()} updated.`)}>Save</button>
        <button className={styles.danger} disabled={busy} type="button" onClick={() => { if (window.confirm(`Delete advertiser “${advertiser.name}”? This is allowed only when it has no campaigns.`)) void onAct(() => deleteAdvertiser(advertiser.id), `Advertiser ${advertiser.name} deleted.`); }}>Delete</button>
      </div>
    </article>
  );
}

function CampaignManager({ advertisers, campaigns, placements, busy, onAct }: { advertisers: Advertiser[]; campaigns: Campaign[]; placements: AdPlacement[]; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [advertiserId, setAdvertiserId] = useState("");
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaignDraft);
  return (
    <section className={styles.card}>
      <h2>Direct campaigns</h2>
      <p className={styles.muted}>Pricing, pacing, frequency caps and targeting are controlled here rather than hidden behind API calls.</p>
      <CampaignEditor
        advertiserId={advertiserId}
        advertisers={advertisers}
        busy={busy}
        draft={draft}
        mode="create"
        onAdvertiserChange={setAdvertiserId}
        onChange={setDraft}
        placements={placements}
        onSubmit={() =>
          onAct(
            () => createCampaign({ ...campaignInput(draft), advertiserId }),
            `Campaign ${draft.name.trim()} created.`,
          ).then(() => { setDraft(emptyCampaignDraft); setAdvertiserId(""); })
        }
      />
      <div className={styles.grid}>
        {campaigns.map((campaign) => (
          <ExistingCampaign key={campaign.id} campaign={campaign} placements={placements} busy={busy} onAct={onAct} />
        ))}
      </div>
    </section>
  );
}

function ExistingCampaign({ campaign, placements, busy, onAct }: { campaign: Campaign; placements: AdPlacement[]; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>(() => draftFromCampaign(campaign));
  useEffect(() => setDraft(draftFromCampaign(campaign)), [campaign]);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}><div><strong>{campaign.name}</strong><p className={styles.muted}>{campaign.advertiser.name} · {campaign.currency ?? "No currency"} {campaign.budget ?? ""}</p></div><span className={styles.statusBadge}>{campaign.status}</span></div>
      <p className={styles.muted}>Priority {campaign.direct?.priority ?? "—"} · frequency cap {campaign.direct?.frequencyCap ?? "—"} · pacing {campaign.direct?.pacing ?? "—"}</p>
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close editor" : "Edit campaign"}</button>
        {campaign.status === "DRAFT" ? <button className={styles.danger} disabled={busy} type="button" onClick={() => { if (window.confirm(`Delete draft campaign “${campaign.name}”?`)) void onAct(() => deleteCampaign(campaign.id), `Campaign ${campaign.name} deleted.`); }}>Delete draft</button> : null}
      </div>
      {open ? (
        <CampaignEditor busy={busy} draft={draft} mode="edit" onChange={setDraft} placements={placements} onSubmit={() => onAct(() => updateCampaign(campaign.id, campaignInput(draft)), `Campaign ${draft.name.trim()} updated.`)} />
      ) : null}
    </article>
  );
}

function CampaignEditor({ draft, onChange, placements, busy, mode, advertisers = [], advertiserId = "", onAdvertiserChange, onSubmit }: { draft: CampaignDraft; onChange: (draft: CampaignDraft) => void; placements: AdPlacement[]; busy: boolean; mode: "create" | "edit"; advertisers?: Advertiser[]; advertiserId?: string; onAdvertiserChange?: (value: string) => void; onSubmit: () => Promise<void> }) {
  const [targetQuery, setTargetQuery] = useState("");
  const [channelMatches, setChannelMatches] = useState<AdminAdvertisingChannelTarget[]>([]);
  const [videoMatches, setVideoMatches] = useState<AdminAdvertisingVideoTarget[]>([]);
  const selectedPlacementKeys = useMemo(() => new Set(splitList(draft.placementKeys)), [draft.placementKeys]);

  async function searchTargets() {
    if (targetQuery.trim().length < 2) return;
    const result = await searchAdminAdvertisingTargets(targetQuery);
    setChannelMatches(result.channels);
    setVideoMatches(result.videos);
  }

  function toggleDevice(device: AdDevice) {
    onChange({ ...draft, devices: draft.devices.includes(device) ? draft.devices.filter((item) => item !== device) : [...draft.devices, device] });
  }

  return (
    <form className={styles.formGrid} onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
      {mode === "create" ? <label>Advertiser<select required value={advertiserId} onChange={(event) => onAdvertiserChange?.(event.target.value)}><option value="">Choose advertiser</option>{advertisers.map((advertiser) => <option key={advertiser.id} value={advertiser.id}>{advertiser.name}</option>)}</select></label> : null}
      <label>Campaign name<input required minLength={2} maxLength={160} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      <label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as CampaignStatus })}>{["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Starts at<input type="datetime-local" value={draft.startsAt} onChange={(event) => onChange({ ...draft, startsAt: event.target.value })} /></label>
      <label>Ends at<input type="datetime-local" value={draft.endsAt} onChange={(event) => onChange({ ...draft, endsAt: event.target.value })} /></label>
      <label>Budget<input placeholder="1000.000000" value={draft.budget} onChange={(event) => onChange({ ...draft, budget: event.target.value })} /></label>
      <label>Currency<input maxLength={3} value={draft.currency} onChange={(event) => onChange({ ...draft, currency: event.target.value.toUpperCase() })} /></label>
      <label>Pricing<select value={draft.pricingModel} onChange={(event) => onChange({ ...draft, pricingModel: event.target.value as "CPM" | "FIXED" })}><option value="CPM">CPM</option><option value="FIXED">Fixed</option></select></label>
      <label>{draft.pricingModel === "CPM" ? "CPM" : "Fixed price"}<input required value={draft.rate} onChange={(event) => onChange({ ...draft, rate: event.target.value })} /></label>
      <label>Priority<input type="number" min={1} max={1000} value={draft.priority} onChange={(event) => onChange({ ...draft, priority: event.target.value })} /></label>
      <label>Impression goal<input type="number" min={1} value={draft.impressionGoal} onChange={(event) => onChange({ ...draft, impressionGoal: event.target.value })} placeholder="Unlimited" /></label>
      <label>Frequency cap<input type="number" min={0} max={100} value={draft.frequencyCap} onChange={(event) => onChange({ ...draft, frequencyCap: event.target.value })} /></label>
      <label>Pacing<select value={draft.pacing} onChange={(event) => onChange({ ...draft, pacing: event.target.value as "EVEN" | "ASAP" })}><option value="EVEN">Even</option><option value="ASAP">ASAP</option></select></label>
      <label className={styles.fullField}>Placement targeting<div className={styles.actions}>{placements.map((placement) => <label className={styles.check} key={placement.key}><input checked={selectedPlacementKeys.has(placement.key)} type="checkbox" onChange={(event) => { const next = new Set(selectedPlacementKeys); if (event.target.checked) next.add(placement.key); else next.delete(placement.key); onChange({ ...draft, placementKeys: [...next].join(", ") }); }} />{placement.key}</label>)}</div></label>
      <label>Countries<input placeholder="US, GB, EG" value={draft.countries} onChange={(event) => onChange({ ...draft, countries: event.target.value })} /></label>
      <label>Regions<input placeholder="California, Cairo" value={draft.regions} onChange={(event) => onChange({ ...draft, regions: event.target.value })} /></label>
      <label>Categories<input placeholder="sports, news" value={draft.categories} onChange={(event) => onChange({ ...draft, categories: event.target.value })} /></label>
      <div><span>Devices</span><div className={styles.actions}>{(["MOBILE", "DESKTOP", "TV"] as AdDevice[]).map((device) => <label className={styles.check} key={device}><input checked={draft.devices.includes(device)} type="checkbox" onChange={() => toggleDevice(device)} />{device}</label>)}</div></div>
      <div className={styles.fullField}>
        <span>Channel / video targeting</span>
        <div className={styles.toolbar}><input placeholder="Search channel or video" value={targetQuery} onChange={(event) => setTargetQuery(event.target.value)} /><button className={styles.button} disabled={targetQuery.trim().length < 2} type="button" onClick={() => void searchTargets()}>Search targets</button></div>
        <div className={styles.commandGrid}>
          {channelMatches.map((channel) => <button className={styles.button} key={channel.id} type="button" onClick={() => onChange({ ...draft, channelIds: [...new Set([...draft.channelIds, channel.id])] })}>+ @{channel.handle}</button>)}
          {videoMatches.map((video) => <button className={styles.button} key={video.id} type="button" onClick={() => onChange({ ...draft, videoIds: [...new Set([...draft.videoIds, video.id])] })}>+ {video.title}</button>)}
        </div>
        <p className={styles.muted}>Selected: {draft.channelIds.length} channels · {draft.videoIds.length} videos</p>
        {(draft.channelIds.length || draft.videoIds.length) ? <button className={styles.danger} type="button" onClick={() => onChange({ ...draft, channelIds: [], videoIds: [] })}>Clear channel/video targeting</button> : null}
      </div>
      <button className={styles.button} disabled={busy || draft.name.trim().length < 2 || (mode === "create" && !advertiserId)} type="submit">{mode === "create" ? "Create campaign" : "Save campaign"}</button>
    </form>
  );
}

function CreativeManager({ campaigns, creatives, busy, onAct }: { campaigns: Campaign[]; creatives: Creative[]; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [campaignId, setCampaignId] = useState("");
  const [draft, setDraft] = useState<CreativeInput>({ name: "", type: "VIDEO", status: "DRAFT", destinationUrl: null, vastTagUrl: null, headline: null, body: null, direct: { assetUrl: null, width: null, height: null, approvedReference: null } });
  return (
    <section className={styles.card}>
      <h2>Creatives</h2>
      <p className={styles.muted}>Create and operate video, display, native and VAST creatives directly from Admin.</p>
      <CreativeEditor campaigns={campaigns} campaignId={campaignId} onCampaignChange={setCampaignId} draft={draft} onChange={setDraft} busy={busy} mode="create" onSubmit={() => onAct(() => createCreative({ ...draft, campaignId }), `Creative ${draft.name.trim()} created.`).then(() => setDraft({ name: "", type: "VIDEO", status: "DRAFT", destinationUrl: null, vastTagUrl: null, headline: null, body: null, direct: { assetUrl: null, width: null, height: null, approvedReference: null } }))} />
      <div className={styles.grid}>{creatives.map((creative) => <CreativeCard key={creative.id} creative={creative} campaigns={campaigns} busy={busy} onAct={onAct} />)}</div>
    </section>
  );
}

function CreativeCard({ creative, campaigns, busy, onAct }: { creative: Creative; campaigns: Campaign[]; busy: boolean; onAct: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CreativeInput>({ name: creative.name, type: creative.type, status: creative.status, destinationUrl: creative.destinationUrl, vastTagUrl: creative.vastTagUrl, headline: creative.headline, body: creative.body, direct: { assetUrl: creative.direct?.assetUrl ?? null, width: creative.direct?.width ?? null, height: creative.direct?.height ?? null, approvedReference: creative.direct?.approvedReference ?? null } });
  useEffect(() => setDraft({ name: creative.name, type: creative.type, status: creative.status, destinationUrl: creative.destinationUrl, vastTagUrl: creative.vastTagUrl, headline: creative.headline, body: creative.body, direct: { assetUrl: creative.direct?.assetUrl ?? null, width: creative.direct?.width ?? null, height: creative.direct?.height ?? null, approvedReference: creative.direct?.approvedReference ?? null } }), [creative]);
  const campaign = campaigns.find((item) => item.id === creative.campaignId);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}><div><strong>{creative.name}</strong><p className={styles.muted}>{campaign?.name ?? "Campaign"} · {creative.type}</p></div><span className={styles.statusBadge}>{creative.status}</span></div>
      <div className={styles.actions}><button className={styles.button} type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close editor" : "Edit creative"}</button><button className={styles.danger} disabled={busy} type="button" onClick={() => { if (window.confirm(`Delete/archive creative “${creative.name}”? Creatives with event history are archived automatically.`)) void onAct(() => deleteCreative(creative.id), `Creative ${creative.name} removed or archived.`); }}>Delete / archive</button></div>
      {open ? <CreativeEditor campaigns={campaigns} draft={draft} onChange={setDraft} busy={busy} mode="edit" onSubmit={() => onAct(() => updateCreative(creative.id, draft), `Creative ${draft.name.trim()} updated.`)} /> : null}
    </article>
  );
}

function CreativeEditor({ campaigns, campaignId = "", onCampaignChange, draft, onChange, busy, mode, onSubmit }: { campaigns: Campaign[]; campaignId?: string; onCampaignChange?: (value: string) => void; draft: CreativeInput; onChange: (draft: CreativeInput) => void; busy: boolean; mode: "create" | "edit"; onSubmit: () => Promise<void> }) {
  const setDirect = (value: Partial<CreativeInput["direct"]>) => onChange({ ...draft, direct: { ...draft.direct, ...value } });
  return (
    <form className={styles.formGrid} onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
      {mode === "create" ? <label>Campaign<select required value={campaignId} onChange={(event) => onCampaignChange?.(event.target.value)}><option value="">Choose campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label> : null}
      <label>Name<input required minLength={2} maxLength={160} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      <label>Type<select value={draft.type} onChange={(event) => onChange({ ...draft, type: event.target.value as CreativeType })}>{["VIDEO", "DISPLAY", "NATIVE", "VAST_TAG"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as CreativeStatus })}>{["DRAFT", "ACTIVE", "PAUSED", "REJECTED", "ARCHIVED"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Asset URL<input placeholder="https://…" value={draft.direct.assetUrl ?? ""} onChange={(event) => setDirect({ assetUrl: event.target.value || null })} /></label>
      <label>Destination URL<input placeholder="https://…" value={draft.destinationUrl ?? ""} onChange={(event) => onChange({ ...draft, destinationUrl: event.target.value || null })} /></label>
      <label>VAST tag URL<input placeholder="https://…" value={draft.vastTagUrl ?? ""} onChange={(event) => onChange({ ...draft, vastTagUrl: event.target.value || null })} /></label>
      <label>Approved reference<input placeholder="IO / approval / asset reference" value={draft.direct.approvedReference ?? ""} onChange={(event) => setDirect({ approvedReference: event.target.value || null })} /></label>
      <label>Width<input type="number" min={1} max={4096} value={draft.direct.width ?? ""} onChange={(event) => setDirect({ width: event.target.value ? Number(event.target.value) : null })} /></label>
      <label>Height<input type="number" min={1} max={4096} value={draft.direct.height ?? ""} onChange={(event) => setDirect({ height: event.target.value ? Number(event.target.value) : null })} /></label>
      <label className={styles.fullField}>Headline<input maxLength={200} value={draft.headline ?? ""} onChange={(event) => onChange({ ...draft, headline: event.target.value || null })} /></label>
      <label className={styles.fullField}>Body<textarea maxLength={2000} value={draft.body ?? ""} onChange={(event) => onChange({ ...draft, body: event.target.value || null })} /></label>
      <button className={styles.button} disabled={busy || draft.name.trim().length < 2 || (mode === "create" && !campaignId)} type="submit">{mode === "create" ? "Create creative" : "Save creative"}</button>
    </form>
  );
}

function SellerEditor({ label, value, automaticRows, finalText, onChange, onSave }: { label: string; value: string; automaticRows: string[]; finalText: string; onChange: (value: string) => void; onSave: () => void }) {
  return (
    <article className={styles.cardInset}>
      <h3>{label}</h3>
      <textarea rows={8} spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} placeholder="OWNERDOMAIN=ayin.stream\n# Add only real seller relationships" style={{ fontFamily: "monospace", width: "100%" }} />
      <button className={styles.button} type="button" onClick={onSave}>Validate & publish</button>
      <details><summary>Automatic GAM rows</summary><pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{automaticRows.length ? automaticRows.join("\n") : "None — GAM seller data is not configured yet."}</pre></details>
      <details><summary>Published preview</summary><pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{finalText || "(empty — no seller relationship is being claimed)"}</pre></details>
    </article>
  );
}
