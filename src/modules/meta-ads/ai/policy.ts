import type { AdVariation } from "../schemas.ts";

// Conservative pre-submission screen. Meta's own review still has the final say.
const RULES: { re: RegExp; msg: string }[] = [
  { re: /\b(guaranteed|100%\s*(result|cure|safe))\b/i, msg: "Unrealistic guarantee claim" },
  { re: /\b(cure|miracle|lose\s+\d+\s*kg)\b/i, msg: "Health / before-after claim" },
  { re: /\b(are you|do you)\s+(overweight|depressed|in debt|diabetic)\b/i, msg: "Implies personal attributes" },
  { re: /\bclick here\b/i, msg: "Spammy phrasing" },
  { re: /(.)\1{5,}/, msg: "Repeated characters" },
  { re: /[A-Z]{12,}/, msg: "Excessive capitals" },
];

export function policyCheck(ads: AdVariation[]): { ok: boolean; issues: { index: number; msg: string }[] } {
  const issues: { index: number; msg: string }[] = [];
  ads.forEach((a, index) => {
    const text = `${a.primaryText} ${a.headline}`;
    for (const r of RULES) if (r.re.test(text)) issues.push({ index, msg: r.msg });
  });
  return { ok: issues.length === 0, issues };
}
