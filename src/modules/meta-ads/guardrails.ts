import type { CampaignPlan, Limits } from "./schemas.ts";

export type ProposedAction =
  | { type: "pause_ad"; adId: string; reason: string }
  | { type: "set_budget"; adSetId: string; fromInr: number; toInr: number; reason: string }
  | { type: "refresh_creative"; adId: string; reason: string };

export type Decision = { allowed: boolean; needsApproval: boolean; reason?: string };

export const DEFAULT_LIMITS: Limits = { maxDailySpendInr: 2000, maxDailyChangePct: 20, autoApply: false };

/** Pure code: validates a plan before launch, regardless of what the AI proposed. */
export function checkPlan(plan: CampaignPlan, limits: Limits, killSwitch: boolean): Decision {
  if (killSwitch) return { allowed: false, needsApproval: false, reason: "Kill switch is on" };
  if (plan.dailyBudgetInr > limits.maxDailySpendInr)
    return { allowed: false, needsApproval: false, reason: `Budget exceeds max daily spend ₹${limits.maxDailySpendInr}` };
  if (plan.targeting.ageMin > plan.targeting.ageMax)
    return { allowed: false, needsApproval: false, reason: "ageMin > ageMax" };
  return { allowed: true, needsApproval: true }; // launch always needs owner approval
}

/** Pure code: decides whether an optimization action may run, and whether the owner must approve it. */
export function checkAction(
  a: ProposedAction,
  limits: Limits,
  ctx: { killSwitch: boolean; budgetChangedTodayPct: number; totalDailyBudgetInr: number },
): Decision {
  if (ctx.killSwitch) return { allowed: false, needsApproval: false, reason: "Kill switch is on" };
  if (a.type === "set_budget") {
    const delta = a.toInr - a.fromInr;
    const newTotal = ctx.totalDailyBudgetInr + delta;
    if (newTotal > limits.maxDailySpendInr)
      return { allowed: false, needsApproval: false, reason: "Would exceed max daily spend" };
    const pct = a.fromInr > 0 ? (Math.abs(delta) / a.fromInr) * 100 : 100;
    if (ctx.budgetChangedTodayPct + pct > limits.maxDailyChangePct)
      return { allowed: false, needsApproval: false, reason: "Would exceed max daily budget change" };
    // Any spend increase always needs approval, even with autoApply.
    if (delta > 0) return { allowed: true, needsApproval: true, reason: "Spend increase needs approval" };
  }
  return { allowed: true, needsApproval: !limits.autoApply };
}
