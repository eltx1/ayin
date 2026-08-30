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
  const [advertiserName, setAdvertiserName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [selectedAdvertiser, setSelectedAdvertiser] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextAdvertisers, nextCampaigns] = await Promise.all([
        api("/admin/advertising/overview"),
        api("/admin/advertising/advertisers"),
        api("/admin/advertising/campaigns"),
      ]);
      setOverview(nextOverview as Overview);
      setAdvertisers(nextAdvertisers as Advertiser[]);
      setCampaigns(nextCampaigns as Campaign[]);
    } catch {
      setMessage("Advertising control center could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
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

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <header>
        <p>AYIN advertising</p>
        <h1>Advertising Control Center</h1>
        <p>Unified inventory, direct campaigns, event counters and emergency controls.</p>
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
