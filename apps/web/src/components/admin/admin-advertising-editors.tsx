"use client";

import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  DataBadge,
  SelectField,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { Disclosure } from "@/components/ui/data-presentation";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type {
  AdvertisingClient,
  AdPlacement,
  Campaign,
  Creative,
  CreativeInput,
  CreativeStatus,
  CreativeType,
} from "@/lib/admin-advertising";
import {
  advertisingEditorAr,
  advertisingEditorEn,
} from "@/lib/i18n/resources/admin-advertising-editor";
import styles from "@/app/admin/admin.module.css";
import editorStyles from "./admin-advertising-editors.module.css";
import { useAdvertisingDraft } from "./admin-advertising-draft-shelf";

export type AdvertisingAction = (
  action: (client: AdvertisingClient) => Promise<unknown>,
  success: string,
  target: string,
  onAcknowledged?: () => void,
) => Promise<boolean>;
function useCopy() {
  return useI18n().locale === "ar" ? advertisingEditorAr : advertisingEditorEn;
}
const formats = ["DISPLAY", "NATIVE", "PRE_ROLL", "MID_ROLL", "POST_ROLL"] as const;
const emptyCreative = (): CreativeInput => ({
  name: "",
  type: "VIDEO",
  status: "DRAFT",
  destinationUrl: null,
  vastTagUrl: null,
  headline: null,
  body: null,
  direct: { assetUrl: null, width: null, height: null, approvedReference: null },
});
export function creativeDraft(creative: Creative): CreativeInput {
  return {
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
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function InventoryManager({
  placements,
  busy,
  readRevision = 0,
  editingDisabled = busy,
  onAct,
}: {
  placements: AdPlacement[];
  busy: boolean;
  readRevision?: number;
  editingDisabled?: boolean;
  onAct: AdvertisingAction;
}) {
  const copy = useCopy(),
    id = useId();
  const [key, setKey] = useAdvertisingDraft("placement-create-key", ""),
    [name, setName] = useAdvertisingDraft("placement-create-name", "");
  const [family, setFamily] = useAdvertisingDraft<AdPlacement["inventoryFamily"]>(
    "placement-create-family",
    "OUTSIDE_PLAYER",
  );
  const [format, setFormat] = useAdvertisingDraft<AdPlacement["format"]>(
    "placement-create-format",
    "DISPLAY",
  );
  const [routes, setRoutes] = useAdvertisingDraft("placement-create-routes", "/*"),
    [width, setWidth] = useAdvertisingDraft("placement-create-width", "300"),
    [height, setHeight] = useAdvertisingDraft("placement-create-height", "250");
  const [demand, setDemand] = useAdvertisingDraft<"GOOGLE_GPT" | "HOUSE">(
      "placement-create-demand",
      "HOUSE",
    ),
    [adUnit, setAdUnit] = useAdvertisingDraft("placement-create-adUnit", "");
  return (
    <section className={styles.card}>
      <h2>{copy.inventoryTitle}</h2>
      <p className={styles.muted}>{copy.inventoryDescription}</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          await onAct(
            (client) =>
              client.createAdPlacement({
                key: key.trim(),
                name: name.trim(),
                inventoryFamily: family,
                format,
                enabled: false,
                config:
                  family === "OUTSIDE_PLAYER"
                    ? {
                        routePatterns: [
                          ...new Set(
                            routes
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          ),
                        ],
                        sizes: [[Number(width), Number(height)]],
                        responsive: [],
                        devices: ["MOBILE", "DESKTOP"],
                        audience: "ANY",
                        categories: [],
                        demand: {
                          source: demand,
                          adUnitPath: demand === "GOOGLE_GPT" ? adUnit.trim() || null : null,
                        },
                        fallback: "HOUSE",
                      }
                    : { managedBy: "AYIN_ADMIN" },
              }),
            copy.placementCreated,
            `${copy.createPlacement}: ${name.trim()} (${key.trim()})`,
            () => {
              setKey((current) => (current === key ? "" : current));
              setName((current) => (current === name ? "" : current));
            },
          );
        }}
      >
        <fieldset className={editorStyles.fields} disabled={editingDisabled}>
          <TextField
            id={`${id}-key`}
            label={copy.key}
            dir="ltr"
            required
            minLength={2}
            maxLength={120}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <TextField
            id={`${id}-name`}
            label={copy.name}
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            id={`${id}-family`}
            label={copy.family}
            value={family}
            onChange={(e) => setFamily(e.target.value as typeof family)}
          >
            {["OUTSIDE_PLAYER", "IN_PLAYER_VIDEO"].map((value) => (
              <option key={value} value={value}>
                {copy[value as typeof family]}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`${id}-format`}
            label={copy.format}
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            {formats.map((value) => (
              <option key={value} value={value}>
                {copy[value]}
              </option>
            ))}
          </SelectField>
          {family === "OUTSIDE_PLAYER" ? (
            <>
              <TextField
                id={`${id}-routes`}
                label={copy.routes}
                hint={copy.routesHint}
                dir="ltr"
                value={routes}
                onChange={(e) => setRoutes(e.target.value)}
              />
              <TextField
                id={`${id}-width`}
                label={copy.width}
                required
                type="number"
                min={1}
                max={4096}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
              <TextField
                id={`${id}-height`}
                label={copy.height}
                required
                type="number"
                min={1}
                max={4096}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
              <SelectField
                id={`${id}-demand`}
                label={copy.demand}
                value={demand}
                onChange={(e) => setDemand(e.target.value as typeof demand)}
              >
                <option value="HOUSE">{copy.HOUSE}</option>
                <option value="GOOGLE_GPT">{copy.GOOGLE_GPT}</option>
              </SelectField>
              {demand === "GOOGLE_GPT" ? (
                <TextField
                  id={`${id}-ad-unit`}
                  label={copy.adUnit}
                  dir="ltr"
                  value={adUnit}
                  onChange={(e) => setAdUnit(e.target.value)}
                />
              ) : null}
            </>
          ) : null}
          <div className={editorStyles.full}>
            <ActionButton type="submit" disabled={busy}>
              {copy.createPlacement}
            </ActionButton>
          </div>
        </fieldset>
      </form>
      <div className={styles.grid}>
        {placements.map((placement) => (
          <PlacementCard
            key={placement.id}
            placement={placement}
            readRevision={readRevision}
            busy={busy}
            editingDisabled={editingDisabled}
            onAct={onAct}
          />
        ))}
      </div>
      {!placements.length ? <p className={styles.muted}>{copy.noPlacements}</p> : null}
    </section>
  );
}

function PlacementSummary({ placement }: { placement: AdPlacement }) {
  const copy = useCopy();
  const config =
    placement.config && typeof placement.config === "object" && !Array.isArray(placement.config)
      ? (placement.config as Record<string, unknown>)
      : {};
  const demand =
    config.demand && typeof config.demand === "object"
      ? (config.demand as Record<string, unknown>)
      : {};
  const routes = Array.isArray(config.routePatterns)
    ? config.routePatterns.filter((v): v is string => typeof v === "string")
    : [];
  const sizes = Array.isArray(config.sizes)
    ? config.sizes.filter(
        (v): v is number[] =>
          Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number"),
      )
    : [];
  return (
    <Disclosure summary={copy.configuration}>
      <dl className={editorStyles.summary}>
        <dt>{copy.family}</dt>
        <dd>{copy[placement.inventoryFamily]}</dd>
        <dt>{copy.format}</dt>
        <dd>{copy[placement.format]}</dd>
        {routes.length ? (
          <>
            <dt>{copy.routes}</dt>
            <dd dir="ltr">{routes.join(", ")}</dd>
          </>
        ) : null}
        {sizes.length ? (
          <>
            <dt>{copy.sizes}</dt>
            <dd dir="ltr">{sizes.map((s) => s.join(" × ")).join(", ")}</dd>
          </>
        ) : null}
        {demand.source === "HOUSE" || demand.source === "GOOGLE_GPT" ? (
          <>
            <dt>{copy.demand}</dt>
            <dd>{copy[demand.source]}</dd>
          </>
        ) : null}
        {typeof demand.adUnitPath === "string" ? (
          <>
            <dt>{copy.adUnit}</dt>
            <dd dir="ltr">{demand.adUnitPath}</dd>
          </>
        ) : null}
      </dl>
      <p className={styles.muted}>{copy.unsupportedConfig}</p>
    </Disclosure>
  );
}

function PlacementCard({
  placement,
  busy,
  readRevision = 0,
  editingDisabled = busy,
  onAct,
}: {
  placement: AdPlacement;
  busy: boolean;
  readRevision?: number;
  editingDisabled?: boolean;
  onAct: AdvertisingAction;
}) {
  const copy = useCopy(),
    id = useId();
  const incoming = { name: placement.name, format: placement.format };
  const [base, setBase] = useAdvertisingDraft(`placement-${placement.id}-base`, incoming),
    [draft, setDraft] = useAdvertisingDraft(`placement-${placement.id}-draft`, incoming);
  const [acknowledgedRead, setAcknowledgedRead] = useAdvertisingDraft<number | null>(
    `placement-${placement.id}-acknowledged-read`,
    null,
  );
  // The ACK is newer than these props until a subsequent read completes. A
  // genuinely fresh read, even with identical old values, must still reconcile.
  const awaitingRead = acknowledgedRead !== null && readRevision <= acknowledgedRead;
  const dirty = !same(base, draft),
    changed = !awaitingRead && !same(base, incoming);
  if (acknowledgedRead !== null && !awaitingRead) setAcknowledgedRead(null);
  if (changed && !dirty) {
    setBase(incoming);
    setDraft(incoming);
  }
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <h3 dir="auto">{placement.name}</h3>
          <p className={styles.muted}>
            <bdi>{placement.key}</bdi> · {copy[placement.inventoryFamily]}
          </p>
        </div>
        <DataBadge>{placement.enabled ? copy.enabled : copy.disabled}</DataBadge>
      </div>
      {dirty ? <DataBadge tone="warning">{copy.draft}</DataBadge> : null}
      {changed && dirty ? (
        <StatusNotice tone="warning">
          <span>{copy.changed}</span>
          <ActionButton
            disabled={busy}
            onClick={() => {
              setBase(incoming);
              setDraft(incoming);
            }}
          >
            {copy.useSaved}
          </ActionButton>
        </StatusNotice>
      ) : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || changed) return;
          await onAct(
            (c) =>
              c.updateAdPlacement(placement.id, { name: draft.name.trim(), format: draft.format }),
            copy.placementSaved,
            `${copy.save}: ${placement.name} (${placement.key})`,
            () => {
              const saved = { ...draft, name: draft.name.trim() };
              setBase(saved);
              setDraft((current) => (same(current, draft) ? saved : current));
              setAcknowledgedRead(readRevision);
            },
          );
        }}
      >
        <fieldset className={editorStyles.fields} disabled={editingDisabled}>
          <TextField
            id={`${id}-name`}
            label={copy.name}
            required
            minLength={2}
            maxLength={160}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <SelectField
            id={`${id}-format`}
            label={copy.format}
            value={draft.format}
            onChange={(e) =>
              setDraft({ ...draft, format: e.target.value as AdPlacement["format"] })
            }
          >
            {formats.map((value) => (
              <option key={value} value={value}>
                {copy[value]}
              </option>
            ))}
          </SelectField>
          <div className={editorStyles.full}>
            <ActionButton type="submit" disabled={busy || (changed && dirty)}>
              {copy.save}
            </ActionButton>
          </div>
        </fieldset>
      </form>
      <PlacementSummary placement={placement} />
      <ActionButton
        tone={placement.enabled ? "danger" : "secondary"}
        disabled={busy}
        onClick={() =>
          void onAct(
            (c) => c.updateAdPlacement(placement.id, { enabled: !placement.enabled }),
            copy.placementChanged,
            `${placement.enabled ? copy.disable : copy.enable}: ${placement.name} (${placement.key})`,
          )
        }
      >
        {placement.enabled ? copy.disable : copy.enable}
      </ActionButton>
    </article>
  );
}

export function CreativeManager({
  campaigns,
  creatives,
  busy,
  readRevision = 0,
  editingDisabled = busy,
  onAct,
}: {
  campaigns: Campaign[];
  creatives: Creative[];
  busy: boolean;
  readRevision?: number;
  editingDisabled?: boolean;
  onAct: AdvertisingAction;
}) {
  const copy = useCopy();
  const [campaignId, setCampaignId] = useAdvertisingDraft("creative-create-campaign", ""),
    [draft, setDraft] = useAdvertisingDraft<CreativeInput>("creative-create-draft", emptyCreative);
  return (
    <section className={styles.card}>
      <h2>{copy.creativesTitle}</h2>
      <p className={styles.muted}>{copy.creativesDescription}</p>
      <CreativeEditor
        campaigns={campaigns}
        campaignId={campaignId}
        onCampaignChange={setCampaignId}
        draft={draft}
        onChange={setDraft}
        busy={busy}
        editingDisabled={editingDisabled}
        mode="create"
        onSubmit={async () => {
          await onAct(
            (c) => c.createCreative({ ...draft, name: draft.name.trim(), campaignId }),
            copy.creativeCreated,
            `${copy.createCreative}: ${draft.name.trim()} · ${campaigns.find((c) => c.id === campaignId)?.name ?? copy.campaign}`,
            () => setDraft((current) => (same(current, draft) ? emptyCreative() : current)),
          );
        }}
      />
      <div className={styles.grid}>
        {creatives.map((creative) => (
          <CreativeCard
            key={creative.id}
            creative={creative}
            readRevision={readRevision}
            campaigns={campaigns}
            busy={busy}
            editingDisabled={editingDisabled}
            onAct={onAct}
          />
        ))}
      </div>
      {!creatives.length ? <p className={styles.muted}>{copy.noCreatives}</p> : null}
    </section>
  );
}

function CreativeCard({
  creative,
  campaigns,
  busy,
  readRevision = 0,
  editingDisabled = busy,
  onAct,
}: {
  creative: Creative;
  campaigns: Campaign[];
  busy: boolean;
  readRevision?: number;
  editingDisabled?: boolean;
  onAct: AdvertisingAction;
}) {
  const copy = useCopy(),
    { direction } = useI18n();
  const [open, setOpen] = useAdvertisingDraft(`creative-${creative.id}-open`, false),
    [intent, setIntent] = useState<"close" | "delete" | null>(null);
  const incoming = creativeDraft(creative);
  const [base, setBase] = useAdvertisingDraft(`creative-${creative.id}-base`, incoming),
    [draft, setDraft] = useAdvertisingDraft(`creative-${creative.id}-draft`, incoming);
  const [acknowledgedRead, setAcknowledgedRead] = useAdvertisingDraft<number | null>(
    `creative-${creative.id}-acknowledged-read`,
    null,
  );
  // The ACK is newer than these props until a subsequent read completes. A
  // genuinely fresh read, even with identical old values, must still reconcile.
  const awaitingRead = acknowledgedRead !== null && readRevision <= acknowledgedRead;
  const dirty = !same(base, draft),
    changed = !awaitingRead && !same(base, incoming);
  if (acknowledgedRead !== null && !awaitingRead) setAcknowledgedRead(null);
  if (changed && !dirty) {
    setBase(incoming);
    setDraft(incoming);
  }
  const campaign = campaigns.find((c) => c.id === creative.campaignId);
  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <h3 dir="auto">{creative.name}</h3>
          <p className={styles.muted}>
            <bdi>{campaign?.name ?? copy.campaign}</bdi> · {copy[creative.type]}
          </p>
        </div>
        <DataBadge>{copy[creative.status]}</DataBadge>
      </div>
      {dirty ? <DataBadge tone="warning">{copy.draft}</DataBadge> : null}
      <div className={styles.actions}>
        <ActionButton
          tone="secondary"
          disabled={busy}
          aria-expanded={open}
          onClick={() => {
            if (open && dirty) setIntent("close");
            else setOpen(!open);
          }}
        >
          {open ? copy.close : copy.edit}
        </ActionButton>
        <ActionButton tone="danger" disabled={busy} onClick={() => setIntent("delete")}>
          {copy.remove}
        </ActionButton>
      </div>
      {open ? (
        <>
          {changed && dirty ? (
            <StatusNotice tone="warning">
              <span>{copy.changed}</span>
              <ActionButton
                disabled={busy}
                onClick={() => {
                  setBase(incoming);
                  setDraft(incoming);
                }}
              >
                {copy.useSaved}
              </ActionButton>
            </StatusNotice>
          ) : null}
          <CreativeEditor
            campaigns={campaigns}
            draft={draft}
            onChange={setDraft}
            busy={busy}
            editingDisabled={editingDisabled}
            blocked={changed && dirty}
            mode="edit"
            onSubmit={async () => {
              await onAct(
                (c) => c.updateCreative(creative.id, { ...draft, name: draft.name.trim() }),
                copy.creativeSaved,
                `${copy.saveCreative}: ${creative.name}`,
                () => {
                  const saved = { ...draft, name: draft.name.trim() };
                  setBase(saved);
                  setDraft((current) => (same(current, draft) ? saved : current));
                  setAcknowledgedRead(readRevision);
                },
              );
            }}
          />
        </>
      ) : null}
      <ConfirmationDialog
        open={intent !== null}
        direction={direction}
        busy={busy}
        title={intent === "close" ? copy.discardTitle : copy.removeTitle}
        description={`${creative.name}. ${intent === "close" ? copy.discardDescription : copy.removeDescription}`}
        confirmLabel={intent === "close" ? copy.discard : copy.remove}
        cancelLabel={copy.cancel}
        onCancel={() => setIntent(null)}
        onConfirm={() => {
          const action = intent;
          setIntent(null);
          if (action === "close") {
            setDraft(incoming);
            setBase(incoming);
            setOpen(false);
          } else
            void onAct(
              (c) => c.deleteCreative(creative.id),
              copy.removed,
              `${copy.remove}: ${creative.name}`,
            );
        }}
      />
    </article>
  );
}

export function CreativeEditor({
  campaigns,
  campaignId = "",
  onCampaignChange,
  draft,
  onChange,
  busy,
  editingDisabled = busy,
  blocked = false,
  mode,
  onSubmit,
}: {
  campaigns: Campaign[];
  campaignId?: string;
  onCampaignChange?: (id: string) => void;
  draft: CreativeInput;
  onChange: (draft: CreativeInput) => void;
  busy: boolean;
  editingDisabled?: boolean;
  blocked?: boolean;
  mode: "create" | "edit";
  onSubmit: () => Promise<void>;
}) {
  const copy = useCopy(),
    id = useId();
  const [query, setQuery] = useState("");
  const matches = campaigns.filter(
    (c) =>
      c.id === campaignId ||
      `${c.name} ${c.advertiser.name}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const direct = (value: Partial<CreativeInput["direct"]>) =>
    onChange({ ...draft, direct: { ...draft.direct, ...value } });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !blocked && (mode !== "create" || campaigns.some((c) => c.id === campaignId)))
          void onSubmit();
      }}
    >
      <fieldset className={editorStyles.fields} disabled={editingDisabled}>
        {mode === "create" ? (
          <>
            <TextField
              id={`${id}-search`}
              type="search"
              label={copy.campaignSearch}
              hint={copy.campaignWindow}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <SelectField
              id={`${id}-campaign`}
              label={copy.campaign}
              value={campaignId}
              required
              onChange={(e) => onCampaignChange?.(e.target.value)}
            >
              <option value="">{copy.chooseCampaign}</option>
              {matches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.advertiser.name}
                </option>
              ))}
            </SelectField>
            {!matches.length ? <p className={styles.muted}>{copy.noCampaigns}</p> : null}
          </>
        ) : null}
        <TextField
          id={`${id}-name`}
          label={copy.name}
          required
          minLength={2}
          maxLength={160}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
        <SelectField
          id={`${id}-type`}
          label={copy.type}
          value={draft.type}
          onChange={(e) => onChange({ ...draft, type: e.target.value as CreativeType })}
        >
          {(["VIDEO", "DISPLAY", "NATIVE", "VAST_TAG"] as const).map((value) => (
            <option key={value} value={value}>
              {copy[value]}
            </option>
          ))}
        </SelectField>
        <SelectField
          id={`${id}-status`}
          label={copy.status}
          value={draft.status}
          onChange={(e) => onChange({ ...draft, status: e.target.value as CreativeStatus })}
        >
          {(["DRAFT", "ACTIVE", "PAUSED", "REJECTED", "ARCHIVED"] as const).map((value) => (
            <option key={value} value={value}>
              {copy[value]}
            </option>
          ))}
        </SelectField>
        <TextField
          id={`${id}-asset`}
          label={copy.asset}
          type="url"
          dir="ltr"
          maxLength={4096}
          value={draft.direct.assetUrl ?? ""}
          onChange={(e) => direct({ assetUrl: e.target.value || null })}
        />
        <TextField
          id={`${id}-destination`}
          label={copy.destination}
          type="url"
          dir="ltr"
          maxLength={4096}
          value={draft.destinationUrl ?? ""}
          onChange={(e) => onChange({ ...draft, destinationUrl: e.target.value || null })}
        />
        <TextField
          id={`${id}-vast`}
          label={copy.vast}
          type="url"
          dir="ltr"
          maxLength={4096}
          value={draft.vastTagUrl ?? ""}
          onChange={(e) => onChange({ ...draft, vastTagUrl: e.target.value || null })}
        />
        <TextField
          id={`${id}-reference`}
          label={copy.reference}
          hint={copy.referenceHint}
          maxLength={500}
          value={draft.direct.approvedReference ?? ""}
          onChange={(e) => direct({ approvedReference: e.target.value || null })}
        />
        <TextField
          id={`${id}-width`}
          label={copy.width}
          type="number"
          min={1}
          max={4096}
          value={draft.direct.width ?? ""}
          onChange={(e) => direct({ width: e.target.value ? Number(e.target.value) : null })}
        />
        <TextField
          id={`${id}-height`}
          label={copy.height}
          type="number"
          min={1}
          max={4096}
          value={draft.direct.height ?? ""}
          onChange={(e) => direct({ height: e.target.value ? Number(e.target.value) : null })}
        />
        <div className={editorStyles.full}>
          <TextField
            id={`${id}-headline`}
            label={copy.headline}
            maxLength={200}
            value={draft.headline ?? ""}
            onChange={(e) => onChange({ ...draft, headline: e.target.value || null })}
          />
        </div>
        <div className={editorStyles.full}>
          <TextAreaField
            id={`${id}-body`}
            label={copy.body}
            maxLength={2000}
            value={draft.body ?? ""}
            onChange={(e) => onChange({ ...draft, body: e.target.value || null })}
          />
        </div>
        <div className={editorStyles.full}>
          <ActionButton
            type="submit"
            disabled={
              busy ||
              blocked ||
              draft.name.trim().length < 2 ||
              (mode === "create" && !campaigns.some((c) => c.id === campaignId))
            }
          >
            {mode === "create" ? copy.createCreative : copy.saveCreative}
          </ActionButton>
        </div>
      </fieldset>
    </form>
  );
}

export function SellerEditor({
  label,
  value,
  automaticRows,
  finalText,
  busy,
  editingDisabled = busy,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  automaticRows: string[];
  finalText: string;
  busy: boolean;
  editingDisabled?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const copy = useCopy(),
    id = useId();
  return (
    <article className={styles.cardInset}>
      <h3 dir="ltr">{label}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSave();
        }}
      >
        <fieldset disabled={editingDisabled} className={editorStyles.fields}>
          <div className={editorStyles.full}>
            <TextAreaField
              id={`${id}-seller`}
              label={copy.manualSeller}
              hint={copy.sellerHint}
              rows={8}
              spellCheck={false}
              dir="ltr"
              maxLength={64 * 1024}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          <ActionButton disabled={busy} type="submit">
            {copy.publish}
          </ActionButton>
        </fieldset>
      </form>
      <Disclosure summary={copy.automatic}>
        {automaticRows.length ? (
          <pre className={editorStyles.code} dir="ltr">
            {automaticRows.join("\n")}
          </pre>
        ) : (
          <p>{copy.noAutomatic}</p>
        )}
      </Disclosure>
      <Disclosure summary={copy.preview}>
        {finalText ? (
          <pre className={editorStyles.code} dir="ltr">
            {finalText}
          </pre>
        ) : (
          <p>{copy.emptySeller}</p>
        )}
      </Disclosure>
    </article>
  );
}
