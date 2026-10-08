import { MongoClient, type Db, type Collection } from "mongodb";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";

export interface OrgDoc { _id: string; name: string; plan: string; created_at: string }
export interface UserDoc { _id: string; org_id: string; email: string; pw_hash: string; role: string; created_at: string }
export interface SubscriptionDoc {
  _id: string; org_id: string; automation_slug: string; status: string; created_at: string; canceled_at: string | null;
}
export interface BusinessDoc {
  _id: string; org_id: string; profile: string; token_enc: string | null; token_expires_at: string | null;
  account_id: string | null; limits: string; kill_switch: boolean; created_at: string;
}
export interface CampaignDoc {
  _id: string; business_id: string; plan: string; ads: string; status: string;
  meta: string | null; image: string | null; last_optimized_at: string | null; created_at: string;
}
export interface ActionDoc { _id: string; campaign_id: string; body: string; status: string; note: string | null; created_at: string }
export interface ReportDoc { _id: string; campaign_id: string; summary: string; created_at: string }

export interface AppDb {
  client: MongoClient;
  database: Db;
  org: Collection<OrgDoc>;
  user: Collection<UserDoc>;
  subscription: Collection<SubscriptionDoc>;
  business: Collection<BusinessDoc>;
  campaign: Collection<CampaignDoc>;
  action: Collection<ActionDoc>;
  report: Collection<ReportDoc>;
  close: () => Promise<void>;
}

/** `dbName` overrides config.mongodbDbName — tests use a separate throwaway database. */
export async function openDb(dbName = config.mongodbDbName): Promise<AppDb> {
  const client = new MongoClient(config.mongodbUri);
  await client.connect();
  const database: Db = client.db(dbName);

  const org = database.collection<OrgDoc>("org");
  const user = database.collection<UserDoc>("user");
  const subscription = database.collection<SubscriptionDoc>("subscription");
  const business = database.collection<BusinessDoc>("business");
  const campaign = database.collection<CampaignDoc>("campaign");
  const action = database.collection<ActionDoc>("action");
  const report = database.collection<ReportDoc>("report");

  await Promise.all([
    user.createIndex({ email: 1 }, { unique: true }),
    subscription.createIndex({ org_id: 1, automation_slug: 1 }, { unique: true }),
    business.createIndex({ org_id: 1 }),
    campaign.createIndex({ business_id: 1 }),
    action.createIndex({ campaign_id: 1 }),
    report.createIndex({ campaign_id: 1 }),
  ]);

  return { client, database, org, user, subscription, business, campaign, action, report, close: () => client.close() };
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
