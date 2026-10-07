# AppQuantive Backend

The shared, multi-tenant backend for AppQuantive's automation products. Customers sign up once, subscribe
to one or more automations (by slug, matching the catalog in `appquantive-web`'s `automations.ts`), and
each automation module handles its own execution behind that subscription check.

Run it: `npm install`, copy `.env.example` to `.env`, then `npm start` (Node 24, no build step).
Tests: `npm test`. Types: `npm run typecheck`.

## Structure

```
src/
  platform/      Shared across every automation: db, auth, orgs, plans, subscriptions, admin routes
  modules/
    meta-ads/    Meta Ads AI — the first automation module, fully self-contained
  server.ts      Wires platform + modules together, starts the scheduler
```

A new automation module lives in its own `src/modules/<name>/` directory, registers its own routes via a
`register<Name>Routes(app, db, subs, deps)` function (see `modules/meta-ads/routes.ts`), and is added to
`AUTOMATION_MODULES` in `platform/app.ts` so it shows up in `GET /api/automations` and can be subscribed to.

## Accounts, orgs, and subscriptions

- Each customer is an **org** (workspace) with its own users and subscriptions; owners only see their own
  org's data (foreign ids return 404).
- **Self-serve signup:** `POST /api/auth/signup` creates an org + owner on the `starter` plan.
  Set `SIGNUP_OPEN=false` to disable.
- **AppQuantive staff admin:** set `ADMIN_EMAIL`/`ADMIN_PASSWORD` to seed an admin on first boot. Admins
  create client workspaces (`POST /api/admin/orgs`), manage any org's plan and subscriptions, and see every
  org's data.
- **Plans** (`src/platform/plans.ts`, placeholder prices) cap how many automations an org can have active
  at once (`maxActiveAutomations`). Automation-specific limits (e.g. Meta Ads AI's daily spend cap) live in
  that module's own config, not in the platform plan.
- **Subscriptions** (`subscription` table) track which automation slugs an org has active:
  - `GET /api/automations` — list available automation modules (public).
  - `GET /api/me` — current user + plan + active subscriptions.
  - `POST /api/subscriptions` `{ slug }` — subscribe (enforces the plan's `maxActiveAutomations` cap).
  - `DELETE /api/subscriptions/:slug` — unsubscribe.
  - Admin equivalents: `POST`/`DELETE /api/admin/orgs/:id/subscriptions[/:slug]`.
- A module's own routes call `subs.requireSubscription(orgId, slug)` to gate access.

## Meta Ads AI module

AI plans, launches and optimizes Meta ads for small businesses. Claude handles strategy, copy and report
writing; plain tested code handles execution and guardrails.

Every Meta call goes through the `MarketingApi` interface. `META_DRY_RUN=true` (default) records calls
instead of sending them. Without `ANTHROPIC_API_KEY` the app uses an offline fallback so the whole flow
works.

| Module | File | AI? |
|---|---|---|
| Onboarding profile | `schemas.ts`, `POST /api/businesses` | schema only |
| Strategist | `ai/strategist.ts` (JSON validated by zod, hard rules re-applied in `sanitizePlan`) | AI |
| Creative + policy check | `ai/creative.ts`, `ai/policy.ts` | AI + code |
| Execution | `execution.ts`, `meta/client.ts` (creates PAUSED, activates last) | code |
| Monitoring | `monitoring/rules.ts` (rules), `summary.ts` (Claude only explains) | rules + AI |
| Guardrails | `guardrails.ts` (max spend, max daily change, approval, kill switch) | code |
| Tokens | `crypto.ts` AES-256-GCM, key from `TOKEN_ENC_KEY` | code |

Flow: `POST /api/subscriptions {slug:"ai-meta-ads-automation"}` → `POST /api/businesses` → `/connect` →
`/propose` → `POST /api/campaigns/:id/approve` → daily `/optimize` (also run hourly by the scheduler, at
most once per 24h per campaign) → `/api/actions/:id/approve|reject`. `/api/businesses/:id/kill` pauses
everything.

## Who pays what (Meta Ads AI)

Clients pay Meta directly for ad spend (card on their own ad account, checked at connect time). The
AppQuantive subscription fee is separate and not yet wired to a payment provider.

## Not done yet (needs you)

- **Meta App Review** (`ads_management`, `ads_read`, `business_management`) and Advanced Access: start now,
  it is the long pole. Verify permission names against current Meta docs.
- **Facebook Login:** built (`modules/meta-ads/meta/auth.ts`, state-signed OAuth, long-lived token, ad
  account + Page picker, blocks accounts with no card, inactive status or non-INR currency) but only
  exercised in dry-run. Needs a real Meta app (`META_APP_ID/SECRET`, optional `META_LOGIN_CONFIG_ID`,
  redirect URI registered). Tokens last ~60 days: there is no reminder email or silent refresh yet.
- Real Graph API calls (`GraphApi`) are untested against Meta. Test them first in a sandbox ad account with
  `META_DRY_RUN=false`. Field names and API version (`META_API_VERSION`) may need changes.
- Google OAuth and phone+password sign-in (email+password only today).
- A real React frontend (dashboard) — today's `public/index.html` is a minimal placeholder.
- Image upload/cropping (1:1, 4:5, 9:16), AI images, Pixel/Conversions API, lead-form creation, Special Ad
  Category flow in the UI.
- Billing: plans exist but nothing charges yet (Razorpay/Stripe subscriptions, or % of spend from Insights).
  Also missing: password reset, email verification, team invites, audit log, rate limiting.
- Postgres (SQLite via `node:sqlite` for now), a durable job queue.
- Additional automation modules beyond Meta Ads AI (Hiring AI, Lead Routing AI, etc. from the
  appquantive-web catalog) — same module pattern, not yet built.
- Phase 2: auto-apply (`limits.autoApply`) exists but spend increases always require approval.
