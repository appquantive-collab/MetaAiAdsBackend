import type { DatabaseSync } from "node:sqlite";
import { newId, now } from "./db.ts";
import { PLANS, type PlanName } from "./plans.ts";
import { httpError } from "./types.ts";

type Row = Record<string, any>;

/** Which automations (by slug) an org has active, and the plan-enforced cap on how many it can run at once. */
export function makeSubscriptions(db: DatabaseSync) {
  const orgPlanName = (orgId: string): PlanName => {
    const o = db.prepare("SELECT plan FROM org WHERE id=?").get(orgId) as Row | undefined;
    return (o?.plan ?? "starter") as PlanName;
  };
  const orgPlan = (orgId: string) => PLANS[orgPlanName(orgId)];

  const hasSubscription = (orgId: string, slug: string) =>
    !!db.prepare("SELECT 1 FROM subscription WHERE org_id=? AND automation_slug=? AND status='active'").get(orgId, slug);

  const requireSubscription = (orgId: string, slug: string) => {
    if (!hasSubscription(orgId, slug)) throw httpError(402, "This automation is not active on your account. Subscribe to continue.");
  };

  const listSubscriptions = (orgId: string) =>
    db.prepare("SELECT automation_slug, status, created_at, canceled_at FROM subscription WHERE org_id=? ORDER BY created_at DESC").all(orgId) as Row[];

  const subscribe = (orgId: string, slug: string) => {
    const cap = orgPlan(orgId).maxActiveAutomations;
    const activeCount = (db.prepare("SELECT COUNT(*) AS n FROM subscription WHERE org_id=? AND status='active'").get(orgId) as Row).n;
    if (!hasSubscription(orgId, slug) && activeCount >= cap)
      throw httpError(402, `Your plan allows ${cap} active automation(s). Upgrade to add more.`);
    const existing = db.prepare("SELECT id FROM subscription WHERE org_id=? AND automation_slug=?").get(orgId, slug) as Row | undefined;
    if (existing) db.prepare("UPDATE subscription SET status='active', canceled_at=NULL WHERE id=?").run(existing.id);
    else db.prepare("INSERT INTO subscription (id,org_id,automation_slug,status,created_at) VALUES (?,?,?,'active',?)")
      .run(newId(), orgId, slug, now());
  };

  const unsubscribe = (orgId: string, slug: string) => {
    db.prepare("UPDATE subscription SET status='canceled', canceled_at=? WHERE org_id=? AND automation_slug=?")
      .run(now(), orgId, slug);
  };

  return { orgPlanName, orgPlan, hasSubscription, requireSubscription, listSubscriptions, subscribe, unsubscribe };
}

export type Subscriptions = ReturnType<typeof makeSubscriptions>;
