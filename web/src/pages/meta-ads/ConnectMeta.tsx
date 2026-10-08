import { useState } from "react";
import { api, ApiError } from "../../lib/api";

export default function ConnectMeta({ businessId, onReady }: { businessId: string; onReady: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof api.metaAssets>> | null>(null);
  const [accountId, setAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await api.metaLoginUrl(businessId);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the Facebook connection. Try again.");
      setConnecting(false);
    }
  };

  const handleLoadAssets = async () => {
    setLoadingAssets(true);
    setError(null);
    try {
      const data = await api.metaAssets(businessId);
      setAssets(data);
      if (data.adAccounts[0]) setAccountId(data.adAccounts[0].id);
      if (data.pages[0]) setPageId(data.pages[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your Meta assets. Try reconnecting.");
    } finally {
      setLoadingAssets(false);
    }
  };

  const handleSelect = async () => {
    if (!accountId || !pageId) return;
    setSelecting(true);
    setError(null);
    try {
      await api.metaSelect(businessId, accountId, pageId);
      onReady();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your selection. Try again.");
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-ink">Connect your Meta ad account</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        You pay Meta directly for ad spend, with the card on your own ad account. We never see your card.
      </p>

      {!assets && (
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="w-full bg-[#0866ff] text-white font-semibold text-sm px-5 py-3 rounded-full disabled:opacity-50"
          >
            {connecting ? "Redirecting to Facebook…" : "Connect Facebook"}
          </button>
          <button
            type="button"
            onClick={handleLoadAssets}
            disabled={loadingAssets}
            className="w-full bg-white border border-line text-ink font-semibold text-sm px-5 py-3 rounded-full disabled:opacity-50"
          >
            {loadingAssets ? "Loading…" : "Already connected — load my accounts"}
          </button>
        </div>
      )}

      {assets && (
        <div className="mt-6 space-y-3">
          <Field label="Ad account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
              {assets.adAccounts.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.hasPaymentMethod || a.status !== 1}>
                  {a.name} ({a.currency}{!a.hasPaymentMethod ? ", no card" : ""}{a.status !== 1 ? ", inactive" : ""})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Facebook Page">
            <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={inputClass}>
              {assets.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={handleSelect}
            disabled={selecting}
            className="w-full bg-ink text-white font-semibold text-sm px-5 py-3 rounded-full disabled:opacity-50"
          >
            {selecting ? "Saving…" : "Use these and continue"}
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 bg-white";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-soft mb-1.5">{label}</label>
      {children}
    </div>
  );
}
