import type { PlanName } from "../../platform/plans.ts";

/** Meta Ads AI's own operating limits per plan tier — separate from the platform's automation-count cap. */
export type MetaAdsLimits = { maxLiveCampaigns: number; maxDailySpendInr: number };

export const META_ADS_LIMITS: Record<PlanName, MetaAdsLimits> = {
  starter: { maxLiveCampaigns: 1, maxDailySpendInr: 1000 },
  growth: { maxLiveCampaigns: 5, maxDailySpendInr: 5000 },
  pro: { maxLiveCampaigns: 25, maxDailySpendInr: 25000 },
};
