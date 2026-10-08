import type { AppDb } from "./db.ts";
import { newId, now } from "./db.ts";
import { PLANS, type PlanName } from "./plans.ts";
import { httpError } from "./types.ts";

/** Which automations (by slug) an org has active, and the plan-enforced cap on how many it can run at once. */
export function makeSubscriptions(db: AppDb) {
  const orgPlanName = async (orgId: string): Promise<PlanName> => {
    const o = await db.org.findOne({ _id: orgId });
    return (o?.plan ?? "starter") as PlanName;
  };
  const orgPlan = async (orgId: string) => PLANS[await orgPlanName(orgId)];

  const hasSubscription = async (orgId: string, slug: string) =>
    !!(await db.subscription.findOne({ org_id: orgId, automation_slug: slug, status: "active" }));

  const requireSubscription = async (orgId: string, slug: string) => {
    if (!(await hasSubscription(orgId, slug))) throw httpError(402, "This automation is not active on your account. Subscribe to continue.");
  };

  const listSubscriptions = async (orgId: string) =>
    (await db.subscription.find({ org_id: orgId }).sort({ created_at: -1 }).toArray())
      .map((s) => ({ automation_slug: s.automation_slug, status: s.status, created_at: s.created_at, canceled_at: s.canceled_at }));

  const subscribe = async (orgId: string, slug: string) => {
    const cap = (await orgPlan(orgId)).maxActiveAutomations;
    const activeCount = await db.subscription.countDocuments({ org_id: orgId, status: "active" });
    const existing = await db.subscription.findOne({ org_id: orgId, automation_slug: slug });
    if (!(existing?.status === "active") && activeCount >= cap)
      throw httpError(402, `Your plan allows ${cap} active automation(s). Upgrade to add more.`);
    if (existing) await db.subscription.updateOne({ _id: existing._id }, { $set: { status: "active", canceled_at: null } });
    else await db.subscription.insertOne({ _id: newId(), org_id: orgId, automation_slug: slug, status: "active", created_at: now(), canceled_at: null });
  };

  const unsubscribe = async (orgId: string, slug: string) => {
    await db.subscription.updateOne({ org_id: orgId, automation_slug: slug }, { $set: { status: "canceled", canceled_at: now() } });
  };

  return { orgPlanName, orgPlan, hasSubscription, requireSubscription, listSubscriptions, subscribe, unsubscribe };
}

export type Subscriptions = ReturnType<typeof makeSubscriptions>;
