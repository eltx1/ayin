"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";

type Placement = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  inventoryFamily: string;
};
type Advertiser = { id: string; name: string; status: string };
type Campaign = { id: string; name: string; status: string; advertiser: { name: string } };
type Overview = {
  emergencyKillSwitch: boolean;
  placements: Placement[];
  eventCounters: Record<string, number>;
};
type SellerFile = {
  kind: "ads" | "app-ads";
  manualText: string;
  automaticRows: string[];
  finalText: string;
};
type SellerFiles = { ads: SellerFile; appAds: SellerFile };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) throw new Error("Advertising control request failed.");
  return response.json() as Promise<unknown>;
}

export function AdminAdvertisingControl() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sellerFiles, setSellerFiles] = useState<SellerFiles | null>(null);
  const [adsText, setAdsText] = useState("");
  const [appAdsText, setAppAdsText] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [selectedAdvertiser, setSelectedAdvertiser] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextAdvertisers, nextCampaigns, nextSellerFiles] = await Promise.all([
        api("/admin/advertising/overview"),
        api("/admin/advertising/advertisers"),
        api("/admin/advertising/campaigns"),
        api("/admin/advertising/authorized-sellers"),
      ]);
      setOverview(nextOverview as Overview);
      setAdvertisers(nextAdvertisers as Advertiser[]);
      setCampaigns(nextCampaigns as Campaign[]);
      const files = nextSellerFiles as SellerFiles;
      setSellerFiles(files);
      setAdsText(files.ads.manualText);
      setAppAdsText(files.appAds.manualText);
    } catch {
      setMessage("Advertising control center could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const mutate = async (path: string, method: string, body?: unknown) => {
    setMessage("");
    try {
      await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      await load();
    } catch {
      setMessage("Change was not saved. Check the input and try again.");
    }
  };

  const saveSellerFile = async (kind: "ads" | "app-ads", text: string) => {
    setMessage("");
    try {
      await api(`/admin/advertising/authorized-sellers/${kind}`, {
        method: "PUT",
        body: JSON.stringify({
          text,
          reason: "Authorized seller file edited in Admin Advertising Control Center",
        }),
      });
      await load();
      setMessage(`${kind}.txt saved and published at the AYIN root domain.`);
    } catch {
      setMessage(
        `${kind}.txt was not saved. Check seller fields, DIRECT/RESELLER values, directives and placeholders.`,
      );
    }
  };

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <header>
        <p>AYIN advertising</p>
        <h1>Advertising Control Center</h1>
        <p>
          Unified inventory, direct campaigns, authorized seller files, event counters and emergency
          controls.
        </p>
        <Link href="/admin/video-ads">Open in-player video defaults and overrides →</Link>
      </header>

      {message ? <p role="status">{message}</p> : null}

      <section>
        <h2>Emergency control</h2>
        <p>Master ads: {overview?.emergencyKillSwitch ? "KILLED" : "operational"}</p>
        <button
          type="button"
          onClick={() =>
            void mutate("/admin/advertising/kill-switch", "PATCH", {
              enabled: !overview?.emergencyKillSwitch,
              reason: "Admin Advertising Control Center action",
            })
          }
        >
          {overview?.emergencyKillSwitch ? "Restore advertising" : "Kill all advertising"}
        </button>
      </section>

      <section>
        <h2>Authorized sellers · ads.txt / app-ads.txt</h2>
        <p>
          Manage SSP/exchange rows and IAB directives here. AYIN validates syntax and rejects obvious
          placeholders before publishing. Google seller rows are generated automatically only from
          real GAM configuration and are shown read-only below.
        </p>
        <p>
          Public web file: <a href="/ads.txt">https://ayin.stream/ads.txt</a>
          {" · "}
          Public app/CTV file: <a href="/app-ads.txt">https://ayin.stream/app-ads.txt</a>
        </p>

        <div style={{ display: "grid", gap: "1.5rem", marginTop: "1rem" }}>
          <SellerEditor
            label="Web ads.txt"
            value={adsText}
            automaticRows={sellerFiles?.ads.automaticRows ?? []}
            finalText={sellerFiles?.ads.finalText ?? ""}
            onChange={setAdsText}
            onSave={() => void saveSellerFile("ads", adsText)}
          />
          <SellerEditor
            label="Apps / CTV app-ads.txt"
            value={appAdsText}
            automaticRows={sellerFiles?.appAds.automaticRows ?? []}
            finalText={sellerFiles?.appAds.finalText ?? ""}
            onChange={setAppAdsText}
            onSave={() => void saveSellerFile("app-ads", appAdsText)}
          />
        </div>
      </section>

      <section>
        <h2>Inventory</h2>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {overview?.placements.map((placement) => (
            <div
              key={placement.id}
              style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
            >
              <strong>{placement.key}</strong>
              <span>{placement.inventoryFamily}</span>
              <span>{placement.enabled ? "Enabled" : "Disabled"}</span>
              <button
                type="button"
                onClick={() =>
                  void mutate(`/admin/advertising/placements/${placement.id}`, "PATCH", {
                    enabled: !placement.enabled,
                  })
                }
              >
                {placement.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Ad events</h2>
        <p>
          {Object.entries(overview?.eventCounters ?? {})
            .map(([event, count]) => `${event}: ${count}`)
            .join(" · ") || "No events yet"}
        </p>
      </section>

      <section>
        <h2>Advertisers</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!advertiserName.trim()) return;
            void mutate("/admin/advertising/advertisers", "POST", { name: advertiserName });
            setAdvertiserName("");
          }}
        >
          <input
            aria-label="Advertiser name"
            value={advertiserName}
            onChange={(event) => setAdvertiserName(event.target.value)}
            placeholder="Advertiser name"
          />
          <button type="submit">Create advertiser</button>
        </form>
        {advertisers.map((advertiser) => (
          <p key={advertiser.id}>
            <strong>{advertiser.name}</strong> · {advertiser.status}
          </p>
        ))}
      </section>

      <section>
        <h2>Direct campaigns</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!campaignName.trim() || !selectedAdvertiser) return;
            void mutate("/admin/advertising/campaigns", "POST", {
              advertiserId: selectedAdvertiser,
              name: campaignName,
              direct: {
                priority: 100,
                pricing: { model: "CPM", cpm: "1.000000", fixedPrice: null },
                impressionGoal: null,
                frequencyCap: 3,
                pacing: "EVEN",
                targeting: {},
              },
            });
            setCampaignName("");
          }}
        >
          <select
            aria-label="Advertiser"
            value={selectedAdvertiser}
            onChange={(event) => setSelectedAdvertiser(event.target.value)}
          >
            <option value="">Select advertiser</option>
            {advertisers.map((advertiser) => (
              <option value={advertiser.id} key={advertiser.id}>
                {advertiser.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Campaign name"
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
            placeholder="Campaign name"
          />
          <button type="submit">Create draft campaign</button>
        </form>
        {campaigns.map((campaign) => (
          <div key={campaign.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <strong>{campaign.name}</strong>
            <span>{campaign.advertiser.name}</span>
            <span>{campaign.status}</span>
            {campaign.status === "ACTIVE" || campaign.status === "PAUSED" ? (
              <button
                type="button"
                onClick={() =>
                  void mutate(`/admin/advertising/campaigns/${campaign.id}`, "PATCH", {
                    status: campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                  })
                }
              >
                {campaign.status === "ACTIVE" ? "Pause" : "Resume"}
              </button>
            ) : campaign.status === "DRAFT" ? (
              <button
                type="button"
                onClick={() =>
                  void mutate(`/admin/advertising/campaigns/${campaign.id}`, "PATCH", {
                    status: "ACTIVE",
                  })
                }
              >
                Activate
              </button>
            ) : null}
          </div>
        ))}
      </section>

      <section>
        <h2>Creative API</h2>
        <p>
          Video/display/native/VAST creative CRUD, approved references, asset URLs and activation
          are available through the protected Admin Advertising API. This surface deliberately
          avoids inventing production asset references.
        </p>
      </section>
    </div>
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
    <div style={{ display: "grid", gap: "0.65rem" }}>
      <h3 style={{ margin: 0 }}>{label}</h3>
      <label style={{ display: "grid", gap: "0.4rem" }}>
        <span>Manual seller rows / IAB directives</span>
        <textarea
          rows={8}
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={"OWNERDOMAIN=ayin.stream\n# Add only seller rows supplied by your real SSP/exchange"}
          style={{ fontFamily: "monospace", minHeight: "10rem", width: "100%" }}
        />
      </label>
      <button type="button" onClick={onSave} style={{ justifySelf: "start" }}>
        Validate & publish
      </button>
      <div>
        <strong>Automatic GAM rows</strong>
        <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>
          {automaticRows.length > 0 ? automaticRows.join("\n") : "None — GAM seller data is not configured yet."}
        </pre>
      </div>
      <details>
        <summary>Published-file preview</summary>
        <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>
          {finalText || "(empty file — no seller relationship is being claimed)"}
        </pre>
      </details>
    </div>
  );
}
