import type { MarketingApi } from "./meta/client.ts";
import type { AdVariation, BusinessProfile, CampaignPlan, Limits } from "./schemas.ts";
import { checkPlan } from "./guardrails.ts";

export type LaunchResult = { campaignId: string; adSetId: string; adIds: string[] };
export type MediaRef = { imageHash?: string; imageUrl?: string };

/** Creates everything PAUSED, then activates only after all pieces exist. Plain code, no AI. */
export async function launchCampaign(args: {
  api: MarketingApi; token: string; accountId: string; profile: BusinessProfile; plan: CampaignPlan;
  ads: AdVariation[]; media: MediaRef; limits: Limits; killSwitch: boolean;
}): Promise<LaunchResult> {
  const { api, token, accountId, profile, plan, ads, media } = args;
  const gate = checkPlan(plan, args.limits, args.killSwitch);
  if (!gate.allowed) throw new Error(`Launch blocked: ${gate.reason}`);
  if (!profile.pageId) throw new Error("Facebook Page is required");
  if (plan.destinationType === "WHATSAPP" && !profile.whatsappNumber) throw new Error("WhatsApp number is required");
  if (!media.imageHash && !media.imageUrl) throw new Error("An image is required");

  const cityKey = await api.resolveCity(token, plan.targeting.geo.city);
  const campaignId = await api.createCampaign(token, accountId, {
    name: `${profile.name} - ${plan.objective} - ${new Date().toISOString().slice(0, 10)}`,
    objective: plan.objective,
    specialCategory: profile.specialCategory,
  });

  const start = new Date();
  const end = new Date(start.getTime() + plan.durationDays * 86400_000);
  const t = plan.targeting;
  const adSetId = await api.createAdSet(token, accountId, {
    name: `${profile.name} ad set`,
    campaign_id: campaignId,
    daily_budget: Math.round(plan.dailyBudgetInr * 100), // INR minor units (paise)
    billing_event: "IMPRESSIONS",
    optimization_goal: plan.optimizationGoal,
    destination_type: plan.destinationType,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    promoted_object: { page_id: profile.pageId },
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    targeting: {
      geo_locations: { cities: [{ key: cityKey, radius: t.geo.radiusKm, distance_unit: "kilometer" }] },
      age_min: t.ageMin,
      age_max: t.ageMax,
      targeting_automation: { advantage_audience: t.mode === "advantage_plus" ? 1 : 0 },
      ...(plan.placements === "feeds_stories_reels" ? { publisher_platforms: ["facebook", "instagram"] } : {}),
    },
  });

  const adIds: string[] = [];
  for (const [i, ad] of ads.entries()) {
    const link =
      plan.destinationType === "WHATSAPP"
        ? { link: `https://api.whatsapp.com/send?phone=${profile.whatsappNumber!.replace(/\D/g, "")}` }
        : { link: "https://fb.me/" };
    const creativeId = await api.createCreative(token, accountId, {
      name: `${profile.name} creative ${i + 1}`,
      object_story_spec: {
        page_id: profile.pageId,
        link_data: {
          ...link,
          message: ad.primaryText,
          name: ad.headline,
          ...(media.imageHash ? { image_hash: media.imageHash } : { picture: media.imageUrl }),
          call_to_action: { type: ad.cta, value: link },
        },
      },
    });
    adIds.push(await api.createAd(token, accountId, { name: `${profile.name} ad ${i + 1}`, adSetId, creativeId }));
  }

  // Activate bottom-up so nothing delivers half-built.
  for (const id of adIds) await api.setStatus(token, id, "ACTIVE");
  await api.setStatus(token, adSetId, "ACTIVE");
  await api.setStatus(token, campaignId, "ACTIVE");
  return { campaignId, adSetId, adIds };
}
