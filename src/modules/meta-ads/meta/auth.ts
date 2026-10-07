import { config } from "../../../platform/config.ts";
import { MetaError } from "./client.ts";

export type AdAccount = {
  id: string; name: string; currency: string;
  /** Meta account_status: 1 = ACTIVE. Anything else cannot run ads. */
  status: number;
  /** True when the client has a payment method (card) on the ad account. */
  hasPaymentMethod: boolean;
};
export type FbPage = { id: string; name: string };
export type Assets = { adAccounts: AdAccount[]; pages: FbPage[] };
export type Exchanged = { token: string; expiresAt: string };

/** Facebook Login for Business + asset discovery. Each client connects their own ad account and card. */
export interface MetaAuth {
  loginUrl(state: string): string;
  exchangeCode(code: string): Promise<Exchanged>;
  assets(token: string): Promise<Assets>;
}

const FB = `https://www.facebook.com/${config.metaApiVersion}`;
const GRAPH = `https://graph.facebook.com/${config.metaApiVersion}`;

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
  const json: any = await res.json();
  if (json.error) throw new MetaError(json.error.message, json.error.code);
  return json as T;
}

export class GraphAuth implements MetaAuth {
  loginUrl(state: string) {
    const q = new URLSearchParams({
      client_id: config.metaAppId, redirect_uri: config.metaRedirectUri, state, response_type: "code",
      // Facebook Login for Business uses a configuration (permissions are set on it) instead of scope.
      ...(config.metaLoginConfigId ? { config_id: config.metaLoginConfigId } : { scope: "ads_management,ads_read,business_management,pages_show_list" }),
    });
    return `${FB}/dialog/oauth?${q}`;
  }

  async exchangeCode(code: string): Promise<Exchanged> {
    const short = await graph<{ access_token: string }>("oauth/access_token", {
      client_id: config.metaAppId, client_secret: config.metaAppSecret, redirect_uri: config.metaRedirectUri, code,
    });
    // Swap for a long-lived token (about 60 days). Clients must reconnect after expiry.
    const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
      grant_type: "fb_exchange_token", client_id: config.metaAppId, client_secret: config.metaAppSecret,
      fb_exchange_token: short.access_token,
    });
    const ttl = (long.expires_in ?? 60 * 86400) * 1000;
    return { token: long.access_token, expiresAt: new Date(Date.now() + ttl).toISOString() };
  }

  async assets(token: string): Promise<Assets> {
    const [acc, pages] = await Promise.all([
      graph<{ data: any[] }>("me/adaccounts", {
        access_token: token, limit: "100",
        fields: "account_id,name,account_status,currency,funding_source_details",
      }),
      graph<{ data: any[] }>("me/accounts", { access_token: token, fields: "id,name", limit: "100" }),
    ]);
    return {
      adAccounts: acc.data.map((a) => ({
        id: String(a.account_id), name: a.name, currency: a.currency, status: a.account_status,
        hasPaymentMethod: !!a.funding_source_details?.id,
      })),
      pages: pages.data.map((p) => ({ id: p.id, name: p.name })),
    };
  }
}

/** Dev mode: the "Facebook" step is a local redirect that returns fake assets. */
export class DryRunAuth implements MetaAuth {
  loginUrl(state: string) {
    return `${config.publicUrl}/api/meta/callback?${new URLSearchParams({ code: "dry-code", state })}`;
  }
  async exchangeCode() {
    return { token: "dry-token", expiresAt: new Date(Date.now() + 60 * 86400_000).toISOString() };
  }
  async assets(): Promise<Assets> {
    return {
      adAccounts: [
        { id: "1001", name: "Demo ad account", currency: "INR", status: 1, hasPaymentMethod: true },
        { id: "1002", name: "No card on file", currency: "INR", status: 1, hasPaymentMethod: false },
      ],
      pages: [{ id: "2001", name: "Demo Page" }],
    };
  }
}

export const makeAuth = (): MetaAuth => (config.metaDryRun ? new DryRunAuth() : new GraphAuth());
