"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  DataBadge,
  PageHeader,
  MetricList,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { EditorTabs } from "@/components/ui/editor-tabs";
import { Disclosure } from "@/components/ui/data-presentation";
import { adminAdvertisingAr, adminAdvertisingEn } from "@/lib/i18n/resources/admin-advertising";
import { AdminAdvertisingNavigation } from "./admin-advertising-navigation";
import advertisingStyles from "./admin-advertising-navigation.module.css";
import {
  DirectCampaignPanel,
  DirectCampaignRecoveryNotice,
  DirectCampaignWorkspaceProvider,
} from "./admin-direct-campaign-workspace";
import {
  reconcileAdvertisingRead,
  retainCampaignCreatives,
  type AdvertisingEditableRecords,
} from "@/lib/admin-advertising-drafts";
import {
  createAdvertisingClient,
  AdvertisingRequestError,
  type AdvertisingOverview,
  type AdPlacement,
  type Campaign,
  type Creative,
  type GamDiagnostics,
  type PageAdSettings,
  type SellerFiles,
} from "@/lib/admin-advertising";
import { type AdminScopeLease } from "@/lib/admin-session-scope";
import {
  advertisingEditorAr,
  advertisingEditorEn,
} from "@/lib/i18n/resources/admin-advertising-editor";
import { useAdminAccess } from "./admin-access";
import {
  InventoryManager,
  CreativeManager,
  SellerEditor,
  type AdvertisingAction,
} from "./admin-advertising-editors";
import editorStyles from "./admin-advertising-editors.module.css";
import {
  AdvertisingDraftShelf,
  useAdvertisingDraft,
  useAdvertisingShelf,
} from "./admin-advertising-draft-shelf";
type Overview = AdvertisingOverview;
type CampaignWorkspaceInput = { active: boolean; readRevision: number; placements: AdPlacement[] };
type CampaignListener = { current: ((campaigns: Campaign[]) => void) | null };

export function AdminAdvertisingControl() {
  const access = useAdminAccess();
  const { locale } = useI18n();
  const copy = locale === "ar" ? advertisingEditorAr : advertisingEditorEn;
  const heading = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
  const root = useRef<HTMLDivElement>(null);
  const lease = access.getScopeLease();
  const [campaignInput, setCampaignInput] = useState<CampaignWorkspaceInput>({
    active: false,
    readRevision: 0,
    placements: [],
  });
  const campaignListenerRef = useRef<((campaigns: Campaign[]) => void) | null>(null);
  const onCampaignsChange = useCallback(
    (campaigns: Campaign[]) => campaignListenerRef.current?.(campaigns),
    [],
  );
  const { subscribeScopeInvalidation, getScopeLease, invalidateScope } = access;
  useLayoutEffect(
    () =>
      subscribeScopeInvalidation(() => {
        // Conceal synchronously before a route commit, page freeze or new actor can
        // paint. The scope-owned lease revokes requests; no browser draft storage.
        if (!root.current) return;
        root.current.hidden = true;
        root.current.inert = true;
        root.current.querySelectorAll("dialog").forEach((dialog) => {
          dialog.hidden = true;
          dialog.close();
        });
        root.current
          .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
            "input,textarea,select",
          )
          .forEach((field) => {
            if (field instanceof HTMLSelectElement) {
              for (const option of field.options) {
                option.selected = false;
                option.defaultSelected = false;
              }
              field.selectedIndex = -1;
            } else {
              field.value = "";
              field.defaultValue = "";
              field.removeAttribute("value");
              if (field instanceof HTMLInputElement) {
                field.checked = false;
                field.defaultChecked = false;
                field.removeAttribute("checked");
              }
            }
          });
      }),
    [subscribeScopeInvalidation],
  );
  const allowed = lease?.session.roles.some((role) =>
    ["SUPERADMIN", "ADMIN", "AD_MANAGER"].includes(role),
  );
  return (
    <DirectCampaignWorkspaceProvider
      {...campaignInput}
      active={Boolean(lease && allowed && campaignInput.active)}
      onCampaignsChange={onCampaignsChange}
    >
      {lease && allowed ? (
        <div key={lease.epoch} ref={root} data-advertising-private>
          <AdvertisingDraftShelf lease={lease}>
            <AdvertisingWorkspace
              lease={lease}
              getScopeLease={getScopeLease}
              invalidateScope={invalidateScope}
              setCampaignInput={setCampaignInput}
              campaignListenerRef={campaignListenerRef}
            />
          </AdvertisingDraftShelf>
        </div>
      ) : (
        <>
          <PageHeader title={heading.title} />
          <DirectCampaignRecoveryNotice />
          <StatusNotice>{copy.access}</StatusNotice>
          <ActionButton pending={access.loading} onClick={access.refresh}>
            {copy.refreshAccess}
          </ActionButton>
        </>
      )}
    </DirectCampaignWorkspaceProvider>
  );
}

function AdvertisingWorkspace({
  lease,
  getScopeLease,
  invalidateScope,
  setCampaignInput,
  campaignListenerRef,
}: {
  lease: AdminScopeLease;
  getScopeLease: () => AdminScopeLease | null;
  invalidateScope: () => void;
  setCampaignInput: (value: CampaignWorkspaceInput) => void;
  campaignListenerRef: CampaignListener;
}) {
  const { locale, direction } = useI18n();
  const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
  const editorCopy = locale === "ar" ? advertisingEditorAr : advertisingEditorEn;
  const shelf = useAdvertisingShelf();
  const [section, setSection] = useAdvertisingDraft("section", "overview");
  // Completed reads remain monotonic when this owner restores the scoped shelf.
  const [readRevision, setReadRevision] = useAdvertisingDraft("read-revision", 0);
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const campaignRevision = useRef(0);
  const currentCampaignIds = useRef<ReadonlySet<string>>(new Set());
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const acceptCampaigns = useCallback((next: Campaign[]) => {
    campaignRevision.current++;
    currentCampaignIds.current = new Set(next.map((campaign) => campaign.id));
    setCampaigns(next);
    setCreatives((current) => retainCampaignCreatives(current, currentCampaignIds.current));
  }, []);
  const [gam, setGam] = useState<GamDiagnostics | null>(null);
  const [pageAds, setPageAds] = useAdvertisingDraft<PageAdSettings | null>("page-draft", null);
  const [sellerFiles, setSellerFiles] = useState<SellerFiles | null>(null);
  const [adsText, setAdsText] = useAdvertisingDraft("ads-draft", "");
  const [appAdsText, setAppAdsText] = useAdvertisingDraft("app-ads-draft", "");
  const [killReason, setKillReason] = useAdvertisingDraft("kill-reason", "");
  const [message, setMessage] = useState(
    shelf.failed
      ? editorCopy.retentionError
      : shelf.pending
        ? shelf.pending.status === "acknowledged"
          ? editorCopy.acknowledged
          : shelf.pending.status === "verification"
            ? editorCopy.verify
            : editorCopy.uncertain
        : "",
  );
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(
    Boolean(shelf.pending && ["pending", "uncertain"].includes(shelf.pending.status)),
  );
  const [lastTarget, setLastTarget] = useState(shelf.pending?.target ?? "");
  const [reviewedRead, setReviewedRead] = useState(false);
  const operation = useRef(false),
    readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  const current = useCallback(() => getScopeLease() === lease, [getScopeLease, lease]);
  const locked = busy || reading || readError || uncertain;
  const editingDisabled = busy || uncertain;
  useEffect(
    () => () => {
      readController.current?.abort();
      writeController.current?.abort();
    },
    [],
  );
  const editable = useRef<{
    original: AdvertisingEditableRecords;
    draft: AdvertisingEditableRecords;
  }>(
    (shelf.values.editable as
      { original: AdvertisingEditableRecords; draft: AdvertisingEditableRecords } | undefined) ?? {
      original: { page: null, ads: "", appAds: "" },
      draft: { page: null, ads: "", appAds: "" },
    },
  );
  function editPage(value: PageAdSettings) {
    editable.current.draft = { ...editable.current.draft, page: value };
    shelf.save("editable", editable.current);
    setPageAds(value);
  }
  function editSeller(kind: "ads" | "appAds", value: string) {
    editable.current.draft = { ...editable.current.draft, [kind]: value };
    shelf.save("editable", editable.current);
    if (kind === "ads") setAdsText(value);
    else setAppAdsText(value);
  }

  const load = useCallback(
    async (preserveDrafts = false) => {
      if (!current()) return false;
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const client = createAdvertisingClient({
        lease,
        isCurrent: current,
        signal: controller.signal,
      });
      setReading(true);
      setReadError(false);
      const observedCampaignRevision = campaignRevision.current;
      try {
        const [nextOverview, nextCampaigns, nextCreatives, nextGam, nextPageAds, nextSellerFiles] =
          await Promise.all([
            client.getAdvertisingOverview(),
            client.getCampaigns(),
            client.getCreatives(),
            client.getGamDiagnostics(),
            client.getPageAdSettings(),
            client.getSellerFiles(),
          ]);
        if (!current() || controller.signal.aborted || readController.current !== controller)
          return false;
        setOverview(nextOverview);
        if (campaignRevision.current === observedCampaignRevision) {
          currentCampaignIds.current = new Set(nextCampaigns.map((campaign) => campaign.id));
          setCampaigns(nextCampaigns);
        }
        setCreatives(retainCampaignCreatives(nextCreatives, currentCampaignIds.current));
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
        shelf.save("editable", editable.current);
        setPageAds(nextDraft.page);
        setSellerFiles(nextSellerFiles);
        setAdsText(nextDraft.ads);
        setAppAdsText(nextDraft.appAds);
        setReadRevision((value) => value + 1);
        if (shelf.pending?.status === "acknowledged") shelf.setPending(null);
        setReviewedRead(true);
        return true;
      } catch (cause) {
        if (controller.signal.aborted || !current()) return false;
        if (cause instanceof AdvertisingRequestError && cause.identityUnverified) invalidateScope();
        else setReadError(true);
        return false;
      } finally {
        if (current() && readController.current === controller) setReading(false);
      }
    },
    [
      current,
      lease,
      invalidateScope,
      shelf,
      setPageAds,
      setAdsText,
      setAppAdsText,
      setReadRevision,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act: AdvertisingAction = async (action, success, target, onAcknowledged) => {
    if (operation.current || locked || !current()) return false;
    if (shelf.failed || !shelf.setPending({ target, status: "pending" })) {
      setMessage(editorCopy.retentionError);
      return false;
    }
    operation.current = true;
    const controller = new AbortController();
    writeController.current = controller;
    setBusy(true);
    setMessage("");
    setLastTarget(target);
    setReviewedRead(false);
    try {
      await action(
        createAdvertisingClient({ lease, isCurrent: current, signal: controller.signal }),
      );
      if (!current() || controller.signal.aborted) return false;
      // Commit the known result and reset only the submitted draft before an
      // optional read can be interrupted by a new Admin route/lease.
      shelf.setPending({ target, status: "acknowledged" });
      onAcknowledged?.();
      setMessage(success);
      // A failed follow-up read never changes an acknowledged save into a failed
      // mutation. Preserve unrelated dirty forms and show its read failure apart.
      setBusy(false);
      await load(true);
      return current();
    } catch (cause) {
      if (!current() || controller.signal.aborted) return false;
      if (cause instanceof AdvertisingRequestError && cause.identityUnverified) invalidateScope();
      else if (cause instanceof AdvertisingRequestError && cause.verificationRequired) {
        shelf.setPending({ target, status: "verification" });
        setMessage(editorCopy.verify);
      } else if (cause instanceof AdvertisingRequestError && cause.uncertain) {
        shelf.setPending({ target, status: "uncertain" });
        setUncertain(true);
        setMessage(editorCopy.uncertain);
      } else {
        shelf.setPending(null);
        setMessage(editorCopy.failed);
      }
      return false;
    } finally {
      operation.current = false;
      if (current()) setBusy(false);
    }
  };

  useEffect(() => {
    campaignListenerRef.current = acceptCampaigns;
    return () => {
      if (campaignListenerRef.current === acceptCampaigns) campaignListenerRef.current = null;
    };
  }, [campaignListenerRef, acceptCampaigns]);
  useEffect(() => {
    setCampaignInput({
      active: section === "advertisers" || section === "campaigns",
      readRevision,
      placements: overview?.placements ?? [],
    });
  }, [setCampaignInput, section, readRevision, overview]);

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
      {message ? (
        <StatusNotice announce="polite" tone={uncertain ? "warning" : "info"}>
          {message}
        </StatusNotice>
      ) : null}
      {busy ? <StatusNotice announce="polite">{editorCopy.saving}</StatusNotice> : null}
      {lastTarget ? (
        <p className={styles.muted}>
          {editorCopy.lastTarget}: <bdi>{lastTarget}</bdi>
        </p>
      ) : null}
      {uncertain && reviewedRead && !readError ? (
        <StatusNotice tone="warning">
          {editorCopy.reviewHint}
          <ActionButton
            disabled={reading || busy}
            onClick={() => {
              shelf.setPending(null);
              setUncertain(false);
              setMessage("");
            }}
          >
            {editorCopy.review}
          </ActionButton>
        </StatusNotice>
      ) : null}
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
                        disabled={locked}
                        maxLength={500}
                        onChange={(event) => setKillReason(event.target.value)}
                      />
                      <ActionButton
                        tone={overview?.emergencyKillSwitch ? "secondary" : "danger"}
                        disabled={locked || !overview || killReason.trim().length < 3}
                        type="button"
                        onClick={() =>
                          void act(
                            (client) =>
                              client.setAdvertisingKillSwitch(
                                !overview?.emergencyKillSwitch,
                                killReason.trim(),
                              ),
                            overview?.emergencyKillSwitch ? copy.restored : copy.stoppedMessage,
                            overview?.emergencyKillSwitch ? copy.restore : copy.stop,
                            () =>
                              setKillReason((current) => (current === killReason ? "" : current)),
                          )
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
                            {editorCopy[event as keyof typeof editorCopy] ?? editorCopy.knownEvent}:{" "}
                            <strong>{count.toLocaleString(locale)}</strong>
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
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void act(
                            (client) => client.updatePageAdSettings(pageAds),
                            copy.pageSaved,
                            copy.pageAds,
                          );
                        }}
                      >
                        <fieldset disabled={editingDisabled} className={editorStyles.fields}>
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={pageAds.masterEnabled}
                              onChange={(e) =>
                                editPage({ ...pageAds, masterEnabled: e.target.checked })
                              }
                            />
                            {copy.pageEnabled}
                          </label>
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={pageAds.googleGptEnabled}
                              onChange={(e) =>
                                editPage({ ...pageAds, googleGptEnabled: e.target.checked })
                              }
                            />
                            {copy.gptEnabled}
                          </label>
                          <TextField
                            id="page-ad-image"
                            label={copy.image}
                            type="url"
                            dir="ltr"
                            maxLength={4096}
                            value={pageAds.house.imageUrl ?? ""}
                            onChange={(e) =>
                              editPage({
                                ...pageAds,
                                house: { ...pageAds.house, imageUrl: e.target.value || null },
                              })
                            }
                          />
                          <TextField
                            id="page-ad-click"
                            label={copy.click}
                            type="url"
                            dir="ltr"
                            maxLength={4096}
                            value={pageAds.house.clickUrl ?? ""}
                            onChange={(e) =>
                              editPage({
                                ...pageAds,
                                house: { ...pageAds.house, clickUrl: e.target.value || null },
                              })
                            }
                          />
                          <div className={editorStyles.full}>
                            <TextField
                              id="page-ad-alt"
                              label={copy.alt}
                              maxLength={240}
                              value={pageAds.house.altText ?? ""}
                              onChange={(e) =>
                                editPage({
                                  ...pageAds,
                                  house: { ...pageAds.house, altText: e.target.value || null },
                                })
                              }
                            />
                          </div>
                          <ActionButton disabled={locked} type="submit">
                            {copy.savePage}
                          </ActionButton>
                        </fieldset>
                      </form>
                    </section>
                  ) : null}

                  <InventoryManager
                    readRevision={readRevision}
                    busy={locked}
                    editingDisabled={editingDisabled}
                    placements={overview?.placements ?? []}
                    onAct={act}
                  />
                </>
              ),
            },
            {
              id: "advertisers",
              label: copy.advertisers,
              content: <DirectCampaignPanel kind="advertiser" />,
            },
            {
              id: "campaigns",
              label: copy.campaigns,
              content: <DirectCampaignPanel kind="campaign" />,
            },
            {
              id: "creatives",
              label: copy.creatives,
              content: (
                <>
                  <CreativeManager
                    readRevision={readRevision}
                    busy={locked}
                    editingDisabled={editingDisabled}
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
                    <p className={styles.muted}>{copy.sellersDescription}</p>
                    <div className={styles.commandGrid}>
                      <SellerEditor
                        automaticRows={sellerFiles?.ads.automaticRows ?? []}
                        finalText={sellerFiles?.ads.finalText ?? ""}
                        label="ads.txt"
                        busy={locked}
                        editingDisabled={editingDisabled}
                        onChange={(value) => editSeller("ads", value)}
                        onSave={() =>
                          void act(
                            (client) => client.saveSellerFile("ads", adsText),
                            editorCopy.published,
                            "ads.txt",
                          )
                        }
                        value={adsText}
                      />
                      <SellerEditor
                        automaticRows={sellerFiles?.appAds.automaticRows ?? []}
                        finalText={sellerFiles?.appAds.finalText ?? ""}
                        label="app-ads.txt"
                        busy={locked}
                        editingDisabled={editingDisabled}
                        onChange={(value) => editSeller("appAds", value)}
                        onSave={() =>
                          void act(
                            (client) => client.saveSellerFile("app-ads", appAdsText),
                            editorCopy.published,
                            "app-ads.txt",
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
