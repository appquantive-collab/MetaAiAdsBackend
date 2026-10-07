import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";

export function openDb(path = config.dbPath): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    -- Platform: shared across every automation module.
    CREATE TABLE IF NOT EXISTS org (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL,
      role TEXT NOT NULL, created_at TEXT NOT NULL
    );
    -- Which automations (by slug, matching appquantive-web's automations.ts) an org has active.
    -- Meta Ads AI is just one row here ('ai-meta-ads-automation'); its own execution detail
    -- (business/campaign/action/report below) stays in that module's own tables.
    CREATE TABLE IF NOT EXISTS subscription (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, automation_slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, canceled_at TEXT,
      UNIQUE(org_id, automation_slug)
    );

    -- Meta Ads AI module tables.
    CREATE TABLE IF NOT EXISTS business (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, profile TEXT NOT NULL, token_enc TEXT, token_expires_at TEXT, account_id TEXT,
      limits TEXT NOT NULL, kill_switch INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, plan TEXT NOT NULL, ads TEXT NOT NULL,
      status TEXT NOT NULL, meta TEXT, image TEXT, last_optimized_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return db;
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
