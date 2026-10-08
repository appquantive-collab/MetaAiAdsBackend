import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { useAuth } from "../lib/AuthContext";
import { api, ApiError } from "../lib/api";
import { META_ADS_SLUG } from "../lib/constants";

export default function Signup() {
  const { signup, refresh } = useAuth();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(orgName, email, password);
      // "Try Now" means Meta Ads AI — subscribe right away so onboarding can continue straight through.
      await api.subscribe(META_ADS_SLUG).catch(() => undefined);
      // Re-fetch /api/me so the dashboard sees the subscription we just created, not the stale
      // signup-time snapshot (which always has subscriptions: []).
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <section className="max-w-sm mx-auto px-5 pt-16 pb-20">
        <h1 className="text-2xl font-bold tracking-tight text-ink text-center">Create your account</h1>
        <p className="mt-2 text-sm text-ink-soft text-center">
          Takes less than a minute — then we'll walk you through connecting Meta.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1.5">Business or agency name</label>
            <input
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Sweet Crumbs"
              className="w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1.5">Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
              className="w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1.5">Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              className="w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-ink text-white font-semibold text-sm px-5 py-3 rounded-full mt-2 disabled:opacity-50"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-sm text-ink-soft text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-brand font-medium">
            Log in
          </Link>
        </p>
      </section>
    </Layout>
  );
}
