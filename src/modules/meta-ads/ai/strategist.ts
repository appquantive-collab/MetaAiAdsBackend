import { BusinessProfile, CampaignPlan } from "../schemas.ts";
import { askJson, hasClaude } from "./claude.ts";

const SYSTEM = `You are a Meta Ads strategist for small Indian businesses.
Output a campaign plan as JSON with keys: objective, optimizationGoal, destinationType,
targeting{mode,geo{city,radiusKm},ageMin,ageMax,interests[]}, placements, dailyBudgetInr,
durationDays, targetCpaInr, rationale.
Rules: whatsapp_messages => objective OUTCOME_ENGAGEMENT, optimizationGoal CONVERSATIONS, destinationType WHATSAPP.
lead_forms => OUTCOME_LEADS, LEAD_GENERATION, ON_AD. Prefer advantage_plus for budgets under ₹1000/day.
Never exceed the owner's budget. Housing/employment/credit/politics categories must not use age or interest narrowing.`;

export function fallbackPlan(p: BusinessProfile): CampaignPlan {
  const wa = p.goal === "whatsapp_messages";
  return {
    objective: wa ? "OUTCOME_ENGAGEMENT" : "OUTCOME_LEADS",
    optimizationGoal: wa ? "CONVERSATIONS" : "LEAD_GENERATION",
    destinationType: wa ? "WHATSAPP" : "ON_AD",
    targeting: { mode: "advantage_plus", geo: { city: p.city, radiusKm: 15 }, ageMin: 18, ageMax: 55, interests: [] },
    placements: "automatic",
    dailyBudgetInr: p.dailyBudgetInr,
    durationDays: 14,
    targetCpaInr: Math.round(p.dailyBudgetInr / 3),
    rationale: "Default plan: broad Advantage+ audience within the city so Meta's delivery can learn quickly.",
  };
}

/** Applies hard rules that must hold whatever the model returned. */
export function sanitizePlan(plan: CampaignPlan, p: BusinessProfile): CampaignPlan {
  const out = { ...plan, dailyBudgetInr: Math.min(plan.dailyBudgetInr, p.dailyBudgetInr) };
  if (p.specialCategory !== "NONE") {
    out.targeting = { ...out.targeting, mode: "advantage_plus", ageMin: 18, ageMax: 65, interests: [] };
  }
  return out;
}

export async function planCampaign(profile: BusinessProfile): Promise<CampaignPlan> {
  const plan = hasClaude()
    ? await askJson(SYSTEM, `Business profile:\n${JSON.stringify(profile)}`, CampaignPlan)
    : fallbackPlan(profile);
  return sanitizePlan(plan, profile);
}
