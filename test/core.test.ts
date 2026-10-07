import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAction, checkPlan, DEFAULT_LIMITS } from "../src/modules/meta-ads/guardrails.ts";
import { evaluateRules } from "../src/modules/meta-ads/monitoring/rules.ts";
import { policyCheck } from "../src/modules/meta-ads/ai/policy.ts";
import { fallbackPlan, sanitizePlan } from "../src/modules/meta-ads/ai/strategist.ts";
import { fallbackCreative } from "../src/modules/meta-ads/ai/creative.ts";
import { BusinessProfile, CreativeSet } from "../src/modules/meta-ads/schemas.ts";
import type { Insight } from "../src/modules/meta-ads/meta/client.ts";

const profile = BusinessProfile.parse({
  name: "Sweet Crumbs", type: "bakery", city: "Delhi", offer: "Fresh cakes from ₹499",
  goal: "whatsapp_messages", dailyBudgetInr: 500, languages: ["en", "hinglish", "hi"],
});
const ins = (o: Partial<Insight>): Insight => ({
  adId: "a1", adSetId: "s1", spend: 0, impressions: 1000, clicks: 10, cpm: 50, ctr: 1, cpc: 5,
  results: 0, costPerResult: null, frequency: 1, ...o,
});
const ctx = { killSwitch: false, budgetChangedTodayPct: 0, totalDailyBudgetInr: 500 };

test("plan over max spend is blocked, kill switch blocks", () => {
  const plan = { ...fallbackPlan(profile), dailyBudgetInr: 99999 };
  assert.equal(checkPlan(plan, DEFAULT_LIMITS, false).allowed, false);
  assert.equal(checkPlan(fallbackPlan(profile), DEFAULT_LIMITS, true).allowed, false);
  assert.deepEqual(checkPlan(fallbackPlan(profile), DEFAULT_LIMITS, false), { allowed: true, needsApproval: true });
});

test("spend increase always needs approval, even with autoApply", () => {
  const limits = { ...DEFAULT_LIMITS, autoApply: true };
  const up = checkAction({ type: "set_budget", adSetId: "s", fromInr: 500, toInr: 550, reason: "" }, limits, ctx);
  assert.equal(up.allowed && up.needsApproval, true);
  const pause = checkAction({ type: "pause_ad", adId: "a", reason: "" }, limits, ctx);
  assert.equal(pause.needsApproval, false);
});

test("daily change cap and max spend are enforced", () => {
  const big = checkAction({ type: "set_budget", adSetId: "s", fromInr: 500, toInr: 700, reason: "" }, DEFAULT_LIMITS, ctx);
  assert.equal(big.allowed, false); // +40% > 20%
  const capped = checkAction({ type: "set_budget", adSetId: "s", fromInr: 500, toInr: 550, reason: "" },
    DEFAULT_LIMITS, { ...ctx, budgetChangedTodayPct: 15 });
  assert.equal(capped.allowed, false);
  const over = checkAction({ type: "set_budget", adSetId: "s", fromInr: 1900, toInr: 2100, reason: "" },
    { ...DEFAULT_LIMITS, maxDailyChangePct: 50 }, { ...ctx, totalDailyBudgetInr: 1900 });
  assert.equal(over.allowed, false);
});

test("rules: pause at 2x CPA with zero results, fatigue above 3, budget shift", () => {
  const acts = evaluateRules([
    ins({ adId: "dead", spend: 200 }),
    ins({ adId: "tired", spend: 50, results: 1, frequency: 3.4 }),
    ins({ adId: "ok", spend: 50, results: 1, frequency: 2 }),
    ins({ adId: "w1", adSetId: "s2", spend: 100, results: 10 }),
  ], 100, { s1: 500, s2: 500 });
  const types = acts.map((a) => `${a.type}:${"adId" in a ? a.adId : a.adSetId}`);
  assert.deepEqual(types, ["pause_ad:dead", "refresh_creative:tired", "set_budget:s2"]);
});

test("policy check flags risky copy", () => {
  const ad = { language: "en", cta: "LEARN_MORE", headline: "Miracle cure", primaryText: "Guaranteed results" } as const;
  assert.equal(policyCheck([ad]).ok, false);
  assert.equal(policyCheck(fallbackCreative(profile).variations).ok, true);
});

test("fallback creative is schema-valid and multilingual", () => {
  const set = CreativeSet.parse(fallbackCreative(profile));
  assert.deepEqual(new Set(set.variations.map((v) => v.language)), new Set(["en", "hinglish", "hi"]));
});

test("special categories strip targeting narrowing and budget never exceeds owner's", () => {
  const p = { ...profile, specialCategory: "HOUSING" as const };
  const wild = { ...fallbackPlan(p), dailyBudgetInr: 9000,
    targeting: { ...fallbackPlan(p).targeting, mode: "manual" as const, ageMin: 30, ageMax: 40, interests: ["x"] } };
  const out = sanitizePlan(wild, p);
  assert.equal(out.dailyBudgetInr, 500);
  assert.deepEqual([out.targeting.mode, out.targeting.ageMin, out.targeting.interests], ["advantage_plus", 18, []]);
});
