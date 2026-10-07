import { config } from "../../../platform/config.ts";

export type Insight = {
  adId: string; adSetId: string; spend: number; impressions: number; clicks: number;
  cpm: number; ctr: number; cpc: number; results: number; costPerResult: number | null; frequency: number;
};

/** Everything the app does against Meta goes through this interface. */
export interface MarketingApi {
  resolveCity(token: string, city: string): Promise<string>;
  createCampaign(token: string, accountId: string, p: { name: string; objective: string; specialCategory: string }): Promise<string>;
  createAdSet(token: string, accountId: string, p: Record<string, unknown>): Promise<string>;
  createCreative(token: string, accountId: string, p: Record<string, unknown>): Promise<string>;
  createAd(token: string, accountId: string, p: { name: string; adSetId: string; creativeId: string }): Promise<string>;
  setStatus(token: string, objectId: string, status: "ACTIVE" | "PAUSED"): Promise<void>;
  setDailyBudget(token: string, adSetId: string, minorUnits: number): Promise<void>;
  insights(token: string, accountId: string, since: string, until: string): Promise<Insight[]>;
}

export class MetaError extends Error {
  code?: number;
  retryable: boolean;
  constructor(message: string, code?: number, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export class GraphApi implements MarketingApi {
  private base = `https://graph.facebook.com/${config.metaApiVersion}`;

  private async call<T>(method: "GET" | "POST", path: string, token: string, params: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
      body.set("access_token", token);
      const url = method === "GET" ? `${this.base}/${path}?${body}` : `${this.base}/${path}`;
      const res = await fetch(url, method === "POST" ? { method, body } : { method });
      const json: any = await res.json();
      if (!json.error) return json as T;
      // 4 = app rate limit, 17 = user rate limit, 32/613 = page/custom rate limit, 80004 = ads management throttle
      const retryable = [4, 17, 32, 613, 80004].includes(json.error.code);
      if (retryable && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        continue;
      }
      throw new MetaError(json.error.message, json.error.code, retryable);
    }
  }

  async resolveCity(token: string, city: string) {
    const r = await this.call<{ data: { key: string }[] }>("GET", "search", token, {
      type: "adgeolocation", location_types: ["city"], q: city, country_code: "IN", limit: 1,
    });
    if (!r.data[0]) throw new MetaError(`City not found: ${city}`);
    return r.data[0].key;
  }
  async createCampaign(token: string, acct: string, p: { name: string; objective: string; specialCategory: string }) {
    const r = await this.call<{ id: string }>("POST", `act_${acct}/campaigns`, token, {
      name: p.name, objective: p.objective, status: "PAUSED",
      special_ad_categories: p.specialCategory === "NONE" ? [] : [p.specialCategory],
      buying_type: "AUCTION",
    });
    return r.id;
  }
  async createAdSet(token: string, acct: string, p: Record<string, unknown>) {
    return (await this.call<{ id: string }>("POST", `act_${acct}/adsets`, token, { ...p, status: "PAUSED" })).id;
  }
  async createCreative(token: string, acct: string, p: Record<string, unknown>) {
    return (await this.call<{ id: string }>("POST", `act_${acct}/adcreatives`, token, p)).id;
  }
  async createAd(token: string, acct: string, p: { name: string; adSetId: string; creativeId: string }) {
    return (await this.call<{ id: string }>("POST", `act_${acct}/ads`, token, {
      name: p.name, adset_id: p.adSetId, creative: { creative_id: p.creativeId }, status: "PAUSED",
    })).id;
  }
  async setStatus(token: string, id: string, status: "ACTIVE" | "PAUSED") {
    await this.call("POST", id, token, { status });
  }
  async setDailyBudget(token: string, id: string, minor: number) {
    await this.call("POST", id, token, { daily_budget: minor });
  }
  async insights(token: string, acct: string, since: string, until: string) {
    // One account-level call at ad level instead of one call per ad (rate limits scale with spend).
    const r = await this.call<{ data: any[] }>("GET", `act_${acct}/insights`, token, {
      level: "ad", time_range: { since, until }, limit: 500,
      fields: "ad_id,adset_id,spend,impressions,clicks,cpm,ctr,cpc,frequency,actions",
    });
    return r.data.map((d) => {
      const isResult = (a: any) => /messaging_conversation_started|lead/.test(a.action_type);
      const results = (d.actions ?? []).filter(isResult).reduce((s: number, a: any) => s + Number(a.value), 0);
      const spend = Number(d.spend ?? 0);
      return {
        adId: d.ad_id, adSetId: d.adset_id, spend, impressions: Number(d.impressions ?? 0),
        clicks: Number(d.clicks ?? 0), cpm: Number(d.cpm ?? 0), ctr: Number(d.ctr ?? 0), cpc: Number(d.cpc ?? 0),
        results, costPerResult: results > 0 ? spend / results : null, frequency: Number(d.frequency ?? 0),
      };
    });
  }
}

/** Safe default: records what would be sent, returns fake ids. */
export class DryRunApi implements MarketingApi {
  calls: { op: string; args: unknown }[] = [];
  insightsData: Insight[] = [];
  private n = 0;
  private id(prefix: string) { return `${prefix}_dry_${++this.n}`; }
  private log(op: string, args: unknown) { this.calls.push({ op, args }); }
  async resolveCity(_t: string, city: string) { this.log("resolveCity", city); return `city_${city}`; }
  async createCampaign(_t: string, _a: string, p: unknown) { this.log("createCampaign", p); return this.id("camp"); }
  async createAdSet(_t: string, _a: string, p: unknown) { this.log("createAdSet", p); return this.id("adset"); }
  async createCreative(_t: string, _a: string, p: unknown) { this.log("createCreative", p); return this.id("cre"); }
  async createAd(_t: string, _a: string, p: unknown) { this.log("createAd", p); return this.id("ad"); }
  async setStatus(_t: string, id: string, s: string) { this.log("setStatus", { id, s }); }
  async setDailyBudget(_t: string, id: string, m: number) { this.log("setDailyBudget", { id, m }); }
  async insights() { return this.insightsData; }
}

export const makeApi = (): MarketingApi => (config.metaDryRun ? new DryRunApi() : new GraphApi());
