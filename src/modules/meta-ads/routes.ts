import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDb, BusinessDoc, CampaignDoc } from "../../platform/db.ts";
import { newId, now } from "../../platform/db.ts";
import { httpError } from "../../platform/types.ts";
import type { User } from "../../platform/auth.ts";
import { signState, readState } from "../../platform/auth.ts";
import type { Subscriptions } from "../../platform/subscriptions.ts";
import { BusinessProfile, type Limits, type CampaignPlan, type AdVariation } from "./schemas.ts";
import { DEFAULT_LIMITS, checkAction, type ProposedAction } from "./guardrails.ts";
import { planCampaign } from "./ai/strategist.ts";
import { generateCreative } from "./ai/creative.ts";
import { launchCampaign, type LaunchResult } from "./execution.ts";
import { evaluateRules } from "./monitoring/rules.ts";
import { writeSummary } from "./monitoring/summary.ts";
import type { MarketingApi } from "./meta/client.ts";
import type { MetaAuth } from "./meta/auth.ts";
import { config } from "../../platform/config.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { META_ADS_LIMITS } from "./limits.ts";

/** Slug this module registers as in the `subscription` table — matches appquantive-web's automations.ts. */
export const META_ADS_SLUG = "ai-meta-ads-automation";

export interface MetaAdsDeps {
  api: MarketingApi;
  metaAuth: MetaAuth;
}

export function registerMetaAdsRoutes(app: FastifyInstance, db: AppDb, subs: Subscriptions, deps: MetaAdsDeps) {
  const { api, metaAuth } = deps;

  // Tenant isolation: owners only see their own org. Missing and foreign rows both return 404.
  // user === undefined means an internal call (scheduler) that has already been authorized.
  const biz = async (id: string, user?: User): Promise<BusinessDoc> => {
    const r = await db.business.findOne({ _id: id });
    if (!r || (user && user.role !== "admin" && r.org_id !== user.orgId)) throw httpError(404, "Business not found");
    return r;
  };
  const camp = async (id: string, user?: User): Promise<CampaignDoc> => {
    const r = await db.campaign.findOne({ _id: id });
    if (!r) throw httpError(404, "Campaign not found");
    await biz(r.business_id, user);
    return r;
  };
  const metaAdsLimitsOf = async (orgId: string) => META_ADS_LIMITS[await subs.orgPlanName(orgId)];

  const tokenOf = (b: BusinessDoc) => {
    if (b.token_enc && b.token_expires_at && b.token_expires_at < now()) throw httpError(400, "Facebook connection expired. Please reconnect.");
    if (b.token_enc) return decrypt(b.token_enc);
    if (config.metaDryRun) return "dry-run";
    throw httpError(400, "Connect Facebook first");
  };
  const limitsOf = (b: BusinessDoc): Limits => JSON.parse(b.limits);

  // 1. Business profile (the onboarding answers).
  app.post("/api/businesses", async (req) => {
    const profile = BusinessProfile.parse(req.body);
    // Admins create businesses for a client org via ?orgId=; owners always use their own.
    const orgId = req.user.role === "admin" ? ((req.query as { orgId?: string }).orgId ?? req.user.orgId) : req.user.orgId;
    if (req.user.role !== "admin") await subs.requireSubscription(orgId, META_ADS_SLUG);
    const cap = (await metaAdsLimitsOf(orgId)).maxDailySpendInr;
    if (profile.dailyBudgetInr > cap) throw httpError(400, `Your plan allows up to ₹${cap}/day`);
    const limits: Limits = { ...DEFAULT_LIMITS, maxDailySpendInr: Math.min(cap, Math.max(DEFAULT_LIMITS.maxDailySpendInr, profile.dailyBudgetInr)) };
    const id = newId();
    await db.business.insertOne({
      _id: id, org_id: orgId, profile: JSON.stringify(profile), token_enc: null, token_expires_at: null,
      account_id: null, limits: JSON.stringify(limits), kill_switch: false, created_at: now(),
    });
    return { id, profile, limits };
  });

  // Stands in for the Facebook Login for Business callback: stores the encrypted token + ad account.
  // Manual token paste is a dev shortcut only; real clients use the Facebook Login flow below.
  app.post("/api/businesses/:id/connect", async (req) => {
    if (!config.metaDryRun) throw httpError(404, "Not found");
    const { id } = req.params as { id: string };
    const body = z.object({ accessToken: z.string().min(1), accountId: z.string().regex(/^\d+$/), pageId: z.string().optional() }).parse(req.body);
    const b = await biz(id, req.user);
    const profile = { ...JSON.parse(b.profile), ...(body.pageId ? { pageId: body.pageId } : {}) };
    await db.business.updateOne({ _id: id }, { $set: { token_enc: encrypt(body.accessToken), account_id: body.accountId, profile: JSON.stringify(profile) } });
    return { connected: true };
  });

  app.put("/api/businesses/:id/limits", async (req) => {
    const { id } = req.params as { id: string };
    const cap = (await metaAdsLimitsOf((await biz(id, req.user)).org_id)).maxDailySpendInr;
    const limits = z.object({
      maxDailySpendInr: z.number().positive().max(cap), maxDailyChangePct: z.number().min(0).max(100), autoApply: z.boolean(),
    }).parse(req.body);
    await db.business.updateOne({ _id: id }, { $set: { limits: JSON.stringify(limits) } });
    return limits;
  });

  app.post("/api/businesses/:id/kill", async (req) => {
    const { id } = req.params as { id: string };
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    const b = await biz(id, req.user);
    await db.business.updateOne({ _id: id }, { $set: { kill_switch: on } });
    if (on) {
      // Pause every live campaign immediately.
      const live = await db.campaign.find({ business_id: id, status: "live" }).toArray();
      for (const c of live) {
        const meta: LaunchResult = JSON.parse(c.meta!);
        await api.setStatus(tokenOf(b), meta.campaignId, "PAUSED");
        await db.campaign.updateOne({ _id: c._id }, { $set: { status: "paused" } });
      }
    }
    return { killSwitch: on };
  });

  // Client connects their own Meta account (their ad account and card). Step 1: send them to Facebook.
  app.get("/api/businesses/:id/meta/login-url", async (req) => {
    const { id } = req.params as { id: string };
    await biz(id, req.user);
    return { url: metaAuth.loginUrl(signState({ b: id, u: req.user.id })) };
  });

  // Step 2: Facebook redirects the browser here. The signed state ties it back to the business.
  app.get("/api/meta/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const st = q.state ? readState(q.state) : null;
    if (!st) throw httpError(400, "Invalid or expired connection request. Please try again.");
    if (q.error || !q.code) return reply.redirect(`/?meta=denied`);
    const { token, expiresAt } = await metaAuth.exchangeCode(q.code);
    await db.business.updateOne({ _id: st.b! }, { $set: { token_enc: encrypt(token), token_expires_at: expiresAt, account_id: null } });
    return reply.redirect(`/?meta=connected&business=${encodeURIComponent(st.b!)}`);
  });

  // Step 3: list what the client can use; Step 4: they pick one, and we verify it can actually spend.
  app.get("/api/businesses/:id/meta/assets", async (req) => {
    const { id } = req.params as { id: string };
    return metaAuth.assets(tokenOf(await biz(id, req.user)));
  });
  app.post("/api/businesses/:id/meta/select", async (req) => {
    const { id } = req.params as { id: string };
    const sel = z.object({ accountId: z.string(), pageId: z.string() }).parse(req.body);
    const b = await biz(id, req.user);
    const assets = await metaAuth.assets(tokenOf(b));
    const acct = assets.adAccounts.find((a) => a.id === sel.accountId);
    if (!acct || !assets.pages.some((p) => p.id === sel.pageId)) throw httpError(400, "Pick an ad account and Page from your Facebook connection");
    if (acct.status !== 1) throw httpError(400, "This ad account is not active. Fix it in Meta Ads Manager first.");
    if (!acct.hasPaymentMethod) throw httpError(400, "This ad account has no payment method. Add a card in Meta Ads Manager (Billing), then try again.");
    if (acct.currency !== "INR") throw httpError(400, `This ad account bills in ${acct.currency}; this version supports INR accounts only.`);
    const profile = { ...JSON.parse(b.profile), pageId: sel.pageId };
    await db.business.updateOne({ _id: id }, { $set: { account_id: sel.accountId, profile: JSON.stringify(profile) } });
    return { connected: true, account: acct.name };
  });

  // 2-3. AI proposes a campaign; nothing is spent yet.
  app.post("/api/businesses/:id/propose", async (req) => {
    const { id } = req.params as { id: string };
    const profile = BusinessProfile.parse(JSON.parse((await biz(id, req.user)).profile));
    const [plan, creative] = await Promise.all([planCampaign(profile), generateCreative(profile)]);
    const cid = newId();
    await db.campaign.insertOne({
      _id: cid, business_id: id, plan: JSON.stringify(plan), ads: JSON.stringify(creative.variations),
      status: "draft", meta: null, image: null, last_optimized_at: null, created_at: now(),
    });
    return { campaignId: cid, plan, variations: creative.variations, policyIssues: creative.policyIssues, needsRegeneration: creative.needsRegeneration };
  });

  // 4. Owner approves; the execution layer launches.
  app.post("/api/campaigns/:id/approve", async (req) => {
    const { id } = req.params as { id: string };
    const { imageUrl } = z.object({ imageUrl: z.url() }).parse(req.body);
    const c = await camp(id, req.user);
    if (c.status !== "draft") throw httpError(409, `Campaign is ${c.status}`);
    const b = await biz(c.business_id);
    const liveBusinessIds = (await db.business.find({ org_id: b.org_id }).project({ _id: 1 }).toArray()).map((x) => x._id);
    const liveCount = await db.campaign.countDocuments({ business_id: { $in: liveBusinessIds }, status: "live" });
    const metaLimits = await metaAdsLimitsOf(b.org_id);
    if (liveCount >= metaLimits.maxLiveCampaigns) throw httpError(402, `Your plan allows ${metaLimits.maxLiveCampaigns} live campaign(s). Upgrade to launch more.`);
    const meta = await launchCampaign({
      api, token: tokenOf(b), accountId: b.account_id ?? "0",
      profile: BusinessProfile.parse(JSON.parse(b.profile)), plan: JSON.parse(c.plan) as CampaignPlan,
      ads: JSON.parse(c.ads) as AdVariation[], media: { imageUrl }, limits: limitsOf(b), killSwitch: !!b.kill_switch,
    }).catch((e) => { throw httpError(400, e.message); });
    await db.campaign.updateOne({ _id: id }, { $set: { status: "live", meta: JSON.stringify(meta), image: imageUrl } });
    return { status: "live", meta };
  });

  app.get("/api/campaigns/:id", async (req) => {
    const { id } = req.params as { id: string };
    const c = await camp(id, req.user);
    const actions = await db.action.find({ campaign_id: id }).sort({ created_at: -1 }).toArray();
    const reports = await db.report.find({ campaign_id: id }).sort({ created_at: -1 }).limit(7).toArray();
    return {
      id, status: c.status, plan: JSON.parse(c.plan), ads: JSON.parse(c.ads), meta: c.meta ? JSON.parse(c.meta) : null,
      actions: actions.map((a) => ({ id: a._id, status: a.status, note: a.note, ...JSON.parse(a.body) })),
      reports: reports.map((r) => ({ id: r._id, campaign_id: r.campaign_id, summary: r.summary, created_at: r.created_at })),
    };
  });

  // 5-6. Daily optimization: pull insights, apply rules, guard, summarize.
  app.post("/api/campaigns/:id/optimize", async (req) => {
    const id = String((req.params as { id: string }).id);
    await camp(id, req.user);
    return optimize(id);
  });

  async function applyAction(b: BusinessDoc, c: CampaignDoc, a: ProposedAction) {
    const token = tokenOf(b);
    const meta: LaunchResult = JSON.parse(c.meta!);
    if (a.type === "pause_ad") await api.setStatus(token, a.adId, "PAUSED");
    else if (a.type === "set_budget") {
      await api.setDailyBudget(token, a.adSetId, Math.round(a.toInr * 100));
      const plan = JSON.parse(c.plan);
      plan.dailyBudgetInr = a.toInr;
      await db.campaign.updateOne({ _id: c._id }, { $set: { plan: JSON.stringify(plan) } });
    }
    // refresh_creative: acknowledged only; new creative is generated by the owner via /propose in this version.
    void meta;
  }

  async function optimize(campaignId: string) {
    const c = await camp(campaignId);
    if (c.status !== "live") throw httpError(409, `Campaign is ${c.status}`);
    const b = await biz(c.business_id);
    const plan: CampaignPlan = JSON.parse(c.plan);
    const meta: LaunchResult = JSON.parse(c.meta!);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const yesterday = day(new Date(Date.now() - 86400_000));
    const insights = (await api.insights(tokenOf(b), b.account_id ?? "0", yesterday, yesterday))
      .filter((i) => i.adSetId === meta.adSetId || meta.adIds.includes(i.adId));

    const proposed = evaluateRules(insights, plan.targetCpaInr, { [meta.adSetId]: plan.dailyBudgetInr });
    const limits = limitsOf(b);
    const today = day(new Date());
    const priorPct = (await db.action.find({ campaign_id: campaignId, status: "applied", created_at: { $gte: today } }).toArray())
      .map((r) => JSON.parse(r.body) as ProposedAction)
      .reduce((s, a) => (a.type === "set_budget" ? s + (Math.abs(a.toInr - a.fromInr) / a.fromInr) * 100 : s), 0);

    let changedPct = priorPct;
    const results: { action: ProposedAction; status: string; note?: string }[] = [];
    for (const a of proposed) {
      const d = checkAction(a, limits, { killSwitch: !!b.kill_switch, budgetChangedTodayPct: changedPct, totalDailyBudgetInr: plan.dailyBudgetInr });
      let status = "blocked";
      if (d.allowed && d.needsApproval) status = "pending";
      else if (d.allowed) {
        await applyAction(b, await camp(campaignId), a);
        status = "applied";
        if (a.type === "set_budget") changedPct += (Math.abs(a.toInr - a.fromInr) / a.fromInr) * 100;
      }
      await db.action.insertOne({ _id: newId(), campaign_id: campaignId, body: JSON.stringify(a), status, note: d.reason ?? null, created_at: now() });
      results.push({ action: a, status, note: d.reason });
    }
    const summary = await writeSummary(insights, proposed);
    await db.report.insertOne({ _id: newId(), campaign_id: campaignId, summary, created_at: now() });
    await db.campaign.updateOne({ _id: campaignId }, { $set: { last_optimized_at: now() } });
    return { summary, actions: results };
  }

  // Owner approves a pending change. Guardrails are re-checked at execution time.
  app.post("/api/actions/:id/approve", async (req) => {
    const { id } = req.params as { id: string };
    const row = await db.action.findOne({ _id: id });
    if (!row) throw httpError(404, "Action not found");
    if (row.status !== "pending") throw httpError(409, `Action is ${row.status}`);
    const c = await camp(row.campaign_id, req.user);
    const b = await biz(c.business_id);
    const a = JSON.parse(row.body) as ProposedAction;
    const plan: CampaignPlan = JSON.parse(c.plan);
    const d = checkAction(a, limitsOf(b), { killSwitch: !!b.kill_switch, budgetChangedTodayPct: 0, totalDailyBudgetInr: plan.dailyBudgetInr });
    if (!d.allowed) {
      await db.action.updateOne({ _id: id }, { $set: { status: "blocked", note: d.reason ?? null } });
      throw httpError(400, d.reason ?? "Blocked by guardrails");
    }
    await applyAction(b, c, a);
    await db.action.updateOne({ _id: id }, { $set: { status: "applied" } });
    return { status: "applied" };
  });

  app.post("/api/actions/:id/reject", async (req) => {
    const { id } = req.params as { id: string };
    await db.action.updateOne({ _id: id, status: "pending" }, { $set: { status: "rejected" } });
    return { status: "rejected" };
  });

  /** Called by the scheduler: optimize each live campaign at most once per 24h. */
  async function runDaily() {
    const cutoff = new Date(Date.now() - 86400_000).toISOString();
    const due = await db.campaign.find({
      status: "live",
      $or: [{ last_optimized_at: null }, { last_optimized_at: { $lt: cutoff } }],
    }).toArray().catch((e) => { console.error("runDaily: failed to list due campaigns", e.message); return []; });
    for (const r of due) await optimize(r._id).catch((e) => console.error("optimize failed", r._id, e.message));
  }

  return { runDaily };
}
