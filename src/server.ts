import { buildApp } from "./platform/app.ts";
import { config } from "./platform/config.ts";
import { openDb } from "./platform/db.ts";
import { makeApi } from "./modules/meta-ads/meta/client.ts";
import { makeAuth } from "./modules/meta-ads/meta/auth.ts";

const app = await buildApp(await openDb(), { api: makeApi(), metaAuth: makeAuth() });
await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`AppQuantive backend on http://localhost:${config.port}  (metaDryRun=${config.metaDryRun}, claude=${config.anthropicKey !== ""})`);

// Job scheduler: check hourly; each live Meta Ads campaign is optimized at most once per 24h.
setInterval(() => void app.runDaily(), 60 * 60 * 1000);
