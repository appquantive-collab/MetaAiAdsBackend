import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
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

type Row = Record<string, any>;

export interface MetaAdsDeps {
  api: MarketingApi;
  metaAuth: MetaAuth;
}

export function registerMetaAdsRoutes(app: FastifyInstance, db: DatabaseSync, subs: Subscriptions, deps: MetaAdsDeps) {
  const { api, metaAuth } = deps;

  // Tenant isolation: owners only see their own org. Missing and foreign rows both return 404.
  // user === undefined means an internal call (scheduler) that has already been authorized.
  const biz = (id: string, user?: User): Row => {
    const r = db.prepare("SELECT * FROM business WHERE id=?").get(id) as Row | undefined;
    if (!r || (user && user.role !== "admin" && r.org_id !== user.orgId)) throw httpError(404, "Business not found");
    return r;
  };
  const camp = (id: string, user?: User): Row => {
    const r = db.prepare("SELECT * FROM campaign WHERE id=?").get(id) as Row | undefined;
    if (!r) throw httpError(404, "Campaign not found");
    biz(r.business_id, user);
    return r;
  };
  const metaAdsLimitsOf = (orgId: string) => META_ADS_LIMITS[subs.orgPlanName(orgId)];

  const tokenOf = (b: Row) => {
    if (b.token_enc && b.token_expires_at && b.token_expires_at < now()) throw httpError(400, "Facebook connection expired. Please reconnect.");
    if (b.token_enc) return decrypt(b.token_enc);
    if (config.metaDryRun) return "dry-run";
    throw httpError(400, "Connect Facebook first");
  };
  const limitsOf = (b: Row): Limits => JSON.parse(b.limits);

  // 1. Business profile (the onboarding answers).
  app.post("/api/businesses", async (req) => {
    const profile = BusinessProfile.parse(req.body);
    // Admins create businesses for a client org via ?orgId=; owners always use their own.
    const orgId = req.user.role === "admin" ? ((req.query as { orgId?: string }).orgId ?? req.user.orgId) : req.user.orgId;
    if (req.user.role !== "admin") subs.requireSubscription(orgId, META_ADS_SLUG);
    const cap = metaAdsLimitsOf(orgId).maxDailySpendInr;
    if (profile.dailyBudgetInr > cap) throw httpError(400, `Your plan allows up to ₹${cap}/day`);
    const limits: Limits = { ...DEFAULT_LIMITS, maxDailySpendInr: Math.min(cap, Math.max(DEFAULT_LIMITS.maxDailySpendInr, profile.dailyBudgetInr)) };
    const id = newId();
    db.prepare("INSERT INTO business (id,org_id,profile,limits,created_at) VALUES (?,?,?,?,?)")
      .run(id, orgId, JSON.stringify(profile), JSON.stringify(limits), now());
    return { id, profile, limits };
  });

  // Stands in for the Facebook Login for Business callback: stores the encrypted token + ad account.
  // Manual token paste is a dev shortcut only; real clients use the Facebook Login flow below.
  app.post("/api/businesses/:id/connect", async (req) => {
    if (!config.metaDryRun) throw httpError(404, "Not found");
    const { id } = req.params as { id: string };
    const body = z.object({ accessToken: z.string().min(1), accountId: z.string().regex(/^\d+$/), pageId: z.string().optional() }).parse(req.body);
    const b = biz(id, req.user);
    const profile = { ...JSON.parse(b.profile), ...(body.pageId ? { pageId: body.pageId } : {}) };
    db.prepare("UPDATE business SET token_enc=?, account_id=?, profile=? WHERE id=?")
      .run(encrypt(body.accessToken), body.accountId, JSON.stringify(profile), id);
    return { connected: true };
  });

  app.put("/api/businesses/:id/limits", async (req) => {
    const { id } = req.params as { id: string };
    const cap = metaAdsLimitsOf(biz(id, req.user).org_id).maxDailySpendInr;
    const limits = z.object({
      maxDailySpendInr: z.number().positive().max(cap), maxDailyChangePct: z.number().min(0).max(100), autoApply: z.boolean(),
    }).parse(req.body);
    db.prepare("UPDATE business SET limits=? WHERE id=?").run(JSON.stringify(limits), id);
    return limits;
  });

  app.post("/api/businesses/:id/kill", async (req) => {
    const { id } = req.params as { id: string };
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    const b = biz(id, req.user);
    db.prepare("UPDATE business SET kill_switch=? WHERE id=?").run(on ? 1 : 0, id);
    if (on) {
      // Pause every live campaign immediately.
      const live = db.prepare("SELECT * FROM campaign WHERE business_id=? AND status='live'").all(id) as Row[];
      for (const c of live) {
        const meta: LaunchResult = JSON.parse(c.meta);
        await api.setStatus(tokenOf(b), meta.campaignId, "PAUSED");
        db.prepare("UPDATE campaign SET status='paused' WHERE id=?").run(c.id);
      }
    }
    return { killSwitch: on };
  });

  // Client connects their own Meta account (their ad account and card). Step 1: send them to Facebook.
  app.get("/api/businesses/:id/meta/login-url", async (req) => {
    const { id } = req.params as { id: string };
    biz(id, req.user);
    return { url: metaAuth.loginUrl(signState({ b: id, u: req.user.id })) };
  });

  // Step 2: Facebook redirects the browser here. The signed state ties it back to the business.
  app.get("/api/meta/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const st = q.state ? readState(q.state) : null;
    if (!st) throw httpError(400, "Invalid or expired connection request. Please try again.");
    if (q.error || !q.code) return reply.redirect(`/?meta=denied`);
    const { token, expiresAt } = await metaAuth.exchangeCode(q.code);
    db.prepare("UPDATE business SET token_enc=?, token_expires_at=?, account_id=NULL WHERE id=?")
      .run(encrypt(token), expiresAt, st.b!);
    return reply.redirect(`/?meta=connected&business=${encodeURIComponent(st.b!)}`);
  });

  // Step 3: list what the client can use; Step 4: they pick one, and we verify it can actually spend.
  app.get("/api/businesses/:id/meta/assets", async (req) => {
    const { id } = req.params as { id: string };
    return metaAuth.assets(tokenOf(biz(id, req.user)));
  });
  app.post("/api/businesses/:id/meta/select", async (req) => {
    const { id } = req.params as { id: string };
    const sel = z.object({ accountId: z.string(), pageId: z.string() }).parse(req.body);
    const b = biz(id, req.user);
    const assets = await metaAuth.assets(tokenOf(b));
    const acct = assets.adAccounts.find((a) => a.id === sel.accountId);
    if (!acct || !assets.pages.some((p) => p.id === sel.pageId)) throw httpError(400, "Pick an ad account and Page from your Facebook connection");
    if (acct.status !== 1) throw httpError(400, "This ad account is not active. Fix it in Meta Ads Manager first.");
    if (!acct.hasPaymentMethod) throw httpError(400, "This ad account has no payment method. Add a card in Meta Ads Manager (Billing), then try again.");
    if (acct.currency !== "INR") throw httpError(400, `This ad account bills in ${acct.currency}; this version supports INR accounts only.`);
    const profile = { ...JSON.parse(b.profile), pageId: sel.pageId };
    db.prepare("UPDATE business SET account_id=?, profile=? WHERE id=?").run(sel.accountId, JSON.stringify(profile), id);
    return { connected: true, account: acct.name };
  });

  // 2-3. AI proposes a campaign; nothing is spent yet.
  app.post("/api/businesses/:id/propose", async (req) => {
    const { id } = req.params as { id: string };
    const profile = BusinessProfile.parse(JSON.parse(biz(id, req.user).profile));
    const [plan, creative] = await Promise.all([planCampaign(profile), generateCreative(profile)]);
    const cid = newId();
    db.prepare("INSERT INTO campaign (id,business_id,plan,ads,status,created_at) VALUES (?,?,?,?,'draft',?)")
      .run(cid, id, JSON.stringify(plan), JSON.stringify(creative.variations), now());
    return { campaignId: cid, plan, variations: creative.variations, policyIssues: creative.policyIssues, needsRegeneration: creative.needsRegeneration };
  });

  // 4. Owner approves; the execution layer launches.
  app.post("/api/campaigns/:id/approve", async (req) => {
    const { id } = req.params as { id: string };
    const { imageUrl } = z.object({ imageUrl: z.url() }).parse(req.body);
    const c = camp(id, req.user);
    if (c.status !== "draft") throw httpError(409, `Campaign is ${c.status}`);
    const b = biz(c.business_id);
    const live = db.prepare(`SELECT COUNT(*) AS n FROM campaign c JOIN business bz ON bz.id=c.business_id
      WHERE bz.org_id=? AND c.status='live'`).get(b.org_id) as Row;
    const metaLimits = metaAdsLimitsOf(b.org_id);
    if (live.n >= metaLimits.maxLiveCampaigns) throw httpError(402, `Your plan allows ${metaLimits.maxLiveCampaigns} live campaign(s). Upgrade to launch more.`);
    const meta = await launchCampaign({
      api, token: tokenOf(b), accountId: b.account_id ?? "0",
      profile: BusinessProfile.parse(JSON.parse(b.profile)), plan: JSON.parse(c.plan) as CampaignPlan,
      ads: JSON.parse(c.ads) as AdVariation[], media: { imageUrl }, limits: limitsOf(b), killSwitch: !!b.kill_switch,
    }).catch((e) => { throw httpError(400, e.message); });
    db.prepare("UPDATE campaign SET status='live', meta=?, image=? WHERE id=?").run(JSON.stringify(meta), imageUrl, id);
    return { status: "live", meta };
  });

  app.get("/api/campaigns/:id", async (req) => {
    const { id } = req.params as { id: string };
    const c = camp(id, req.user);
    const actions = db.prepare("SELECT * FROM action WHERE campaign_id=? ORDER BY created_at DESC").all(id) as Row[];
    const reports = db.prepare("SELECT * FROM report WHERE campaign_id=? ORDER BY created_at DESC LIMIT 7").all(id);
    return {
      id, status: c.status, plan: JSON.parse(c.plan), ads: JSON.parse(c.ads), meta: c.meta ? JSON.parse(c.meta) : null,
      actions: actions.map((a) => ({ id: a.id, status: a.status, note: a.note, ...JSON.parse(a.body) })), reports,
    };
  });

  // 5-6. Daily optimization: pull insights, apply rules, guard, summarize.
  app.post("/api/campaigns/:id/optimize", async (req) => {
    const id = String((req.params as { id: string }).id);
    camp(id, req.user);
    return optimize(id);
  });

  async function applyAction(b: Row, c: Row, a: ProposedAction) {
    const token = tokenOf(b);
    const meta: LaunchResult = JSON.parse(c.meta);
    if (a.type === "pause_ad") await api.setStatus(token, a.adId, "PAUSED");
    else if (a.type === "set_budget") {
      await api.setDailyBudget(token, a.adSetId, Math.round(a.toInr * 100));
      const plan = JSON.parse(c.plan);
      plan.dailyBudgetInr = a.toInr;
      db.prepare("UPDATE campaign SET plan=? WHERE id=?").run(JSON.stringify(plan), c.id);
    }
    // refresh_creative: acknowledged only; new creative is generated by the owner via /propose in this version.
    void meta;
  }

  async function optimize(campaignId: string) {
    const c = camp(campaignId);
    if (c.status !== "live") throw httpError(409, `Campaign is ${c.status}`);
    const b = biz(c.business_id);
    const plan: CampaignPlan = JSON.parse(c.plan);
    const meta: LaunchResult = JSON.parse(c.meta);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const yesterday = day(new Date(Date.now() - 86400_000));
    const insights = (await api.insights(tokenOf(b), b.account_id ?? "0", yesterday, yesterday))
      .filter((i) => i.adSetId === meta.adSetId || meta.adIds.includes(i.adId));

    const proposed = evaluateRules(insights, plan.targetCpaInr, { [meta.adSetId]: plan.dailyBudgetInr });
    const limits = limitsOf(b);
    const today = day(new Date());
    const priorPct = (db.prepare("SELECT body FROM action WHERE campaign_id=? AND status='applied' AND created_at>=?")
      .all(campaignId, today) as Row[]).map((r) => JSON.parse(r.body) as ProposedAction)
      .reduce((s, a) => (a.type === "set_budget" ? s + (Math.abs(a.toInr - a.fromInr) / a.fromInr) * 100 : s), 0);

    let changedPct = priorPct;
    const results: { action: ProposedAction; status: string; note?: string }[] = [];
    for (const a of proposed) {
      const d = checkAction(a, limits, { killSwitch: !!b.kill_switch, budgetChangedTodayPct: changedPct, totalDailyBudgetInr: plan.dailyBudgetInr });
      let status = "blocked";
      if (d.allowed && d.needsApproval) status = "pending";
      else if (d.allowed) {
        await applyAction(b, camp(campaignId), a);
        status = "applied";
        if (a.type === "set_budget") changedPct += (Math.abs(a.toInr - a.fromInr) / a.fromInr) * 100;
      }
      db.prepare("INSERT INTO action (id,campaign_id,body,status,note,created_at) VALUES (?,?,?,?,?,?)")
        .run(newId(), campaignId, JSON.stringify(a), status, d.reason ?? null, now());
      results.push({ action: a, status, note: d.reason });
    }
    const summary = await writeSummary(insights, proposed);
    db.prepare("INSERT INTO report (id,campaign_id,summary,created_at) VALUES (?,?,?,?)").run(newId(), campaignId, summary, now());
    db.prepare("UPDATE campaign SET last_optimized_at=? WHERE id=?").run(now(), campaignId);
    return { summary, actions: results };
  }

  // Owner approves a pending change. Guardrails are re-checked at execution time.
  app.post("/api/actions/:id/approve", async (req) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT * FROM action WHERE id=?").get(id) as Row | undefined;
    if (!row) throw httpError(404, "Action not found");
    if (row.status !== "pending") throw httpError(409, `Action is ${row.status}`);
    const c = camp(row.campaign_id, req.user);
    const b = biz(c.business_id);
    const a = JSON.parse(row.body) as ProposedAction;
    const plan: CampaignPlan = JSON.parse(c.plan);
    const d = checkAction(a, limitsOf(b), { killSwitch: !!b.kill_switch, budgetChangedTodayPct: 0, totalDailyBudgetInr: plan.dailyBudgetInr });
    if (!d.allowed) {
      db.prepare("UPDATE action SET status='blocked', note=? WHERE id=?").run(d.reason ?? null, id);
      throw httpError(400, d.reason ?? "Blocked by guardrails");
    }
    await applyAction(b, c, a);
    db.prepare("UPDATE action SET status='applied' WHERE id=?").run(id);
    return { status: "applied" };
  });

  app.post("/api/actions/:id/reject", async (req) => {
    const { id } = req.params as { id: string };
    db.prepare("UPDATE action SET status='rejected' WHERE id=? AND status='pending'").run(id);
    return { status: "rejected" };
  });

  /** Called by the scheduler: optimize each live campaign at most once per 24h. */
  async function runDaily() {
    const due = db.prepare("SELECT id FROM campaign WHERE status='live' AND (last_optimized_at IS NULL OR last_optimized_at < ?)")
      .all(new Date(Date.now() - 86400_000).toISOString()) as Row[];
    for (const r of due) await optimize(r.id).catch((e) => console.error("optimize failed", r.id, e.message));
  }

  return { runDaily };
}
