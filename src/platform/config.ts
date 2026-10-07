export const config = {
  port: Number(process.env.PORT ?? 3000),
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5",
  // Meta Ads AI module config.
  metaDryRun: (process.env.META_DRY_RUN ?? "true") !== "false",
  metaApiVersion: process.env.META_API_VERSION ?? "v23.0",
  metaAppId: process.env.META_APP_ID ?? "",
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  metaLoginConfigId: process.env.META_LOGIN_CONFIG_ID ?? "",
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  get metaRedirectUri() { return process.env.META_REDIRECT_URI ?? `${this.publicUrl}/api/meta/callback`; },
  tokenEncKey: process.env.TOKEN_ENC_KEY ?? "",
  dbPath: process.env.DB_PATH ?? "./data/app.db",
};
