import { Link } from "react-router-dom";
import Layout from "../components/Layout";

export default function Landing() {
  return (
    <Layout>
      <section className="max-w-3xl mx-auto px-5 pt-24 pb-20 text-center">
        <span className="inline-block text-xs font-semibold uppercase tracking-wider text-brand bg-brand/10 rounded-full px-3 py-1 mb-6">
          Meta Ads AI
        </span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-ink leading-tight">
          Your Meta ads, planned, launched, and optimized by AI.
        </h1>
        <p className="mt-5 text-lg text-ink-soft max-w-xl mx-auto leading-relaxed">
          Connect your own Meta ad account, tell us about your business, and let AI handle targeting,
          creative, and daily optimization — you approve every spend change.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/signup"
            className="w-full sm:w-auto bg-ink text-white font-semibold text-sm px-7 py-3.5 rounded-full hover:-translate-y-0.5 transition-transform"
          >
            Try Now
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto bg-white border border-line text-ink font-semibold text-sm px-7 py-3.5 rounded-full hover:bg-surface transition-colors"
          >
            Log in
          </Link>
        </div>
      </section>
    </Layout>
  );
}
