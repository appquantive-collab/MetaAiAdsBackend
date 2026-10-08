import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";

export default function LiveCampaign({
  campaignId,
  businessId,
  onKilled,
}: {
  campaignId: string;
  businessId: string;
  onKilled: () => void;
}) {
  const [campaign, setCampaign] = useState<Awaited<ReturnType<typeof api.campaign>> | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [killing, setKilling] = useState(false);

  const load = useCallback(async () => {
    try {
      setCampaign(await api.campaign(campaignId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the campaign.");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOptimize = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.optimize(campaignId);
      setSummary(r.summary);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't run today's optimization.");
    } finally {
      setRunning(false);
    }
  };

  const handleAction = async (actionId: string, verb: "approve" | "reject") => {
    try {
      if (verb === "approve") await api.approveAction(actionId);
      else await api.rejectAction(actionId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that action.");
    }
  };

  const handleKill = async () => {
    if (!confirm("Pause every live campaign for this business?")) return;
    setKilling(true);
    setError(null);
    try {
      await api.kill(businessId, true);
      onKilled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't pause the campaign.");
    } finally {
      setKilling(false);
    }
  };

  if (!campaign) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-ink-soft">Loading…</p>;
  }

  const pending = campaign.actions.filter((a) => a.status === "pending");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-ink">Live campaign</h1>
        <span className="text-xs font-medium uppercase tracking-wide text-green-700 bg-green-50 rounded-full px-2.5 py-1">
          {campaign.status}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-ink-soft">₹{campaign.plan.dailyBudgetInr}/day · {campaign.plan.objective}</p>

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleOptimize}
          disabled={running}
          className="flex-1 bg-ink text-white font-semibold text-sm px-5 py-3 rounded-full disabled:opacity-50"
        >
          {running ? "Checking…" : "Run today's check"}
        </button>
        <button
          type="button"
          onClick={handleKill}
          disabled={killing}
          className="flex-1 bg-white border border-red-200 text-red-600 font-semibold text-sm px-5 py-3 rounded-full disabled:opacity-50"
        >
          {killing ? "Pausing…" : "Kill switch (pause all)"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="mt-6 rounded-xl border border-line bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Today's summary</h3>
          <p className="text-sm text-ink-soft whitespace-pre-line leading-relaxed">{summary}</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Needs your approval</h3>
          <div className="space-y-2.5">
            {pending.map((a) => (
              <div key={a.id} className="rounded-xl border border-line bg-white p-4">
                <p className="text-sm text-ink">{a.note ?? a.type}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleAction(a.id, "approve")}
                    className="text-xs font-semibold bg-ink text-white rounded-full px-4 py-1.5"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAction(a.id, "reject")}
                    className="text-xs font-semibold bg-white border border-line text-ink rounded-full px-4 py-1.5"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {campaign.reports.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Recent reports</h3>
          <div className="space-y-2.5">
            {campaign.reports.map((r) => (
              <div key={r.id} className="rounded-xl border border-line bg-white p-4">
                <p className="text-xs text-ink-faint mb-1.5">{new Date(r.created_at).toLocaleString()}</p>
                <p className="text-sm text-ink-soft whitespace-pre-line leading-relaxed">{r.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
