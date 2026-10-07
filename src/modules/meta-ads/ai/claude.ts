import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { config } from "../../../platform/config.ts";

export const hasClaude = () => config.anthropicKey !== "";

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

/** Calls Claude and returns output validated against a zod schema. Retries once with the validation error. */
export async function askJson<T>(system: string, user: string, schema: ZodType<T>): Promise<T> {
  const client = new Anthropic({ apiKey: config.anthropicKey });
  let prompt = user;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model: config.model,
      max_tokens: 2000,
      system: `${system}\nRespond with a single JSON object only, no prose.`,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return schema.parse(extractJson(text));
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      prompt = `${user}\n\nYour previous output was invalid: ${lastErr}\nReturn corrected JSON.`;
    }
  }
  throw new Error(`Claude output failed validation: ${lastErr}`);
}
