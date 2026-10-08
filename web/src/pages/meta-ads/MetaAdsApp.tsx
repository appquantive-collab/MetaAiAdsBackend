import { useEffect, useState } from "react";
import Layout from "../../components/Layout";
import OnboardingForm from "./OnboardingForm";
import ConnectMeta from "./ConnectMeta";
import ProposeCampaign from "./ProposeCampaign";
import LiveCampaign from "./LiveCampaign";

const BUSINESS_KEY = "appquantive_meta_ads_business_id";
const CAMPAIGN_KEY = "appquantive_meta_ads_campaign_id";

type Step = "onboarding" | "connect" | "propose" | "live";

export default function MetaAdsApp() {
  const [businessId, setBusinessId] = useState<string | null>(() => sessionStorage.getItem(BUSINESS_KEY));
  const [campaignId, setCampaignId] = useState<string | null>(() => sessionStorage.getItem(CAMPAIGN_KEY));
  const [step, setStep] = useState<Step>(() => {
    if (sessionStorage.getItem(CAMPAIGN_KEY)) return "propose";
    if (sessionStorage.getItem(BUSINESS_KEY)) return "connect";
    return "onboarding";
  });

  // Returning from the Facebook OAuth redirect (?meta=connected|denied).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const metaStatus = params.get("meta");
    if (metaStatus) {
      window.history.replaceState({}, "", window.location.pathname.replace(/\/meta-ads.*/, "/meta-ads"));
      if (metaStatus === "connected" && sessionStorage.getItem(BUSINESS_KEY)) setStep("connect");
    }
  }, []);

  const handleBusinessCreated = (id: string) => {
    sessionStorage.setItem(BUSINESS_KEY, id);
    setBusinessId(id);
    setStep("connect");
  };

  const handleProposeReady = () => setStep("propose");

  const handleCampaignLaunched = (id: string) => {
    sessionStorage.setItem(CAMPAIGN_KEY, id);
    setCampaignId(id);
    setStep("live");
  };

  const handleKilled = () => {
    sessionStorage.removeItem(CAMPAIGN_KEY);
    setCampaignId(null);
    setStep("propose");
  };

  return (
    <Layout>
      <section className="max-w-2xl mx-auto px-5 pt-10 pb-20">
        <StepHeader step={step} />

        {step === "onboarding" && <OnboardingForm onCreated={handleBusinessCreated} />}
        {step === "connect" && businessId && (
          <ConnectMeta businessId={businessId} onReady={handleProposeReady} />
        )}
        {step === "propose" && businessId && (
          <ProposeCampaign businessId={businessId} onLaunched={handleCampaignLaunched} />
        )}
        {step === "live" && campaignId && businessId && (
          <LiveCampaign campaignId={campaignId} businessId={businessId} onKilled={handleKilled} />
        )}
      </section>
    </Layout>
  );
}

function StepHeader({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "onboarding", label: "Business" },
    { id: "connect", label: "Connect Meta" },
    { id: "propose", label: "Review & launch" },
    { id: "live", label: "Live" },
  ];
  const activeIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 flex-1">
          <div
            className={`flex items-center gap-2 text-xs font-medium ${
              i <= activeIndex ? "text-ink" : "text-ink-faint"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.65rem] shrink-0 ${
                i < activeIndex ? "bg-ink text-white" : i === activeIndex ? "bg-brand text-white" : "bg-line text-ink-faint"
              }`}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline whitespace-nowrap">{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`h-px flex-1 ${i < activeIndex ? "bg-ink" : "bg-line"}`} />}
        </div>
      ))}
    </div>
  );
}
