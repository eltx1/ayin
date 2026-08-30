from pathlib import Path

path = Path("apps/api/src/ads/advertising-control.service.ts")
source = path.read_text()

old_campaigns = '''    return campaigns.map((campaign) => ({
      ...campaign,
      direct: byCampaign.get(campaign.id) ?? null,
    }));'''
new_campaigns = '''    return campaigns.map((campaign) => {
      const direct = byCampaign.get(campaign.id);
      return {
        ...campaign,
        direct: direct
          ? {
              ...direct,
              impressionGoal: direct.impressionGoal === null ? null : Number(direct.impressionGoal),
            }
          : null,
      };
    });'''
if old_campaigns not in source:
    raise SystemExit("listCampaigns patch target not found")
source = source.replace(old_campaigns, new_campaigns, 1)

old_decision = '''    if (await this.isEmergencyKilled())
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" };
    const campaigns = await this.database.client.campaign.findMany({'''
new_decision = '''    if (await this.isEmergencyKilled())
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" };
    const placement = await this.database.client.adPlacement.findUnique({
      where: { key: context.placementKey },
      select: { enabled: true },
    });
    if (!placement?.enabled)
      return { enabled: false as const, reason: "PLACEMENT_DISABLED" };
    const campaigns = await this.database.client.campaign.findMany({'''
if old_decision not in source:
    raise SystemExit("decideDirectAd patch target not found")
path.write_text(source.replace(old_decision, new_decision, 1))
