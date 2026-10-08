import { test } from "node:test";
import assert from "node:assert/strict";

process.env.META_DRY_RUN = "true";
process.env.ANTHROPIC_API_KEY = "";
process.env.TOKEN_ENC_KEY = "00".repeat(32);

const { buildApp } = await import("../src/platform/app.ts");
const { openDb } = await import("../src/platform/db.ts");
const { DryRunApi } = await import("../src/modules/meta-ads/meta/client.ts");
const { DryRunAuth } = await import("../src/modules/meta-ads/meta/auth.ts");
const { encrypt, decrypt } = await import("../src/modules/meta-ads/crypto.ts");
const { META_ADS_SLUG } = await import("../src/modules/meta-ads/routes.ts");

let dbCounter = 0;
const freshDb = () => openDb(`appquantive_test_${process.pid}_${Date.now()}_${dbCounter++}`);
const buildTestApp = async (dbPromise: ReturnType<typeof freshDb>, api = new DryRunApi(), metaAuth = new DryRunAuth()) => {
  const db = await dbPromise;
  const app = await buildApp(db, { api, metaAuth });
  app.addHook("onClose", async () => { await db.database.dropDatabase(); await db.close(); });
  return app;
};

test("token encryption round-trips and is not plaintext", () => {
  const blob = encrypt("EAAB-secret");
  assert.ok(!blob.includes("EAAB"));
  assert.equal(decrypt(blob), "EAAB-secret");
});

test("onboard -> propose -> approve -> optimize -> approve action -> kill switch", async () => {
  const api = new DryRunApi();
  const app = await buildTestApp(freshDb(), api);
  const signup = (await app.inject({ method: "POST", url: "/api/auth/signup", payload: { orgName: "Sweet Crumbs", email: "owner@a.com", password: "password123" } })).json();
  const headers = { authorization: "Bearer " + signup.token };
  const post = async (url: string, payload: unknown, method: "POST" | "PUT" = "POST") => {
    const r = await app.inject({ method, url, payload: payload as object, headers });
    return { status: r.statusCode, body: r.json() };
  };

  // Must be subscribed to Meta Ads AI before onboarding a business.
  assert.equal((await post("/api/subscriptions", { slug: META_ADS_SLUG })).status, 200);

  const b = await post("/api/businesses", {
    name: "Sweet Crumbs", type: "bakery", city: "Delhi", offer: "Fresh cakes from ₹499",
    goal: "whatsapp_messages", dailyBudgetInr: 500, languages: ["en", "hinglish"],
    whatsappNumber: "+91 98765 43210", pageId: "123",
  });
  assert.equal(b.status, 200);
  const bid = b.body.id;

  const bad = await post("/api/businesses", { name: "x" });
  assert.equal(bad.status, 400);

  const prop = await post(`/api/businesses/${bid}/propose`, {});
  assert.equal(prop.status, 200);
  assert.equal(prop.body.plan.destinationType, "WHATSAPP");
  assert.ok(prop.body.variations.length >= 3);
  const cid = prop.body.campaignId;

  assert.equal((await post(`/api/campaigns/${cid}/approve`, { imageUrl: "https://example.com/cake.jpg" })).status, 200);
  assert.equal((await post(`/api/campaigns/${cid}/approve`, { imageUrl: "https://example.com/cake.jpg" })).status, 409);

  const adSet = api.calls.find((c) => c.op === "createAdSet")!.args as any;
  assert.equal(adSet.daily_budget, 50000); // ₹500 in paise
  assert.equal(adSet.destination_type, "WHATSAPP");
  // Everything is created PAUSED first (campaign/adset/ad create calls don't activate); activation comes last.
  const ops = api.calls.map((c) => c.op);
  assert.ok(ops.lastIndexOf("createAd") < ops.indexOf("setStatus"));

  const meta = (await app.inject({ url: `/api/campaigns/${cid}`, headers })).json().meta;
  api.insightsData = [
    { adId: meta.adIds[0], adSetId: meta.adSetId, spend: 400, impressions: 5000, clicks: 50, cpm: 80, ctr: 1, cpc: 8, results: 0, costPerResult: null, frequency: 1 },
    { adId: meta.adIds[1], adSetId: meta.adSetId, spend: 200, impressions: 5000, clicks: 80, cpm: 40, ctr: 1.6, cpc: 2.5, results: 12, costPerResult: 16.7, frequency: 1 },
  ];
  const opt = await post(`/api/campaigns/${cid}/optimize`, {});
  assert.equal(opt.status, 200);
  const byType = Object.fromEntries(opt.body.actions.map((a: any) => [a.action.type, a.status]));
  assert.equal(byType.pause_ad, "pending"); // autoApply is off by default
  assert.equal(byType.set_budget, "pending"); // spend increases always need approval

  const view = (await app.inject({ url: `/api/campaigns/${cid}`, headers })).json();
  const pause = view.actions.find((a: any) => a.type === "pause_ad");
  assert.equal((await post(`/api/actions/${pause.id}/approve`, {})).status, 200);
  assert.ok(api.calls.some((c) => c.op === "setStatus" && (c.args as any).s === "PAUSED" && (c.args as any).id === pause.adId));

  assert.equal((await post(`/api/businesses/${bid}/kill`, { on: true })).status, 200);
  assert.ok(api.calls.some((c) => c.op === "setStatus" && (c.args as any).id === meta.campaignId && (c.args as any).s === "PAUSED"));
  const after = await post(`/api/businesses/${bid}/propose`, {});
  assert.equal((await post(`/api/campaigns/${after.body.campaignId}/approve`, { imageUrl: "https://example.com/a.jpg" })).status, 400);
  await app.close();
});

test("tenancy: auth required, orgs isolated, plan caps, admin role", async () => {
  process.env.ADMIN_EMAIL = "admin@appquantive.com";
  process.env.ADMIN_PASSWORD = "adminpass123";
  const app = await buildTestApp(freshDb());
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, token?: string, payload?: object) => {
    const r = await app.inject({ method, url, payload, headers: token ? { authorization: "Bearer " + token } : {} });
    return { status: r.statusCode, body: r.json() };
  };
  const profile = { name: "B", type: "shop", city: "Pune", offer: "Sale", goal: "whatsapp_messages", dailyBudgetInr: 500, whatsappNumber: "9999999999", pageId: "1" };

  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("POST", "/api/auth/login", undefined, { email: "admin@appquantive.com", password: "wrongwrong" })).status, 401);

  const a = (await call("POST", "/api/auth/signup", undefined, { orgName: "A", email: "a@x.com", password: "password123" })).body.token;
  const b = (await call("POST", "/api/auth/signup", undefined, { orgName: "B", email: "b@x.com", password: "password123" })).body.token;
  const admin = (await call("POST", "/api/auth/login", undefined, { email: "admin@appquantive.com", password: "adminpass123" })).body.token;

  // Must subscribe to Meta Ads AI before onboarding a business.
  assert.equal((await call("POST", "/api/subscriptions", a, { slug: META_ADS_SLUG })).status, 200);
  assert.equal((await call("POST", "/api/businesses", b, profile)).status, 402); // B never subscribed

  const biz = (await call("POST", "/api/businesses", a, profile)).body.id;
  assert.equal((await call("POST", "/api/businesses/" + biz + "/propose", b, {})).status, 404); // other tenant
  assert.equal((await call("POST", "/api/businesses/" + biz + "/kill", b, { on: true })).status, 404);
  const prop = (await call("POST", "/api/businesses/" + biz + "/propose", a, {})).body;
  assert.equal((await call("GET", "/api/campaigns/" + prop.campaignId, b)).status, 404);
  assert.equal((await call("GET", "/api/campaigns/" + prop.campaignId, admin)).status, 200); // staff sees all

  // Starter plan: budget cap and one live campaign.
  assert.equal((await call("POST", "/api/businesses", a, { ...profile, dailyBudgetInr: 5000 })).status, 400);
  const img = { imageUrl: "https://example.com/i.jpg" };
  assert.equal((await call("POST", "/api/campaigns/" + prop.campaignId + "/approve", a, img)).status, 200);
  const second = (await call("POST", "/api/businesses/" + biz + "/propose", a, {})).body.campaignId;
  assert.equal((await call("POST", "/api/campaigns/" + second + "/approve", a, img)).status, 402);

  // Admin-only routes; admin can create a client workspace on a higher plan.
  assert.equal((await call("GET", "/api/admin/orgs", a)).status, 403);
  assert.equal((await call("POST", "/api/admin/orgs", admin, { orgName: "Client C", email: "c@x.com", password: "password123", plan: "growth" })).status, 200);
  const orgs = (await call("GET", "/api/admin/orgs", admin)).body;
  assert.deepEqual(orgs.find((o: any) => o.name === "A").automations, [META_ADS_SLUG]);
  assert.equal(orgs.find((o: any) => o.name === "Client C").plan, "growth");

  // Admin can subscribe a client org to an automation directly.
  const clientOrgId = (await call("GET", "/api/admin/orgs", admin)).body.find((o: any) => o.name === "Client C").id;
  assert.equal((await call("POST", `/api/admin/orgs/${clientOrgId}/subscriptions`, admin, { slug: META_ADS_SLUG })).status, 200);
  assert.equal((await call("DELETE", `/api/admin/orgs/${clientOrgId}/subscriptions/${META_ADS_SLUG}`, admin)).status, 200);
  await app.close();
});

test("Facebook connect flow: state-bound callback, asset pick, payment-method and token checks", async () => {
  const app = await buildTestApp(freshDb());
  const s = (await app.inject({ method: "POST", url: "/api/auth/signup", payload: { orgName: "Z", email: "z@x.com", password: "password123" } })).json();
  const h = { authorization: "Bearer " + s.token };
  await app.inject({ method: "POST", url: "/api/subscriptions", headers: h, payload: { slug: META_ADS_SLUG } });
  const bid = (await app.inject({ method: "POST", url: "/api/businesses", headers: h, payload: {
    name: "B", type: "shop", city: "Pune", offer: "Sale", goal: "whatsapp_messages", dailyBudgetInr: 500, whatsappNumber: "9999999999" } })).json().id;

  // Not connected yet: assets unavailable? (dry-run allows a placeholder token, so connect properly first)
  const url = (await app.inject({ url: `/api/businesses/${bid}/meta/login-url`, headers: h })).json().url as string;
  const cb = new URL(url);
  // A session token or garbage is not a valid state.
  assert.equal((await app.inject({ url: "/api/meta/callback?code=x&state=" + s.token })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/meta/callback?code=x&state=bad" })).statusCode, 400);
  const ok = await app.inject({ url: cb.pathname + cb.search });
  assert.equal(ok.statusCode, 302);
  assert.match(String(ok.headers.location), /meta=connected/);

  const assets = (await app.inject({ url: `/api/businesses/${bid}/meta/assets`, headers: h })).json();
  assert.equal(assets.adAccounts.length, 2);
  const pick = (accountId: string, pageId = "2001") =>
    app.inject({ method: "POST", url: `/api/businesses/${bid}/meta/select`, headers: h, payload: { accountId, pageId } });
  assert.equal((await pick("1002")).statusCode, 400); // no card on the ad account
  assert.equal((await pick("9999")).statusCode, 400); // not one of theirs
  assert.equal((await pick("1001")).statusCode, 200);

  // Another tenant cannot start or read this business's connection.
  const o = (await app.inject({ method: "POST", url: "/api/auth/signup", payload: { orgName: "Y", email: "y@x.com", password: "password123" } })).json();
  assert.equal((await app.inject({ url: `/api/businesses/${bid}/meta/assets`, headers: { authorization: "Bearer " + o.token } })).statusCode, 404);
  await app.close();
});
