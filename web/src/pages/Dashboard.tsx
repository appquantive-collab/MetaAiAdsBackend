import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { useAuth } from "../lib/AuthContext";
import { META_ADS_SLUG } from "../lib/constants";

const AUTOMATION_NAMES: Record<string, string> = {
  [META_ADS_SLUG]: "Meta Ads AI",
};

const AUTOMATION_ROUTES: Record<string, string> = {
  [META_ADS_SLUG]: "/meta-ads",
};

export default function Dashboard() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const active = (me?.subscriptions ?? []).filter((s) => s.status === "active");

  useEffect(() => {
    // Exactly one active automation: skip the picker and go straight in.
    if (active.length === 1) {
      const route = AUTOMATION_ROUTES[active[0]!.automation_slug];
      if (route) navigate(route, { replace: true });
    }
  }, [active, navigate]);

  if (!me) return null;

  return (
    <Layout>
      <section className="max-w-3xl mx-auto px-5 pt-14 pb-20">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Welcome{me.email ? `, ${me.email.split("@")[0]}` : ""}</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Plan: <span className="font-medium text-ink capitalize">{me.plan}</span>
        </p>

        {active.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-line bg-white p-7 text-center">
            <p className="text-ink-soft text-sm">You don't have any automations active yet.</p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {active.map((s) => (
              <button
                key={s.automation_slug}
                onClick={() => navigate(AUTOMATION_ROUTES[s.automation_slug] ?? "/dashboard")}
                className="text-left rounded-2xl border border-line bg-white p-6 hover:border-brand/40 hover:shadow-sm transition-all"
              >
                <h3 className="font-semibold text-ink">{AUTOMATION_NAMES[s.automation_slug] ?? s.automation_slug}</h3>
                <p className="mt-1 text-xs text-ink-faint">Active since {new Date(s.created_at).toLocaleDateString()}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
