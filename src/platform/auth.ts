import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "admin" | "owner"; // admin = our agency staff, owner = a client
export type User = { id: string; orgId: string; role: Role; email: string };

const secret = process.env.AUTH_SECRET || randomBytes(32).toString("hex");
if (!process.env.AUTH_SECRET) console.warn("AUTH_SECRET not set: sessions will be invalidated on restart");

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("base64")}.${scryptSync(pw, salt, 64).toString("base64")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(".").map((s) => Buffer.from(s, "base64"));
  const got = scryptSync(pw, salt!, 64);
  return got.length === hash!.length && timingSafeEqual(got, hash!);
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function issueToken(u: User, ttlMs = 7 * 86400_000): string {
  const body = b64(JSON.stringify({ ...u, exp: Date.now() + ttlMs }));
  return `${body}.${sign(body)}`;
}

/** Short-lived signed state for the OAuth round trip (no session cookie on the redirect back). */
export function signState(payload: Record<string, string>, ttlMs = 10 * 60_000): string {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  return `${body}.${sign(body)}`;
}
export function readState(state: string): Record<string, string> | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const have = Buffer.from(sig);
  if (want.length !== have.length || !timingSafeEqual(want, have)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  return p.exp < Date.now() || !p.b ? null : p; // must be an OAuth state, not a session token
}

export function readToken(token: string): User | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const have = Buffer.from(sig);
  if (want.length !== have.length || !timingSafeEqual(want, have)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  if (p.exp < Date.now() || !p.role || !p.orgId) return null; // not a session token (e.g. an OAuth state)
  return { id: p.id, orgId: p.orgId, role: p.role, email: p.email };
}
