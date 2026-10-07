import { AdVariation, BusinessProfile, CreativeSet } from "../schemas.ts";
import { askJson, hasClaude } from "./claude.ts";
import { policyCheck } from "./policy.ts";

const SYSTEM = `You write Meta ad copy for small Indian businesses.
Return {"variations":[{language,primaryText,headline,cta}]} with 3 to 5 variations.
language is one of en, hi (Devanagari), hinglish (Hindi in Latin script). Cover each requested language.
headline max 40 chars. For whatsapp_messages use cta WHATSAPP_MESSAGE; for lead_forms use SIGN_UP.
No guarantees, no health or before/after claims, no implying personal attributes, no ALL CAPS.`;

export function fallbackCreative(p: BusinessProfile): CreativeSet {
  const cta = p.goal === "whatsapp_messages" ? "WHATSAPP_MESSAGE" : "SIGN_UP";
  const base = (language: AdVariation["language"], primaryText: string, headline: string): AdVariation => ({
    language, primaryText, headline: headline.slice(0, 40), cta,
  });
  const out: AdVariation[] = [
    base("en", `${p.name} in ${p.city}: ${p.offer}. Message us on WhatsApp to order.`, `${p.name} – ${p.city}`),
    base("en", `Looking for a ${p.type} near you? ${p.offer}. Tap to chat with us.`, "Chat with us today"),
    base("en", `${p.offer} from ${p.name}. Ask us anything on WhatsApp.`, "Ask us on WhatsApp"),
  ];
  if (p.languages.includes("hinglish"))
    out.push(base("hinglish", `${p.city} mein ${p.name}: ${p.offer}. WhatsApp par message karein.`, "WhatsApp par order karein"));
  if (p.languages.includes("hi"))
    out.push(base("hi", `${p.city} में ${p.name}: ${p.offer}। ऑर्डर के लिए WhatsApp पर मैसेज करें।`, "WhatsApp पर ऑर्डर करें"));
  return { variations: out.slice(0, 5) };
}

export async function generateCreative(profile: BusinessProfile) {
  const set = hasClaude()
    ? await askJson(SYSTEM, `Business profile:\n${JSON.stringify(profile)}`, CreativeSet)
    : fallbackCreative(profile);
  const check = policyCheck(set.variations);
  const flagged = new Set(check.issues.map((i) => i.index));
  // Drop flagged variations; keep the set only if enough clean ones remain.
  const clean = set.variations.filter((_, i) => !flagged.has(i));
  return { variations: clean, policyIssues: check.issues, needsRegeneration: clean.length < 3 };
}
