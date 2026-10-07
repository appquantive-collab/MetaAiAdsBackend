import { z } from "zod";

export const Goal = z.enum(["whatsapp_messages", "lead_forms"]);
export const Language = z.enum(["en", "hi", "hinglish"]);
export const SpecialCategory = z.enum(["NONE", "HOUSING", "EMPLOYMENT", "CREDIT", "ISSUE_ELECTION_POLITICS"]);

export const BusinessProfile = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  city: z.string().min(1),
  offer: z.string().min(1),
  audience: z.string().default("local customers"),
  tone: z.string().default("friendly"),
  goal: Goal,
  dailyBudgetInr: z.number().positive(),
  languages: z.array(Language).min(1).default(["en"]),
  whatsappNumber: z.string().optional(),
  pageId: z.string().optional(),
  specialCategory: SpecialCategory.default("NONE"),
});
export type BusinessProfile = z.infer<typeof BusinessProfile>;

export const CampaignPlan = z.object({
  objective: z.enum(["OUTCOME_ENGAGEMENT", "OUTCOME_LEADS"]),
  optimizationGoal: z.enum(["CONVERSATIONS", "LEAD_GENERATION"]),
  destinationType: z.enum(["WHATSAPP", "ON_AD"]),
  targeting: z.object({
    mode: z.enum(["advantage_plus", "manual"]),
    geo: z.object({ city: z.string(), radiusKm: z.number().min(1).max(80) }),
    ageMin: z.number().int().min(18).max(65),
    ageMax: z.number().int().min(18).max(65),
    interests: z.array(z.string()).max(10),
  }),
  placements: z.enum(["automatic", "feeds_stories_reels"]),
  dailyBudgetInr: z.number().positive(),
  durationDays: z.number().int().min(1).max(90),
  targetCpaInr: z.number().positive(),
  rationale: z.string(),
});
export type CampaignPlan = z.infer<typeof CampaignPlan>;

export const AdVariation = z.object({
  language: Language,
  primaryText: z.string().min(1).max(500),
  headline: z.string().min(1).max(40),
  cta: z.enum(["WHATSAPP_MESSAGE", "SIGN_UP", "LEARN_MORE", "CONTACT_US"]),
});
export type AdVariation = z.infer<typeof AdVariation>;

export const CreativeSet = z.object({ variations: z.array(AdVariation).min(3).max(5) });
export type CreativeSet = z.infer<typeof CreativeSet>;

export type Limits = {
  maxDailySpendInr: number;
  maxDailyChangePct: number; // max budget change per day, in percent
  autoApply: boolean; // Phase 2 autonomy; false = approve every change
};
