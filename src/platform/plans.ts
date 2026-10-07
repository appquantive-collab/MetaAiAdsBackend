export type PlanName = "starter" | "growth" | "pro";

/**
 * Generic, automation-agnostic plan shape: caps how many automations an org can have
 * active at once, plus price. Automation-specific limits (e.g. Meta Ads AI's daily spend
 * cap, live-campaign cap) live in that module's own config, not here.
 */
export type Plan = { maxActiveAutomations: number; priceInrPerMonth: number };

// Placeholder tier definitions — real numbers to be set later.
export const PLANS: Record<PlanName, Plan> = {
  starter: { maxActiveAutomations: 1, priceInrPerMonth: 1999 },
  growth: { maxActiveAutomations: 5, priceInrPerMonth: 5999 },
  pro: { maxActiveAutomations: 25, priceInrPerMonth: 14999 },
};
