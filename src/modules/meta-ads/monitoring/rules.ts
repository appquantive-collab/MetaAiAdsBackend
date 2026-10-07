import type { Insight } from "../meta/client.ts";
import type { ProposedAction } from "../guardrails.ts";

export const FATIGUE_FREQUENCY = 3;
export const PAUSE_SPEND_MULTIPLE = 2;

/** Deterministic optimization rules. The AI only explains these; it never creates actions. */
export function evaluateRules(
  insights: Insight[],
  targetCpaInr: number,
  adSetBudgets: Record<string, number>,
): ProposedAction[] {
  const actions: ProposedAction[] = [];
  const pausedAds = new Set<string>();

  for (const i of insights) {
    if (i.results === 0 && i.spend >= PAUSE_SPEND_MULTIPLE * targetCpaInr) {
      pausedAds.add(i.adId);
      actions.push({
        type: "pause_ad", adId: i.adId,
        reason: `Spent ₹${i.spend.toFixed(0)} (over ${PAUSE_SPEND_MULTIPLE}x target ₹${targetCpaInr}) with no results`,
      });
    } else if (i.frequency > FATIGUE_FREQUENCY) {
      actions.push({
        type: "refresh_creative", adId: i.adId,
        reason: `Frequency ${i.frequency.toFixed(1)} is above ${FATIGUE_FREQUENCY}: people are seeing this ad too often`,
      });
    }
  }

  // Shift budget toward ad sets that beat target CPA with enough evidence (+10%).
  const bySet = new Map<string, { spend: number; results: number }>();
  for (const i of insights) {
    const s = bySet.get(i.adSetId) ?? { spend: 0, results: 0 };
    s.spend += i.spend;
    s.results += i.results;
    bySet.set(i.adSetId, s);
  }
  for (const [adSetId, s] of bySet) {
    const budget = adSetBudgets[adSetId];
    if (budget && s.results >= 5 && s.spend / s.results < 0.7 * targetCpaInr) {
      actions.push({
        type: "set_budget", adSetId, fromInr: budget, toInr: Math.round(budget * 1.1),
        reason: `Cost per result ₹${(s.spend / s.results).toFixed(0)} is well under target ₹${targetCpaInr}`,
      });
    }
  }
  return actions;
}
