export type Role = "admin" | "owner";
export type User = { id: string; orgId: string; role: Role; email: string };
export type Subscription = { automation_slug: string; status: string; created_at: string; canceled_at: string | null };
export type Me = User & { plan: string; subscriptions: Subscription[] };
export type AutomationModule = { slug: string; name: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = "appquantive_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  // --- Auth ---
  signup: (orgName: string, email: string, password: string) =>
    request<{ token: string; user: User }>("/api/auth/signup", { method: "POST", body: { orgName, email, password } }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: { email, password } }),
  me: () => request<Me>("/api/me"),

  // --- Automations / subscriptions ---
  automations: () => request<AutomationModule[]>("/api/automations"),
  subscribe: (slug: string) => request<{ subscribed: string }>("/api/subscriptions", { method: "POST", body: { slug } }),
  unsubscribe: (slug: string) => request<{ unsubscribed: string }>(`/api/subscriptions/${slug}`, { method: "DELETE" }),

  // --- Meta Ads AI module ---
  createBusiness: (body: {
    name: string; type: string; city: string; offer: string; goal: "whatsapp_messages" | "lead_forms";
    dailyBudgetInr: number; whatsappNumber?: string; pageId?: string; languages: string[];
  }) => request<{ id: string; profile: unknown; limits: unknown }>("/api/businesses", { method: "POST", body }),
  metaLoginUrl: (businessId: string) => request<{ url: string }>(`/api/businesses/${businessId}/meta/login-url`),
  metaAssets: (businessId: string) =>
    request<{
      adAccounts: { id: string; name: string; currency: string; status: number; hasPaymentMethod: boolean }[];
      pages: { id: string; name: string }[];
    }>(`/api/businesses/${businessId}/meta/assets`),
  metaSelect: (businessId: string, accountId: string, pageId: string) =>
    request<{ connected: boolean; account: string }>(`/api/businesses/${businessId}/meta/select`, {
      method: "POST",
      body: { accountId, pageId },
    }),
  propose: (businessId: string) =>
    request<{
      campaignId: string;
      plan: { objective: string; dailyBudgetInr: number; durationDays: number; rationale: string; targeting: { geo: { city: string; radiusKm: number }; ageMin: number; ageMax: number; mode: string } };
      variations: { language: string; headline: string; primaryText: string; cta: string }[];
      policyIssues: unknown[];
      needsRegeneration: boolean;
    }>(`/api/businesses/${businessId}/propose`, { method: "POST" }),
  approve: (campaignId: string, imageUrl: string) =>
    request<{ status: string; meta: unknown }>(`/api/campaigns/${campaignId}/approve`, { method: "POST", body: { imageUrl } }),
  campaign: (campaignId: string) =>
    request<{
      id: string;
      status: string;
      plan: { dailyBudgetInr: number; objective: string };
      actions: { id: string; status: string; note?: string; type: string }[];
      reports: { id: string; summary: string; created_at: string }[];
    }>(`/api/campaigns/${campaignId}`),
  optimize: (campaignId: string) =>
    request<{ summary: string; actions: { action: { type: string }; status: string; note?: string }[] }>(
      `/api/campaigns/${campaignId}/optimize`,
      { method: "POST" },
    ),
  approveAction: (actionId: string) => request<{ status: string }>(`/api/actions/${actionId}/approve`, { method: "POST" }),
  rejectAction: (actionId: string) => request<{ status: string }>(`/api/actions/${actionId}/reject`, { method: "POST" }),
  kill: (businessId: string, on: boolean) =>
    request<{ killSwitch: boolean }>(`/api/businesses/${businessId}/kill`, { method: "POST", body: { on } }),
};
