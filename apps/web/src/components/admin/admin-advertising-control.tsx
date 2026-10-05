"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  DataBadge,
  PageHeader,
  MetricList,
  StatusNotice,
  TextAreaField,
} from "@/components/ui/design-system";
import { EditorTabs } from "@/components/ui/editor-tabs";
import { Disclosure } from "@/components/ui/data-presentation";
import { adminAdvertisingAr, adminAdvertisingEn } from "@/lib/i18n/resources/admin-advertising";
import { AdminAdvertisingNavigation } from "./admin-advertising-navigation";
import advertisingStyles from "./admin-advertising-navigation.module.css";
import {
  reconcileAdvertisingRead,
  type AdvertisingEditableRecords,
} from "@/lib/admin-advertising-drafts";
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
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].map((item) => (upper ? item.toUpperCase() : item));
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
    impressionGoal:
      direct?.impressionGoal === null || direct?.impressionGoal === undefined
        ? ""
        : String(direct.impressionGoal),
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
  const { locale, direction } = useI18n();
  const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
  const [section, setSection] = useState("overview");
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState(false);
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
  const editable = useRef<{
    original: AdvertisingEditableRecords;
    draft: AdvertisingEditableRecords;
  }>({
    original: { page: null, ads: "", appAds: "" },
    draft: { page: null, ads: "", appAds: "" },
  });
  function editPage(value: PageAdSettings) {
    editable.current.draft = { ...editable.current.draft, page: value };
    setPageAds(value);
  }
  function editSeller(kind: "ads" | "appAds", value: string) {
    editable.current.draft = { ...editable.current.draft, [kind]: value };
    if (kind === "ads") setAdsText(value);
    else setAppAdsText(value);
  }

  const load = useCallback(async (preserveDrafts = false) => {
    setReading(true);
    setReadError(false);
    try {
      const [
        nextOverview,
        nextAdvertisers,
        nextCampaigns,
        nextCreatives,
        nextGam,
        nextPageAds,
        nextSellerFiles,
      ] = await Promise.all([
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
      const incoming = {
        page: nextPageAds,
        ads: nextSellerFiles.ads.manualText,
        appAds: nextSellerFiles.appAds.manualText,
      };
      const nextDraft = preserveDrafts
        ? reconcileAdvertisingRead(editable.current.original, editable.current.draft, incoming)
        : incoming;
      editable.current = { original: incoming, draft: nextDraft };
      setPageAds(nextDraft.page);
      setSellerFiles(nextSellerFiles);
      setAdsText(nextDraft.ads);
      setAppAdsText(nextDraft.appAds);
    } catch {
      setReadError(true);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
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
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <ActionButton disabled={reading || busy} onClick={() => void load(true)}>
            {copy.refresh}
          </ActionButton>
        }
      />
      <AdminAdvertisingNavigation current="page" />
      {message ? <StatusNotice>{message}</StatusNotice> : null}
      {readError ? <StatusNotice tone="danger">{copy.readError}</StatusNotice> : null}
      {reading ? <StatusNotice announce="polite">{copy.loading}</StatusNotice> : null}
      <div className={advertisingStyles.sections}>
        <EditorTabs
          label={copy.sections}
          value={section}
          onChange={setSection}
          direction={direction}
          tabs={[
            {
              id: "overview",
              label: copy.overview,
              content: (
                <>
                  <MetricList
                    label={copy.summary}
                    items={[
                      {
                        label: copy.master,
                        value: (
                          <DataBadge>
                            {!overview || readError
                              ? copy.unavailable
                              : overview.emergencyKillSwitch
                                ? copy.stopped
                                : copy.notStopped}
                          </DataBadge>
                        ),
                      },
                      {
                        label: copy.gam,
                        value: (
                          <DataBadge>
                            {!gam || readError
                              ? copy.unavailable
                              : gam.readyForLiveRequests
                                ? copy.configured
                                : gam.testMode
                                  ? copy.test
                                  : copy.notReady}
                          </DataBadge>
                        ),
                      },
                      {
                        label: copy.activeCampaigns,
                        value:
                          !overview || readError ? (
                            <DataBadge>{copy.unavailable}</DataBadge>
                          ) : (
                            activeCampaigns.toLocaleString(locale)
                          ),
                      },
                      {
                        label: copy.activeCreatives,
                        value:
                          !overview || readError ? (
                            <DataBadge>{copy.unavailable}</DataBadge>
                          ) : (
                            activeCreatives.toLocaleString(locale)
                          ),
                      },
                      {
                        label: copy.placements,
                        value:
                          !overview || readError ? (
                            <DataBadge>{copy.unavailable}</DataBadge>
                          ) : (
                            overview.placements.length.toLocaleString(locale)
                          ),
                      },
                    ]}
                  />
                  <p className={styles.muted}>{copy.configurationOnly}</p>
                  <div>
                    <Disclosure summary={copy.emergency}>
                      <p className={styles.muted}>{copy.emergencyDescription}</p>
                      <TextAreaField
                        id="advertising-emergency-reason"
                        label={copy.reason}
                        minLength={3}
                        value={killReason}
                        onChange={(event) => setKillReason(event.target.value)}
                      />
                      <ActionButton
                        tone={overview?.emergencyKillSwitch ? "secondary" : "danger"}
                        disabled={
                          busy || reading || readError || !overview || killReason.trim().length < 3
                        }
                        type="button"
                        onClick={() =>
                          void act(
                            () =>
                              setAdvertisingKillSwitch(
                                !overview?.emergencyKillSwitch,
                                killReason.trim(),
                              ),
                            overview?.emergencyKillSwitch ? copy.restored : copy.stoppedMessage,
                          ).then(() => setKillReason(""))
                        }
                      >
                        {overview?.emergencyKillSwitch ? copy.restore : copy.stop}
                      </ActionButton>
                    </Disclosure>

                    <Disclosure summary={copy.diagnostics}>
                      {gam && !readError ? (
                        <>
                          <p>
                            {copy.configured}:{" "}
                            <strong>{gam.configured ? copy.yes : copy.no}</strong>
                          </p>
                          <p>
                            {copy.production}:{" "}
                            <strong>{gam.productionEnabled ? copy.yes : copy.no}</strong>
                          </p>
                          <p>
                            {copy.test}: <strong>{gam.testMode ? copy.yes : copy.no}</strong>
                          </p>
                          <p>
                            {copy.network}: <strong>{gam.networkCode ?? copy.unconfigured}</strong>
                          </p>
                          <p>
                            {copy.publisher}:{" "}
                            <strong>{gam.publisherId ?? copy.unconfigured}</strong>
                          </p>
                          <p>
                            {copy.videoUnit}:{" "}
                            <strong>
                              {gam.videoAdUnitConfigured ? copy.configured : copy.missing}
                            </strong>
                          </p>
                          <p>
                            {copy.displayPrefix}:{" "}
                            <strong>
                              {gam.displayAdUnitPrefixConfigured ? copy.configured : copy.missing}
                            </strong>
                          </p>
                          <p>
                            {copy.sellerRow}:{" "}
                            <strong>{gam.adsTxtConfigured ? copy.configured : copy.missing}</strong>
                          </p>
                          {gam.missing.length ? (
                            <p className={styles.muted}>
                              {copy.missingValues}: {gam.missing.join(", ")}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className={styles.muted}>
                          {readError ? copy.unavailable : copy.loading}
                        </p>
                      )}
                    </Disclosure>

                    <Disclosure summary={copy.counters}>
                      {!overview || readError ? (
                        <p className={styles.muted}>{copy.unavailable}</p>
                      ) : Object.entries(overview.eventCounters).length ? (
                        Object.entries(overview?.eventCounters ?? {}).map(([event, count]) => (
                          <p key={event}>
                            {event}: <strong>{count.toLocaleString()}</strong>
                          </p>
                        ))
                      ) : (
                        <p className={styles.muted}>{copy.noEvents}</p>
                      )}
                    </Disclosure>
                  </div>
                </>
              ),
            },
            {
              id: "inventory",
              label: copy.inventory,
              content: (
                <>
                  {pageAds ? (
                    <section className={styles.card}>
                      <div className={styles.cardHeader}>
                        <div>
                          <h2>{copy.pageAds}</h2>
                          <p className={styles.muted}>{copy.pageDescription}</p>
                        </div>
                      </div>
                      <div className={styles.formGrid}>
                        <label className={styles.check}>
                          <input
                            checked={pageAds.masterEnabled}
                            type="checkbox"
                            onChange={(event) =>
                              editPage({ ...pageAds, masterEnabled: event.target.checked })
                            }
                          />
                          {copy.pageEnabled}
                        </label>
                        <label className={styles.check}>
                          <input
                            checked={pageAds.googleGptEnabled}
                            type="checkbox"
                            onChange={(event) =>
                              editPage({ ...pageAds, googleGptEnabled: event.target.checked })
                            }
                          />
                          {copy.gptEnabled}
                        </label>
                        <label>
                          {copy.image}
                          <input
                            value={pageAds.house.imageUrl ?? ""}
                            onChange={(event) =>
                              editPage({
                                ...pageAds,
                                house: { ...pageAds.house, imageUrl: event.target.value || null },
                              })
                            }
                          />
                        </label>
                        <label>
                          {copy.click}
                          <input
                            value={pageAds.house.clickUrl ?? ""}
                            onChange={(event) =>
                              editPage({
                                ...pageAds,
                                house: { ...pageAds.house, clickUrl: event.target.value || null },
                              })
                            }
                          />
                        </label>
                        <label className={styles.fullField}>
                          {copy.alt}
                          <input
                            value={pageAds.house.altText ?? ""}
                            onChange={(event) =>
                              editPage({
                                ...pageAds,
                                house: { ...pageAds.house, altText: event.target.value || null },
                              })
                            }
                          />
                        </label>
                      </div>
                      <button
                        className={styles.button}
                        disabled={busy}
                        type="button"
                        onClick={() =>
                          void act(() => updatePageAdSettings(pageAds), copy.pageSaved)
                        }
                      >
                        {copy.savePage}
                      </button>
                    </section>
                  ) : null}

                  {locale === "ar" ? <p className={styles.muted}>{copy.legacyEditor}</p> : null}
                  <InventoryManager
                    busy={busy}
                    placements={overview?.placements ?? []}
                    onAct={act}
                  />
                </>
              ),
            },
            {
              id: "advertisers",
              label: copy.advertisers,
              content: (
                <>
                  {locale === "ar" ? <p className={styles.muted}>{copy.legacyEditor}</p> : null}
                  <AdvertiserManager advertisers={advertisers} busy={busy} onAct={act} />
                </>
              ),
            },
            {
              id: "campaigns",
              label: copy.campaigns,
              content: (
                <>
                  {locale === "ar" ? <p className={styles.muted}>{copy.legacyEditor}</p> : null}
                  <CampaignManager
                    advertisers={advertisers}
                    busy={busy}
                    campaigns={campaigns}
                    placements={overview?.placements ?? []}
                    onAct={act}
                  />
                </>
              ),
            },
            {
              id: "creatives",
              label: copy.creatives,
              content: (
                <>
                  {locale === "ar" ? <p className={styles.muted}>{copy.legacyEditor}</p> : null}
                  <CreativeManager
                    busy={busy}
                    campaigns={campaigns}
                    creatives={creatives}
                    onAct={act}
                  />
                </>
              ),
            },
            {
              id: "sellers",
              label: copy.sellers,
              content: (
                <>
                  <section className={styles.card}>
                    <h2>{copy.sellersTitle}</h2>
                    {locale === "ar" ? <p className={styles.muted}>{copy.legacyEditor}</p> : null}
                    <p className={styles.muted}>{copy.sellersDescription}</p>
                    <div className={styles.commandGrid}>
                      <SellerEditor
                        automaticRows={sellerFiles?.ads.automaticRows ?? []}
                        finalText={sellerFiles?.ads.finalText ?? ""}
                        label="Web ads.txt"
                        onChange={(value) => editSeller("ads", value)}
                        onSave={() =>
                          void act(
                            () => saveSellerFile("ads", adsText),
                            "ads.txt validated and published.",
                          )
                        }
                        value={adsText}
                      />
                      <SellerEditor
                        automaticRows={sellerFiles?.appAds.automaticRows ?? []}
                        finalText={sellerFiles?.appAds.finalText ?? ""}
                        label="Apps / CTV app-ads.txt"
                        onChange={(value) => editSeller("appAds", value)}
                        onSave={() =>
                          void act(
                            () => saveSellerFile("app-ads", appAdsText),
                            "app-ads.txt validated and published.",
                          )
                        }
                        value={appAdsText}
                      />
                    </div>
                  </section>
                </>
              ),
            },
          ]}
        />
      </div>
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
            demand: {
              source: demandSource,
              adUnitPath: demandSource === "GOOGLE_GPT" ? adUnitPath.trim() || null : null,
            },
            fallback: "HOUSE",
          }
        : { managedBy: "AYIN_ADMIN" };
    await onAct(
      () =>
        createAdPlacement({
          key: key.trim(),
          name: name.trim(),
          inventoryFamily: family,
          format,
          enabled: false,
          config,
        }),
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
        <label>
          Placement key
          <input
            required
            minLength={2}
            maxLength={120}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label>
          Name
          <input
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Inventory family
          <select
            value={family}
            onChange={(event) => setFamily(event.target.value as AdPlacement["inventoryFamily"])}
          >
            <option value="OUTSIDE_PLAYER">Outside player</option>
            <option value="IN_PLAYER_VIDEO">In-player video</option>
          </select>
        </label>
        <label>
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as AdPlacement["format"])}
          >
            <option value="DISPLAY">Display</option>
            <option value="NATIVE">Native</option>
            <option value="PRE_ROLL">Pre-roll</option>
            <option value="MID_ROLL">Mid-roll</option>
            <option value="POST_ROLL">Post-roll</option>
          </select>
        </label>
        {family === "OUTSIDE_PLAYER" ? (
          <>
            <label>
              Route patterns
              <input
                value={routePatterns}
                onChange={(event) => setRoutePatterns(event.target.value)}
                placeholder="/*, /watch/*"
              />
            </label>
            <label>
              Primary size
              <div className={styles.actions}>
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={sizeWidth}
                  onChange={(event) => setSizeWidth(event.target.value)}
                />
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={sizeHeight}
                  onChange={(event) => setSizeHeight(event.target.value)}
                />
              </div>
            </label>
            <label>
              Demand source
              <select
                value={demandSource}
                onChange={(event) => setDemandSource(event.target.value as "GOOGLE_GPT" | "HOUSE")}
              >
                <option value="HOUSE">AYIN house</option>
                <option value="GOOGLE_GPT">Google GPT</option>
              </select>
            </label>
            {demandSource === "GOOGLE_GPT" ? (
              <label>
                Ad unit path
                <input value={adUnitPath} onChange={(event) => setAdUnitPath(event.target.value)} />
              </label>
            ) : null}
          </>
        ) : null}
        <button className={styles.button} disabled={busy} type="submit">
          Create placement
        </button>
      </form>
      <div className={styles.grid}>
        {placements.map((placement) => (
          <PlacementCard key={placement.id} placement={placement} busy={busy} onAct={onAct} />
        ))}
      </div>
    </section>
  );
}

function PlacementCard({
  placement,
  busy,
  onAct,
}: {
  placement: AdPlacement;
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [name, setName] = useState(placement.name);
  const [format, setFormat] = useState(placement.format);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{placement.key}</strong>
          <p className={styles.muted}>{placement.inventoryFamily}</p>
        </div>
        <span className={styles.statusBadge}>{placement.enabled ? "ENABLED" : "DISABLED"}</span>
      </div>
      <div className={styles.formGrid}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as AdPlacement["format"])}
          >
            <option value="DISPLAY">DISPLAY</option>
            <option value="NATIVE">NATIVE</option>
            <option value="PRE_ROLL">PRE_ROLL</option>
            <option value="MID_ROLL">MID_ROLL</option>
            <option value="POST_ROLL">POST_ROLL</option>
          </select>
        </label>
      </div>
      <details>
        <summary>Placement config</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {JSON.stringify(placement.config, null, 2)}
        </pre>
      </details>
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy}
          type="button"
          onClick={() =>
            void onAct(
              () => updateAdPlacement(placement.id, { name: name.trim(), format }),
              `Placement ${placement.key} updated.`,
            )
          }
        >
          Save
        </button>
        <button
          className={placement.enabled ? styles.danger : styles.button}
          disabled={busy}
          type="button"
          onClick={() =>
            void onAct(
              () => updateAdPlacement(placement.id, { enabled: !placement.enabled }),
              `Placement ${placement.key} ${placement.enabled ? "disabled" : "enabled"}.`,
            )
          }
        >
          {placement.enabled ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  );
}

function AdvertiserManager({
  advertisers,
  busy,
  onAct,
}: {
  advertisers: Advertiser[];
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<AdvertiserStatus>("ACTIVE");
  return (
    <section className={styles.card}>
      <h2>Advertisers</h2>
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void onAct(
            () => createAdvertiser({ name: name.trim(), status }),
            "Advertiser created.",
          ).then(() => setName(""));
        }}
      >
        <input
          minLength={2}
          maxLength={160}
          placeholder="Advertiser name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as AdvertiserStatus)}
        >
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <button className={styles.button} disabled={busy || name.trim().length < 2} type="submit">
          Create advertiser
        </button>
      </form>
      <div className={styles.grid}>
        {advertisers.map((advertiser) => (
          <AdvertiserCard advertiser={advertiser} busy={busy} key={advertiser.id} onAct={onAct} />
        ))}
      </div>
    </section>
  );
}

function AdvertiserCard({
  advertiser,
  busy,
  onAct,
}: {
  advertiser: Advertiser;
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [name, setName] = useState(advertiser.name);
  const [status, setStatus] = useState<AdvertiserStatus>(advertiser.status);
  return (
    <article className={styles.cardInset}>
      <div className={styles.formGrid}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as AdvertiserStatus)}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAUSED">PAUSED</option>
            <option value="DISABLED">DISABLED</option>
          </select>
        </label>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy}
          type="button"
          onClick={() =>
            void onAct(
              () => updateAdvertiser(advertiser.id, { name: name.trim(), status }),
              `Advertiser ${name.trim()} updated.`,
            )
          }
        >
          Save
        </button>
        <button
          className={styles.danger}
          disabled={busy}
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Delete advertiser “${advertiser.name}”? This is allowed only when it has no campaigns.`,
              )
            )
              void onAct(
                () => deleteAdvertiser(advertiser.id),
                `Advertiser ${advertiser.name} deleted.`,
              );
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function CampaignManager({
  advertisers,
  campaigns,
  placements,
  busy,
  onAct,
}: {
  advertisers: Advertiser[];
  campaigns: Campaign[];
  placements: AdPlacement[];
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [advertiserId, setAdvertiserId] = useState("");
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaignDraft);
  return (
    <section className={styles.card}>
      <h2>Direct campaigns</h2>
      <p className={styles.muted}>
        Pricing, pacing, frequency caps and targeting are controlled here rather than hidden behind
        API calls.
      </p>
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
          ).then(() => {
            setDraft(emptyCampaignDraft);
            setAdvertiserId("");
          })
        }
      />
      <div className={styles.grid}>
        {campaigns.map((campaign) => (
          <ExistingCampaign
            key={campaign.id}
            campaign={campaign}
            placements={placements}
            busy={busy}
            onAct={onAct}
          />
        ))}
      </div>
    </section>
  );
}

function ExistingCampaign({
  campaign,
  placements,
  busy,
  onAct,
}: {
  campaign: Campaign;
  placements: AdPlacement[];
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>(() => draftFromCampaign(campaign));
  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(draftFromCampaign(campaign)), 0);
    return () => window.clearTimeout(timer);
  }, [campaign]);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{campaign.name}</strong>
          <p className={styles.muted}>
            {campaign.advertiser.name} · {campaign.currency ?? "No currency"}{" "}
            {campaign.budget ?? ""}
          </p>
        </div>
        <span className={styles.statusBadge}>{campaign.status}</span>
      </div>
      <p className={styles.muted}>
        Priority {campaign.direct?.priority ?? "—"} · frequency cap{" "}
        {campaign.direct?.frequencyCap ?? "—"} · pacing {campaign.direct?.pacing ?? "—"}
      </p>
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Close editor" : "Edit campaign"}
        </button>
        {campaign.status === "DRAFT" ? (
          <button
            className={styles.danger}
            disabled={busy}
            type="button"
            onClick={() => {
              if (window.confirm(`Delete draft campaign “${campaign.name}”?`))
                void onAct(() => deleteCampaign(campaign.id), `Campaign ${campaign.name} deleted.`);
            }}
          >
            Delete draft
          </button>
        ) : null}
      </div>
      {open ? (
        <CampaignEditor
          busy={busy}
          draft={draft}
          mode="edit"
          onChange={setDraft}
          placements={placements}
          onSubmit={() =>
            onAct(
              () => updateCampaign(campaign.id, campaignInput(draft)),
              `Campaign ${draft.name.trim()} updated.`,
            )
          }
        />
      ) : null}
    </article>
  );
}

function CampaignEditor({
  draft,
  onChange,
  placements,
  busy,
  mode,
  advertisers = [],
  advertiserId = "",
  onAdvertiserChange,
  onSubmit,
}: {
  draft: CampaignDraft;
  onChange: (draft: CampaignDraft) => void;
  placements: AdPlacement[];
  busy: boolean;
  mode: "create" | "edit";
  advertisers?: Advertiser[];
  advertiserId?: string;
  onAdvertiserChange?: (value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  const [targetQuery, setTargetQuery] = useState("");
  const [channelMatches, setChannelMatches] = useState<AdminAdvertisingChannelTarget[]>([]);
  const [videoMatches, setVideoMatches] = useState<AdminAdvertisingVideoTarget[]>([]);
  const selectedPlacementKeys = useMemo(
    () => new Set(splitList(draft.placementKeys)),
    [draft.placementKeys],
  );

  async function searchTargets() {
    if (targetQuery.trim().length < 2) return;
    const result = await searchAdminAdvertisingTargets(targetQuery);
    setChannelMatches(result.channels);
    setVideoMatches(result.videos);
  }

  function toggleDevice(device: AdDevice) {
    onChange({
      ...draft,
      devices: draft.devices.includes(device)
        ? draft.devices.filter((item) => item !== device)
        : [...draft.devices, device],
    });
  }

  return (
    <form
      className={styles.formGrid}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {mode === "create" ? (
        <label>
          Advertiser
          <select
            required
            value={advertiserId}
            onChange={(event) => onAdvertiserChange?.(event.target.value)}
          >
            <option value="">Choose advertiser</option>
            {advertisers.map((advertiser) => (
              <option key={advertiser.id} value={advertiser.id}>
                {advertiser.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Campaign name
        <input
          required
          minLength={2}
          maxLength={160}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        Status
        <select
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as CampaignStatus })}
        >
          {["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Starts at
        <input
          type="datetime-local"
          value={draft.startsAt}
          onChange={(event) => onChange({ ...draft, startsAt: event.target.value })}
        />
      </label>
      <label>
        Ends at
        <input
          type="datetime-local"
          value={draft.endsAt}
          onChange={(event) => onChange({ ...draft, endsAt: event.target.value })}
        />
      </label>
      <label>
        Budget
        <input
          placeholder="1000.000000"
          value={draft.budget}
          onChange={(event) => onChange({ ...draft, budget: event.target.value })}
        />
      </label>
      <label>
        Currency
        <input
          maxLength={3}
          value={draft.currency}
          onChange={(event) => onChange({ ...draft, currency: event.target.value.toUpperCase() })}
        />
      </label>
      <label>
        Pricing
        <select
          value={draft.pricingModel}
          onChange={(event) =>
            onChange({ ...draft, pricingModel: event.target.value as "CPM" | "FIXED" })
          }
        >
          <option value="CPM">CPM</option>
          <option value="FIXED">Fixed</option>
        </select>
      </label>
      <label>
        {draft.pricingModel === "CPM" ? "CPM" : "Fixed price"}
        <input
          required
          value={draft.rate}
          onChange={(event) => onChange({ ...draft, rate: event.target.value })}
        />
      </label>
      <label>
        Priority
        <input
          type="number"
          min={1}
          max={1000}
          value={draft.priority}
          onChange={(event) => onChange({ ...draft, priority: event.target.value })}
        />
      </label>
      <label>
        Impression goal
        <input
          type="number"
          min={1}
          value={draft.impressionGoal}
          onChange={(event) => onChange({ ...draft, impressionGoal: event.target.value })}
          placeholder="Unlimited"
        />
      </label>
      <label>
        Frequency cap
        <input
          type="number"
          min={0}
          max={100}
          value={draft.frequencyCap}
          onChange={(event) => onChange({ ...draft, frequencyCap: event.target.value })}
        />
      </label>
      <label>
        Pacing
        <select
          value={draft.pacing}
          onChange={(event) =>
            onChange({ ...draft, pacing: event.target.value as "EVEN" | "ASAP" })
          }
        >
          <option value="EVEN">Even</option>
          <option value="ASAP">ASAP</option>
        </select>
      </label>
      <label className={styles.fullField}>
        Placement targeting
        <div className={styles.actions}>
          {placements.map((placement) => (
            <label className={styles.check} key={placement.key}>
              <input
                checked={selectedPlacementKeys.has(placement.key)}
                type="checkbox"
                onChange={(event) => {
                  const next = new Set(selectedPlacementKeys);
                  if (event.target.checked) next.add(placement.key);
                  else next.delete(placement.key);
                  onChange({ ...draft, placementKeys: [...next].join(", ") });
                }}
              />
              {placement.key}
            </label>
          ))}
        </div>
      </label>
      <label>
        Countries
        <input
          placeholder="US, GB, EG"
          value={draft.countries}
          onChange={(event) => onChange({ ...draft, countries: event.target.value })}
        />
      </label>
      <label>
        Regions
        <input
          placeholder="California, Cairo"
          value={draft.regions}
          onChange={(event) => onChange({ ...draft, regions: event.target.value })}
        />
      </label>
      <label>
        Categories
        <input
          placeholder="sports, news"
          value={draft.categories}
          onChange={(event) => onChange({ ...draft, categories: event.target.value })}
        />
      </label>
      <div>
        <span>Devices</span>
        <div className={styles.actions}>
          {(["MOBILE", "DESKTOP", "TV"] as AdDevice[]).map((device) => (
            <label className={styles.check} key={device}>
              <input
                checked={draft.devices.includes(device)}
                type="checkbox"
                onChange={() => toggleDevice(device)}
              />
              {device}
            </label>
          ))}
        </div>
      </div>
      <div className={styles.fullField}>
        <span>Channel / video targeting</span>
        <div className={styles.toolbar}>
          <input
            placeholder="Search channel or video"
            value={targetQuery}
            onChange={(event) => setTargetQuery(event.target.value)}
          />
          <button
            className={styles.button}
            disabled={targetQuery.trim().length < 2}
            type="button"
            onClick={() => void searchTargets()}
          >
            Search targets
          </button>
        </div>
        <div className={styles.commandGrid}>
          {channelMatches.map((channel) => (
            <button
              className={styles.button}
              key={channel.id}
              type="button"
              onClick={() =>
                onChange({ ...draft, channelIds: [...new Set([...draft.channelIds, channel.id])] })
              }
            >
              + @{channel.handle}
            </button>
          ))}
          {videoMatches.map((video) => (
            <button
              className={styles.button}
              key={video.id}
              type="button"
              onClick={() =>
                onChange({ ...draft, videoIds: [...new Set([...draft.videoIds, video.id])] })
              }
            >
              + {video.title}
            </button>
          ))}
        </div>
        <p className={styles.muted}>
          Selected: {draft.channelIds.length} channels · {draft.videoIds.length} videos
        </p>
        {draft.channelIds.length || draft.videoIds.length ? (
          <button
            className={styles.danger}
            type="button"
            onClick={() => onChange({ ...draft, channelIds: [], videoIds: [] })}
          >
            Clear channel/video targeting
          </button>
        ) : null}
      </div>
      <button
        className={styles.button}
        disabled={busy || draft.name.trim().length < 2 || (mode === "create" && !advertiserId)}
        type="submit"
      >
        {mode === "create" ? "Create campaign" : "Save campaign"}
      </button>
    </form>
  );
}

function CreativeManager({
  campaigns,
  creatives,
  busy,
  onAct,
}: {
  campaigns: Campaign[];
  creatives: Creative[];
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [campaignId, setCampaignId] = useState("");
  const [draft, setDraft] = useState<CreativeInput>({
    name: "",
    type: "VIDEO",
    status: "DRAFT",
    destinationUrl: null,
    vastTagUrl: null,
    headline: null,
    body: null,
    direct: { assetUrl: null, width: null, height: null, approvedReference: null },
  });
  return (
    <section className={styles.card}>
      <h2>Creatives</h2>
      <p className={styles.muted}>
        Create and operate video, display, native and VAST creatives directly from Admin.
      </p>
      <CreativeEditor
        campaigns={campaigns}
        campaignId={campaignId}
        onCampaignChange={setCampaignId}
        draft={draft}
        onChange={setDraft}
        busy={busy}
        mode="create"
        onSubmit={() =>
          onAct(
            () => createCreative({ ...draft, campaignId }),
            `Creative ${draft.name.trim()} created.`,
          ).then(() =>
            setDraft({
              name: "",
              type: "VIDEO",
              status: "DRAFT",
              destinationUrl: null,
              vastTagUrl: null,
              headline: null,
              body: null,
              direct: { assetUrl: null, width: null, height: null, approvedReference: null },
            }),
          )
        }
      />
      <div className={styles.grid}>
        {creatives.map((creative) => (
          <CreativeCard
            key={creative.id}
            creative={creative}
            campaigns={campaigns}
            busy={busy}
            onAct={onAct}
          />
        ))}
      </div>
    </section>
  );
}

function CreativeCard({
  creative,
  campaigns,
  busy,
  onAct,
}: {
  creative: Creative;
  campaigns: Campaign[];
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CreativeInput>({
    name: creative.name,
    type: creative.type,
    status: creative.status,
    destinationUrl: creative.destinationUrl,
    vastTagUrl: creative.vastTagUrl,
    headline: creative.headline,
    body: creative.body,
    direct: {
      assetUrl: creative.direct?.assetUrl ?? null,
      width: creative.direct?.width ?? null,
      height: creative.direct?.height ?? null,
      approvedReference: creative.direct?.approvedReference ?? null,
    },
  });
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setDraft({
          name: creative.name,
          type: creative.type,
          status: creative.status,
          destinationUrl: creative.destinationUrl,
          vastTagUrl: creative.vastTagUrl,
          headline: creative.headline,
          body: creative.body,
          direct: {
            assetUrl: creative.direct?.assetUrl ?? null,
            width: creative.direct?.width ?? null,
            height: creative.direct?.height ?? null,
            approvedReference: creative.direct?.approvedReference ?? null,
          },
        }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [creative]);
  const campaign = campaigns.find((item) => item.id === creative.campaignId);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{creative.name}</strong>
          <p className={styles.muted}>
            {campaign?.name ?? "Campaign"} · {creative.type}
          </p>
        </div>
        <span className={styles.statusBadge}>{creative.status}</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Close editor" : "Edit creative"}
        </button>
        <button
          className={styles.danger}
          disabled={busy}
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Delete/archive creative “${creative.name}”? Creatives with event history are archived automatically.`,
              )
            )
              void onAct(
                () => deleteCreative(creative.id),
                `Creative ${creative.name} removed or archived.`,
              );
          }}
        >
          Delete / archive
        </button>
      </div>
      {open ? (
        <CreativeEditor
          campaigns={campaigns}
          draft={draft}
          onChange={setDraft}
          busy={busy}
          mode="edit"
          onSubmit={() =>
            onAct(
              () => updateCreative(creative.id, draft),
              `Creative ${draft.name.trim()} updated.`,
            )
          }
        />
      ) : null}
    </article>
  );
}

function CreativeEditor({
  campaigns,
  campaignId = "",
  onCampaignChange,
  draft,
  onChange,
  busy,
  mode,
  onSubmit,
}: {
  campaigns: Campaign[];
  campaignId?: string;
  onCampaignChange?: (value: string) => void;
  draft: CreativeInput;
  onChange: (draft: CreativeInput) => void;
  busy: boolean;
  mode: "create" | "edit";
  onSubmit: () => Promise<void>;
}) {
  const setDirect = (value: Partial<CreativeInput["direct"]>) =>
    onChange({ ...draft, direct: { ...draft.direct, ...value } });
  return (
    <form
      className={styles.formGrid}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {mode === "create" ? (
        <label>
          Campaign
          <select
            required
            value={campaignId}
            onChange={(event) => onCampaignChange?.(event.target.value)}
          >
            <option value="">Choose campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Name
        <input
          required
          minLength={2}
          maxLength={160}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        Type
        <select
          value={draft.type}
          onChange={(event) => onChange({ ...draft, type: event.target.value as CreativeType })}
        >
          {["VIDEO", "DISPLAY", "NATIVE", "VAST_TAG"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as CreativeStatus })}
        >
          {["DRAFT", "ACTIVE", "PAUSED", "REJECTED", "ARCHIVED"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Asset URL
        <input
          placeholder="https://…"
          value={draft.direct.assetUrl ?? ""}
          onChange={(event) => setDirect({ assetUrl: event.target.value || null })}
        />
      </label>
      <label>
        Destination URL
        <input
          placeholder="https://…"
          value={draft.destinationUrl ?? ""}
          onChange={(event) => onChange({ ...draft, destinationUrl: event.target.value || null })}
        />
      </label>
      <label>
        VAST tag URL
        <input
          placeholder="https://…"
          value={draft.vastTagUrl ?? ""}
          onChange={(event) => onChange({ ...draft, vastTagUrl: event.target.value || null })}
        />
      </label>
      <label>
        Approved reference
        <input
          placeholder="IO / approval / asset reference"
          value={draft.direct.approvedReference ?? ""}
          onChange={(event) => setDirect({ approvedReference: event.target.value || null })}
        />
      </label>
      <label>
        Width
        <input
          type="number"
          min={1}
          max={4096}
          value={draft.direct.width ?? ""}
          onChange={(event) =>
            setDirect({ width: event.target.value ? Number(event.target.value) : null })
          }
        />
      </label>
      <label>
        Height
        <input
          type="number"
          min={1}
          max={4096}
          value={draft.direct.height ?? ""}
          onChange={(event) =>
            setDirect({ height: event.target.value ? Number(event.target.value) : null })
          }
        />
      </label>
      <label className={styles.fullField}>
        Headline
        <input
          maxLength={200}
          value={draft.headline ?? ""}
          onChange={(event) => onChange({ ...draft, headline: event.target.value || null })}
        />
      </label>
      <label className={styles.fullField}>
        Body
        <textarea
          maxLength={2000}
          value={draft.body ?? ""}
          onChange={(event) => onChange({ ...draft, body: event.target.value || null })}
        />
      </label>
      <button
        className={styles.button}
        disabled={busy || draft.name.trim().length < 2 || (mode === "create" && !campaignId)}
        type="submit"
      >
        {mode === "create" ? "Create creative" : "Save creative"}
      </button>
    </form>
  );
}

function SellerEditor({
  label,
  value,
  automaticRows,
  finalText,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  automaticRows: string[];
  finalText: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <article className={styles.cardInset}>
      <h3>{label}</h3>
      <textarea
        rows={8}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="OWNERDOMAIN=ayin.stream\n# Add only real seller relationships"
        style={{ fontFamily: "monospace", width: "100%" }}
      />
      <button className={styles.button} type="button" onClick={onSave}>
        Validate & publish
      </button>
      <details>
        <summary>Automatic GAM rows</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {automaticRows.length
            ? automaticRows.join("\n")
            : "None — GAM seller data is not configured yet."}
        </pre>
      </details>
      <details>
        <summary>Published preview</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {finalText || "(empty — no seller relationship is being claimed)"}
        </pre>
      </details>
    </article>
  );
}
