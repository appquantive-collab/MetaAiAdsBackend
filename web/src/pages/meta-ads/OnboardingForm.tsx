import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";

export default function OnboardingForm({ onCreated }: { onCreated: (businessId: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [offer, setOffer] = useState("");
  const [dailyBudgetInr, setDailyBudgetInr] = useState(500);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [pageId, setPageId] = useState("");
  const [goal, setGoal] = useState<"whatsapp_messages" | "lead_forms">("whatsapp_messages");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const b = await api.createBusiness({
        name, type, city, offer, goal, dailyBudgetInr,
        whatsappNumber: whatsappNumber || undefined,
        pageId: pageId || undefined,
        languages: ["en", "hinglish"],
      });
      onCreated(b.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-ink">Tell us about your business</h1>
      <p className="mt-1.5 text-sm text-ink-soft">This shapes the targeting, creative, and budget AI proposes for you.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <Field label="Business name">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sweet Crumbs" className={inputClass} />
        </Field>
        <Field label="Business type">
          <input required value={type} onChange={(e) => setType(e.target.value)} placeholder="Bakery" className={inputClass} />
        </Field>
        <Field label="City">
          <input required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Delhi" className={inputClass} />
        </Field>
        <Field label="Offer">
          <input required value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Fresh cakes from ₹499" className={inputClass} />
        </Field>
        <Field label="Daily budget (₹)">
          <input
            required
            type="number"
            min={1}
            value={dailyBudgetInr}
            onChange={(e) => setDailyBudgetInr(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="WhatsApp number (optional)">
          <input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="+91 98765 43210" className={inputClass} />
        </Field>
        <Field label="Facebook Page ID (optional)">
          <input value={pageId} onChange={(e) => setPageId(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Goal">
          <select value={goal} onChange={(e) => setGoal(e.target.value as typeof goal)} className={inputClass}>
            <option value="whatsapp_messages">WhatsApp messages</option>
            <option value="lead_forms">Lead forms</option>
          </select>
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-ink text-white font-semibold text-sm px-5 py-3 rounded-full mt-2 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save and continue"}
        </button>
      </form>
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
