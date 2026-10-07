import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { newId, now } from "./db.ts";
import { hashPassword, issueToken, readToken, verifyPassword, type Role, type User } from "./auth.ts";
import { PLANS, type PlanName } from "./plans.ts";
import { makeSubscriptions } from "./subscriptions.ts";
import { httpError } from "./types.ts";
import { registerMetaAdsRoutes, type MetaAdsDeps } from "../modules/meta-ads/routes.ts";

declare module "fastify" {
  interface FastifyRequest { user: User }
}

type Row = Record<string, any>;

/** Registered automation modules, keyed by the slug they use in the `subscription` table. */
export interface AutomationModule {
  slug: string;
  name: string;
}

export const AUTOMATION_MODULES: AutomationModule[] = [
  { slug: "ai-meta-ads-automation", name: "Meta Ads AI" },
];

export function buildApp(db: DatabaseSync, metaAds: MetaAdsDeps) {
  const app = Fastify({ logger: false });
  const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));
  app.register(fastifyStatic, { root: publicDir });

  const subs = makeSubscriptions(db);

  const requireAdmin = (req: { user: User }) => {
    if (req.user.role !== "admin") throw httpError(403, "Admin only");
  };
  const createOrgUser = (orgName: string, email: string, password: string, plan: PlanName, role: Role) => {
    if (db.prepare("SELECT 1 FROM user WHERE email=?").get(email)) throw httpError(409, "Email already registered");
    const orgId = newId();
    const userId = newId();
    db.prepare("INSERT INTO org (id,name,plan,created_at) VALUES (?,?,?,?)").run(orgId, orgName, plan, now());
    db.prepare("INSERT INTO user (id,org_id,email,pw_hash,role,created_at) VALUES (?,?,?,?,?,?)")
      .run(userId, orgId, email, hashPassword(password), role, now());
    return { orgId, user: { id: userId, orgId, role, email } as User };
  };

  // Seed the AppQuantive admin from env on first boot.
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !db.prepare("SELECT 1 FROM user WHERE email=?").get(process.env.ADMIN_EMAIL))
    createOrgUser("AppQuantive", process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, "pro", "admin");

  const Creds = z.object({ email: z.email(), password: z.string().min(8) });
  const open = new Set(["/api/meta/callback", "/api/health", "/api/auth/login", "/api/auth/signup", "/api/automations"]);
  app.decorateRequest("user", undefined as unknown as User);
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api/") || open.has(req.url.split("?")[0]!)) return;
    const user = readToken((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!user) throw httpError(401, "Sign in required");
    req.user = user;
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "Invalid input", issues: err.issues });
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  app.get("/api/health", async () => ({ ok: true }));

  // --- Auth -----------------------------------------------------------------
  // Self-serve SaaS signup (disable with SIGNUP_OPEN=false when running invite-only).
  app.post("/api/auth/signup", async (req) => {
    if (process.env.SIGNUP_OPEN === "false") throw httpError(403, "Signup is closed");
    const b = Creds.extend({ orgName: z.string().min(1) }).parse(req.body);
    const { user } = createOrgUser(b.orgName, b.email, b.password, "starter", "owner");
    return { token: issueToken(user), user };
  });
  app.post("/api/auth/login", async (req) => {
    const b = Creds.parse(req.body);
    const u = db.prepare("SELECT * FROM user WHERE email=?").get(b.email) as Row | undefined;
    if (!u || !verifyPassword(b.password, u.pw_hash)) throw httpError(401, "Wrong email or password");
    const user: User = { id: u.id, orgId: u.org_id, role: u.role, email: u.email };
    return { token: issueToken(user), user };
  });

  // --- Admin: create and manage client workspaces ----------------------------
  app.post("/api/admin/orgs", async (req) => {
    requireAdmin(req);
    const b = Creds.extend({ orgName: z.string().min(1), plan: z.enum(["starter", "growth", "pro"]) }).parse(req.body);
    const { orgId } = createOrgUser(b.orgName, b.email, b.password, b.plan, "owner");
    return { orgId };
  });
  app.get("/api/admin/orgs", async (req) => {
    requireAdmin(req);
    const orgs = db.prepare("SELECT * FROM org ORDER BY created_at DESC").all() as Row[];
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      plan: o.plan,
      monthlyFeeInr: PLANS[o.plan as PlanName].priceInrPerMonth,
      automations: subs.listSubscriptions(o.id).filter((s) => s.status === "active").map((s) => s.automation_slug),
    }));
  });
  app.put("/api/admin/orgs/:id/plan", async (req) => {
    requireAdmin(req);
    const { plan } = z.object({ plan: z.enum(["starter", "growth", "pro"]) }).parse(req.body);
    db.prepare("UPDATE org SET plan=? WHERE id=?").run(plan, (req.params as { id: string }).id);
    return { plan };
  });
  // Admin manages which automations a client org has active.
  app.post("/api/admin/orgs/:id/subscriptions", async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.body);
    subs.subscribe(id, slug);
    return { subscribed: slug };
  });
  app.delete("/api/admin/orgs/:id/subscriptions/:slug", async (req) => {
    requireAdmin(req);
    const { id, slug } = req.params as { id: string; slug: string };
    subs.unsubscribe(id, slug);
    return { unsubscribed: slug };
  });

  // --- Self-serve: list automations, see and manage my own subscriptions -----
  app.get("/api/automations", async () => AUTOMATION_MODULES);
  app.get("/api/me", async (req) => {
    const o = db.prepare("SELECT plan FROM org WHERE id=?").get(req.user.orgId) as Row | undefined;
    return { ...req.user, plan: o?.plan ?? "starter", subscriptions: subs.listSubscriptions(req.user.orgId) };
  });
  app.post("/api/subscriptions", async (req) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.body);
    if (!AUTOMATION_MODULES.some((m) => m.slug === slug)) throw httpError(400, "Unknown automation");
    subs.subscribe(req.user.orgId, slug);
    return { subscribed: slug };
  });
  app.delete("/api/subscriptions/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    subs.unsubscribe(req.user.orgId, slug);
    return { unsubscribed: slug };
  });

  // --- Automation modules ------------------------------------------------------
  const metaAdsApp = registerMetaAdsRoutes(app, db, subs, metaAds);

  return Object.assign(app, { runDaily: metaAdsApp.runDaily });
}
