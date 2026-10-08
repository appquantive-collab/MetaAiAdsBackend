import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";

export default function ProposeCampaign({
  businessId,
  onLaunched,
}: {
  businessId: string;
  onLaunched: (campaignId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<Awaited<ReturnType<typeof api.propose>> | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.propose(businessId);
        if (!cancelled) setProposal(p);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't generate a proposal. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const handleApprove = async () => {
    if (!proposal || !imageUrl) return;
    setApproving(true);
    setError(null);
    try {
      await api.approve(proposal.campaignId, imageUrl);
      onLaunched(proposal.campaignId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't launch the campaign. Try again.");
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-ink-soft">AI is drafting your campaign…</p>;
  }

  if (error && !proposal) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!proposal) return null;

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-ink">Review the proposal</h1>
      <p className="mt-1.5 text-sm text-ink-soft">Nothing is spent until you approve and launch.</p>

      <div className="mt-6 rounded-xl border border-line bg-white p-4">
        <div className="font-semibold text-sm text-ink">
          {proposal.plan.objective} · ₹{proposal.plan.dailyBudgetInr}/day for {proposal.plan.durationDays} days
        </div>
        <div className="mt-1 text-xs text-ink-soft">
          {proposal.plan.targeting.geo.city} +{proposal.plan.targeting.geo.radiusKm}km, ages{" "}
          {proposal.plan.targeting.ageMin}-{proposal.plan.targeting.ageMax} ({proposal.plan.targeting.mode})
        </div>
        <p className="mt-2 text-xs text-ink-faint leading-relaxed">{proposal.plan.rationale}</p>
      </div>

      <div className="mt-4 space-y-3">
        {proposal.variations.map((v, i) => (
          <div key={i} className="rounded-xl border border-line bg-white p-4">
            <div className="font-semibold text-sm text-ink">{v.headline}</div>
            <div className="text-xs text-ink-faint mt-0.5">
              {v.language} · {v.cta}
            </div>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">{v.primaryText}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <label className="block text-xs font-medium text-ink-soft mb-1.5">Ad image URL</label>
        <input
          required
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://example.com/your-image.jpg"
          className="w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 bg-white"
        />
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleApprove}
        disabled={approving || !imageUrl}
        className="w-full bg-ink text-white font-semibold text-sm px-5 py-3 rounded-full mt-5 disabled:opacity-50"
      >
        {approving ? "Launching…" : "Approve and launch"}
      </button>
    </div>
  );
}
