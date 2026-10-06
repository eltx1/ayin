"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure } from "@/components/ui/data-presentation";
import {
  ActionButton,
  FormSection,
  SelectField,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import type {
  AdDevice,
  AdPlacement,
  Advertiser,
  AdvertiserStatus,
  CampaignStatus,
} from "@/lib/admin-advertising";
import type { searchVideoAdTargets } from "@/lib/admin-video-ad-workspace";
import {
  adminDirectCampaignAr,
  adminDirectCampaignEn,
} from "@/lib/i18n/resources/admin-direct-campaign";

import styles from "./admin-direct-campaign-fields.module.css";

// Inputs remain strings until the workspace validates a reviewed command. In
// particular, decimal amounts must never pass through a floating-point number.
export type CampaignDraft = {
  advertiserId: string;
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

export type AdvertiserDraft = { name: string; status: AdvertiserStatus };
export type CampaignTargetMatches = Awaited<ReturnType<typeof searchVideoAdTargets>>;
export type CampaignTargetSearch = (query: string) => Promise<CampaignTargetMatches>;

const campaignStatuses: CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];
const advertiserStatuses: AdvertiserStatus[] = ["ACTIVE", "PAUSED", "DISABLED"];
const devices: AdDevice[] = ["MOBILE", "DESKTOP", "TV"];
const decimalPattern = "[0-9]+(?:\\.[0-9]{1,6})?";

function placementKeys(value: string) {
  return new Set(
    value
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

export function AdvertiserFields({
  draft,
  onChange,
  disabled,
}: {
  draft: AdvertiserDraft;
  onChange: (draft: AdvertiserDraft) => void;
  disabled: boolean;
}) {
  const { locale } = useI18n();
  const copy = locale === "ar" ? adminDirectCampaignAr : adminDirectCampaignEn;
  const id = useId();
  return (
    <FormSection id={`${id}-advertiser`} legend={copy.advertiserDetails} disabled={disabled}>
      <TextField
        id={`${id}-name`}
        label={copy.advertiserName}
        required
        minLength={2}
        maxLength={160}
        dir="auto"
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />
      <Disclosure summary={copy.advertiserOptions}>
        <SelectField
          id={`${id}-status`}
          label={copy.advertiserStatus}
          value={draft.status}
          onChange={(event) =>
            onChange({ ...draft, status: event.target.value as AdvertiserStatus })
          }
        >
          {advertiserStatuses.map((status) => (
            <option key={status} value={status}>
              {copy.advertiserStatuses[status]}
            </option>
          ))}
        </SelectField>
      </Disclosure>
    </FormSection>
  );
}

export function DirectCampaignFields({
  draft,
  onChange,
  advertiserOptions,
  placements,
  targetSearch,
  disabled,
  creating,
}: {
  draft: CampaignDraft;
  onChange: (draft: CampaignDraft) => void;
  advertiserOptions: readonly Advertiser[];
  placements: readonly AdPlacement[];
  targetSearch: CampaignTargetSearch;
  disabled: boolean;
  creating: boolean;
}) {
  const { locale } = useI18n();
  const copy = locale === "ar" ? adminDirectCampaignAr : adminDirectCampaignEn;
  const id = useId();
  const [advertiserQuery, setAdvertiserQuery] = useState("");
  const selectedKeys = useMemo(() => placementKeys(draft.placementKeys), [draft.placementKeys]);
  const knownPlacementKeys = new Set(placements.map((placement) => placement.key));
  const savedPlacementKeys = [...selectedKeys].filter((key) => !knownPlacementKeys.has(key));
  const matchingAdvertisers = advertiserOptions.filter((advertiser) =>
    advertiser.name
      .toLocaleLowerCase(locale)
      .includes(advertiserQuery.trim().toLocaleLowerCase(locale)),
  );
  // Filtering never removes the selected option, including when it no longer
  // appears in the fetched directory. Its ID remains visible without a fake name.
  const visibleAdvertisers = advertiserOptions.filter(
    (advertiser) =>
      advertiser.id === draft.advertiserId || matchingAdvertisers.includes(advertiser),
  );
  const missingAdvertiser =
    draft.advertiserId &&
    !advertiserOptions.some((advertiser) => advertiser.id === draft.advertiserId);

  function setPlacement(key: string, checked: boolean) {
    const next = new Set(selectedKeys);
    if (checked) next.add(key);
    else next.delete(key);
    onChange({ ...draft, placementKeys: [...next].join(", ") });
  }

  return (
    <div
      className={styles.fields}
      onInvalidCapture={(event) => {
        // Native constraints must be able to focus an invalid advanced field.
        let disclosure = (event.target as HTMLElement).closest("details");
        while (disclosure) {
          disclosure.open = true;
          disclosure = disclosure.parentElement?.closest("details") ?? null;
        }
      }}
    >
      <FormSection
        id={`${id}-basics`}
        legend={copy.campaignDetails}
        {...(creating ? { description: copy.campaignBasics } : {})}
        disabled={disabled}
      >
        <TextField
          id={`${id}-name`}
          label={copy.campaignName}
          required
          minLength={2}
          maxLength={160}
          dir="auto"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        {creating ? (
          <TextField
            id={`${id}-advertiser-search`}
            type="search"
            label={copy.advertiserSearch}
            hint={copy.advertiserSearchHint}
            value={advertiserQuery}
            maxLength={200}
            dir="auto"
            onChange={(event) => setAdvertiserQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        ) : null}
        <SelectField
          id={`${id}-advertiser`}
          label={copy.advertiser}
          {...(!creating ? { hint: copy.advertiserFixed } : {})}
          required
          disabled={disabled || !creating}
          value={draft.advertiserId}
          onChange={(event) => onChange({ ...draft, advertiserId: event.target.value })}
        >
          <option value="">{copy.chooseAdvertiser}</option>
          {missingAdvertiser ? (
            <option value={draft.advertiserId}>
              {copy.savedAdvertiserId}: {draft.advertiserId}
            </option>
          ) : null}
          {visibleAdvertisers.map((advertiser) => (
            <option key={advertiser.id} value={advertiser.id}>
              {advertiser.name} · {copy.advertiserStatuses[advertiser.status]}
            </option>
          ))}
        </SelectField>
        {creating && !matchingAdvertisers.length ? (
          <p className={styles.hint} role="status">
            {copy.noAdvertisers}
          </p>
        ) : null}
      </FormSection>

      <Disclosure summary={copy.campaignStatusOptions}>
        <FormSection id={`${id}-status-section`} legend={copy.campaignStatus} disabled={disabled}>
          <SelectField
            id={`${id}-status`}
            label={copy.campaignStatus}
            hint={copy.draftHint}
            value={draft.status}
            onChange={(event) =>
              onChange({ ...draft, status: event.target.value as CampaignStatus })
            }
          >
            {campaignStatuses.map((status) => (
              <option key={status} value={status}>
                {copy.campaignStatuses[status]}
              </option>
            ))}
          </SelectField>
        </FormSection>
      </Disclosure>

      <Disclosure summary={copy.schedule}>
        <FormSection
          id={`${id}-schedule`}
          legend={copy.scheduleFields}
          description={copy.scheduleHint}
          disabled={disabled}
        >
          <div className={styles.grid}>
            <TextField
              id={`${id}-starts`}
              label={copy.startsAt}
              type="datetime-local"
              step="0.001"
              dir="ltr"
              value={draft.startsAt}
              onChange={(event) => onChange({ ...draft, startsAt: event.target.value })}
            />
            <TextField
              id={`${id}-ends`}
              label={copy.endsAt}
              type="datetime-local"
              step="0.001"
              dir="ltr"
              value={draft.endsAt}
              onChange={(event) => onChange({ ...draft, endsAt: event.target.value })}
            />
          </div>
        </FormSection>
      </Disclosure>

      <Disclosure summary={copy.pricing}>
        <FormSection
          id={`${id}-pricing`}
          legend={copy.pricingFields}
          description={copy.pricingHint}
          disabled={disabled}
        >
          <div className={styles.grid}>
            <TextField
              id={`${id}-budget`}
              label={copy.budget}
              hint={copy.budgetHint}
              inputMode="decimal"
              pattern={decimalPattern}
              maxLength={40}
              dir="ltr"
              value={draft.budget}
              onChange={(event) => onChange({ ...draft, budget: event.target.value })}
            />
            <TextField
              id={`${id}-currency`}
              label={copy.currency}
              hint={copy.currencyHint}
              minLength={3}
              maxLength={3}
              dir="ltr"
              autoCapitalize="characters"
              value={draft.currency}
              onChange={(event) => onChange({ ...draft, currency: event.target.value })}
            />
            <SelectField
              id={`${id}-pricing-model`}
              label={copy.pricingModel}
              value={draft.pricingModel}
              onChange={(event) =>
                onChange({
                  ...draft,
                  pricingModel: event.target.value as CampaignDraft["pricingModel"],
                })
              }
            >
              <option value="CPM">{copy.cpm}</option>
              <option value="FIXED">{copy.fixed}</option>
            </SelectField>
            <TextField
              id={`${id}-rate`}
              label={draft.pricingModel === "CPM" ? copy.rate : copy.fixedRate}
              required
              inputMode="decimal"
              pattern={decimalPattern}
              maxLength={40}
              dir="ltr"
              value={draft.rate}
              onChange={(event) => onChange({ ...draft, rate: event.target.value })}
            />
          </div>
        </FormSection>
      </Disclosure>

      <Disclosure summary={copy.delivery}>
        <FormSection id={`${id}-delivery`} legend={copy.deliveryFields} disabled={disabled}>
          <div className={styles.grid}>
            <TextField
              id={`${id}-priority`}
              label={copy.priority}
              hint={copy.priorityHint}
              type="number"
              min={1}
              max={1000}
              step={1}
              required
              value={draft.priority}
              onChange={(event) => onChange({ ...draft, priority: event.target.value })}
            />
            <TextField
              id={`${id}-goal`}
              label={copy.impressionGoal}
              hint={copy.impressionGoalHint}
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              value={draft.impressionGoal}
              onChange={(event) => onChange({ ...draft, impressionGoal: event.target.value })}
            />
            <TextField
              id={`${id}-frequency`}
              label={copy.frequencyCap}
              hint={copy.frequencyCapHint}
              type="number"
              min={0}
              max={100}
              step={1}
              required
              value={draft.frequencyCap}
              onChange={(event) => onChange({ ...draft, frequencyCap: event.target.value })}
            />
            <SelectField
              id={`${id}-pacing`}
              label={copy.pacing}
              value={draft.pacing}
              onChange={(event) =>
                onChange({ ...draft, pacing: event.target.value as CampaignDraft["pacing"] })
              }
            >
              <option value="EVEN">{copy.even}</option>
              <option value="ASAP">{copy.asap}</option>
            </SelectField>
          </div>
        </FormSection>
      </Disclosure>

      <Disclosure summary={copy.targeting}>
        <FormSection
          id={`${id}-targeting`}
          legend={copy.targetingFields}
          description={copy.targetingHint}
          disabled={disabled}
        >
          <FormSection
            id={`${id}-placements`}
            legend={copy.placements}
            description={copy.placementsHint}
          >
            <div className={styles.choices}>
              {placements.map((placement) => (
                <label className={styles.choice} key={placement.key}>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(placement.key)}
                    onChange={(event) => setPlacement(placement.key, event.target.checked)}
                  />
                  <span className={styles.choiceText}>
                    <bdi>{placement.name}</bdi>
                    <small>
                      <bdi dir="ltr">{placement.key}</bdi>
                    </small>
                    {!placement.enabled ? <small>{copy.placementDisabled}</small> : null}
                  </span>
                </label>
              ))}
              {savedPlacementKeys.map((key) => (
                <label className={styles.choice} key={key}>
                  <input
                    type="checkbox"
                    checked
                    onChange={(event) => setPlacement(key, event.target.checked)}
                  />
                  <span className={styles.choiceText}>
                    <bdi dir="ltr">{key}</bdi>
                    <small>{copy.savedPlacement}</small>
                  </span>
                </label>
              ))}
            </div>
            {!placements.length && !savedPlacementKeys.length ? (
              <p className={styles.hint}>{copy.noPlacements}</p>
            ) : null}
          </FormSection>
          <div className={styles.grid}>
            <TextField
              id={`${id}-countries`}
              label={copy.countries}
              hint={copy.countriesHint}
              dir="ltr"
              value={draft.countries}
              onChange={(event) => onChange({ ...draft, countries: event.target.value })}
            />
            <TextField
              id={`${id}-regions`}
              label={copy.regions}
              hint={copy.regionsHint}
              dir="auto"
              value={draft.regions}
              onChange={(event) => onChange({ ...draft, regions: event.target.value })}
            />
            <TextField
              id={`${id}-categories`}
              label={copy.categories}
              hint={copy.categoriesHint}
              dir="auto"
              value={draft.categories}
              onChange={(event) => onChange({ ...draft, categories: event.target.value })}
            />
          </div>
          <FormSection id={`${id}-devices`} legend={copy.devices}>
            <div className={styles.choices}>
              {devices.map((device) => (
                <label className={styles.choice} key={device}>
                  <input
                    type="checkbox"
                    checked={draft.devices.includes(device)}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        devices: event.target.checked
                          ? [...new Set([...draft.devices, device])]
                          : draft.devices.filter((item) => item !== device),
                      })
                    }
                  />
                  {copy.deviceNames[device]}
                </label>
              ))}
            </div>
          </FormSection>
          <CampaignTargetFields
            draft={draft}
            onChange={onChange}
            targetSearch={targetSearch}
            disabled={disabled}
          />
        </FormSection>
      </Disclosure>
    </div>
  );
}

function CampaignTargetFields({
  draft,
  onChange,
  targetSearch,
  disabled,
}: {
  draft: CampaignDraft;
  onChange: (draft: CampaignDraft) => void;
  targetSearch: CampaignTargetSearch;
  disabled: boolean;
}) {
  const { locale } = useI18n();
  const copy = locale === "ar" ? adminDirectCampaignAr : adminDirectCampaignEn;
  const id = useId();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CampaignTargetMatches | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [labels, setLabels] = useState<{
    channels: Record<string, string>;
    videos: Record<string, string>;
  }>({ channels: {}, videos: {} });
  const request = useRef(0);
  const searching = useRef(false);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  useEffect(() => {
    let active = true;
    if (disabled) {
      const observed = ++request.current;
      searching.current = false;
      void Promise.resolve().then(() => {
        if (!active || request.current !== observed) return;
        setState("idle");
        setMatches(null);
      });
    }
    return () => {
      active = false;
    };
  }, [disabled]);

  function changeQuery(value: string) {
    request.current += 1;
    searching.current = false;
    setQuery(value);
    setState("idle");
    setMatches(null);
  }

  async function search() {
    if (disabled || searching.current || query.trim().length < 2) return;
    const current = ++request.current;
    searching.current = true;
    setState("loading");
    setMatches(null);
    try {
      const result = await targetSearch(query.trim());
      if (current !== request.current) return;
      const bounded = {
        channels: result.channels.slice(0, 12),
        videos: result.videos.slice(0, 12),
      };
      setMatches(bounded);
      setLabels((previous) => ({
        channels: {
          ...previous.channels,
          ...Object.fromEntries(
            bounded.channels.map((channel) => [channel.id, `${channel.name} (@${channel.handle})`]),
          ),
        },
        videos: {
          ...previous.videos,
          ...Object.fromEntries(
            bounded.videos.map((video) => [video.id, `${video.title} (@${video.channel.handle})`]),
          ),
        },
      }));
      setState("ready");
    } catch {
      if (current === request.current) setState("error");
    } finally {
      if (current === request.current) searching.current = false;
    }
  }

  return (
    <FormSection
      id={`${id}-targets`}
      legend={copy.contentTargets}
      description={copy.targetIdHint}
      disabled={disabled}
    >
      <div className={styles.search}>
        <TextField
          id={`${id}-query`}
          label={copy.targetSearch}
          hint={copy.targetSearchHint}
          type="search"
          maxLength={200}
          dir="auto"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
        <ActionButton
          type="button"
          tone="secondary"
          pending={state === "loading"}
          disabled={disabled || query.trim().length < 2}
          onClick={() => void search()}
        >
          {copy.searchTargets}
        </ActionButton>
      </div>
      {state === "loading" ? (
        <StatusNotice announce="polite">{copy.searchingTargets}</StatusNotice>
      ) : null}
      {state === "error" ? (
        <StatusNotice tone="danger" announce="polite">
          {copy.targetSearchError}
        </StatusNotice>
      ) : null}
      {state === "ready" && matches && !matches.channels.length && !matches.videos.length ? (
        <StatusNotice announce="polite">{copy.noTargetMatches}</StatusNotice>
      ) : null}
      {state === "ready" &&
      matches &&
      (matches.channels.length > 0 || matches.videos.length > 0) ? (
        <div className={styles.grid} role="region" aria-label={copy.targetResults}>
          {(["channels", "videos"] as const).map((kind) => {
            const results = matches[kind];
            const selected = kind === "channels" ? draft.channelIds : draft.videoIds;
            return results.length ? (
              <div className={styles.targetGroup} key={kind}>
                <h3>{kind === "channels" ? copy.matchingChannels : copy.matchingVideos}</h3>
                <ul className={styles.targets}>
                  {results.map((target) => (
                    <li key={target.id}>
                      <span className={styles.targetText}>
                        <bdi>{labels[kind][target.id]}</bdi>
                        <small>
                          <bdi dir="ltr">{target.id}</bdi>
                        </small>
                      </span>
                      <ActionButton
                        type="button"
                        tone="secondary"
                        disabled={disabled || selected.includes(target.id)}
                        aria-label={`${selected.includes(target.id) ? copy.selected : copy.add}: ${labels[kind][target.id]}`}
                        onClick={() =>
                          onChange({
                            ...draft,
                            [kind === "channels" ? "channelIds" : "videoIds"]: [
                              ...new Set([...selected, target.id]),
                            ],
                          })
                        }
                      >
                        {selected.includes(target.id) ? copy.selected : copy.add}
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })}
        </div>
      ) : null}
      <div className={styles.grid}>
        {(["channels", "videos"] as const).map((kind) => {
          const selected = kind === "channels" ? draft.channelIds : draft.videoIds;
          const fallback = kind === "channels" ? copy.savedChannelId : copy.savedVideoId;
          return (
            <div className={styles.targetGroup} key={kind}>
              <h3>
                {kind === "channels" ? copy.selectedChannels : copy.selectedVideos} (
                {selected.length})
              </h3>
              {selected.length ? (
                <ul className={styles.targets}>
                  {selected.map((targetId) => (
                    <li key={targetId}>
                      <span className={styles.targetText}>
                        <bdi>{labels[kind][targetId] ?? fallback}</bdi>
                        <small>
                          <bdi dir="ltr">{targetId}</bdi>
                        </small>
                      </span>
                      <ActionButton
                        type="button"
                        tone="quiet"
                        disabled={disabled}
                        aria-label={`${copy.remove}: ${labels[kind][targetId] ?? `${fallback} ${targetId}`}`}
                        onClick={() =>
                          onChange({
                            ...draft,
                            [kind === "channels" ? "channelIds" : "videoIds"]: selected.filter(
                              (value) => value !== targetId,
                            ),
                          })
                        }
                      >
                        {copy.remove}
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.hint}>
                  {kind === "channels" ? copy.noSelectedChannels : copy.noSelectedVideos}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </FormSection>
  );
}
