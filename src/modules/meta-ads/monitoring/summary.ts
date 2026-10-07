import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../../platform/config.ts";
import type { ProposedAction } from "../guardrails.ts";
import type { Insight } from "../meta/client.ts";
import { hasClaude } from "../ai/claude.ts";

export function totals(insights: Insight[]) {
  const spend = insights.reduce((s, i) => s + i.spend, 0);
  const results = insights.reduce((s, i) => s + i.results, 0);
  const impressions = insights.reduce((s, i) => s + i.impressions, 0);
  const clicks = insights.reduce((s, i) => s + i.clicks, 0);
  return {
    spend, results, impressions, clicks,
    costPerResult: results ? spend / results : null,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
  };
}

export function templateSummary(insights: Insight[], actions: ProposedAction[]): string {
  const t = totals(insights);
  const head = `Yesterday you spent ₹${t.spend.toFixed(0)} and got ${t.results} result${t.results === 1 ? "" : "s"}` +
    (t.costPerResult ? ` (₹${t.costPerResult.toFixed(0)} each).` : ".");
  if (actions.length === 0) return `${head} Nothing needs changing today.`;
  return `${head} Suggested changes:\n${actions.map((a) => `- ${a.reason}`).join("\n")}`;
}

/** Claude explains numbers and actions that code already computed; it cannot add actions. */
export async function writeSummary(insights: Insight[], actions: ProposedAction[]): Promise<string> {
  if (!hasClaude()) return templateSummary(insights, actions);
  try {
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const res = await client.messages.create({
      model: config.model,
      max_tokens: 500,
      system: "You write a short daily ad report for a small business owner in plain, friendly English. Use only the numbers and actions given. Do not invent actions. Under 120 words.",
      messages: [{ role: "user", content: JSON.stringify({ totals: totals(insights), actions }) }],
    });
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  } catch {
    return templateSummary(insights, actions);
  }
}
