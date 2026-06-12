// The syndicates. Each is a key, a temperament, and a balance sheet.
//
// Pricing = deterministic actuarial baseline x persona bias x an optional
// LLM adjustment hard-bounded to ±30%. When ANTHROPIC_API_KEY is absent the
// floor still trades — the bias alone applies, and the reasoning log says
// so. Every quote's full reasoning is written to keeper-state/reasoning/
// so "the AI priced it" is checkable, not vibes.
//
// Cavalier's bias is not a script for bankruptcy; it is leverage plus
// underpricing, and the bell does the rest.

import { baseRate } from "./actuarial.js";
import type { PerilSpec, SnapshotObservation } from "../lib/types.js";

export interface Persona {
  /** Livenet account index — this syndicate's own key. */
  actor: number;
  name: string;
  motto: string;
  reserve_bps: number;
  /** Multiplicative pricing bias: >1 conservative, <1 aggressive. */
  bias: number;
  /** Style notes fed to the LLM adjuster, and published. */
  doctrine: string;
  /** Initial capital deposited at bootstrap, CSPR. */
  bootstrap_capital_cspr: number;
}

export const SYNDICATES: Persona[] = [
  {
    actor: 1,
    name: "Sage Mutual",
    motto: "We have seen storms before.",
    reserve_bps: 10_000,
    bias: 1.6,
    doctrine:
      "Old money. Prices tail risk first, walks away from anything it cannot fully reserve. Would rather earn nothing than owe anything.",
    bootstrap_capital_cspr: 220,
  },
  {
    actor: 2,
    name: "Cavalier Syndicate",
    motto: "Risk is just yield wearing a mask.",
    reserve_bps: 3_000,
    bias: 0.7,
    doctrine:
      "Writes cheap, reserves thin, wins volume. Believes diversification will save it. History disagrees.",
    bootstrap_capital_cspr: 120,
  },
  {
    actor: 3,
    name: "Meridian Re",
    motto: "Everyone needs a backstop.",
    reserve_bps: 10_000,
    bias: 1.3,
    doctrine:
      "Reinsurance house. Quotes direct cover rarely and dearly; its real book is quota-share treaties with the floor's gamblers.",
    bootstrap_capital_cspr: 260,
  },
  {
    actor: 4,
    name: "Atlas Parametric",
    motto: "The model is the message.",
    reserve_bps: 8_000,
    bias: 1.1,
    doctrine:
      "Quant shop. Prices close to the observed frequency with a modest margin and publishes its confidence interval.",
    bootstrap_capital_cspr: 180,
  },
];

export interface QuoteDecision {
  syndicate: string;
  peril_id: number;
  rate_bps: number;
  base_bps: number;
  bias: number;
  llm_delta: number;
  reasoning: string;
}

const LLM_BOUND = 0.3;

export async function decideQuote(
  persona: Persona,
  spec: PerilSpec,
  recent: SnapshotObservation[],
): Promise<QuoteDecision> {
  const base = baseRate(spec, recent);
  let llm_delta = 0;
  let reasoning =
    `${persona.name}: base ${base.rate_bps}bps` +
    (base.trigger_freq >= 0
      ? ` from ${base.sample} observations (freq ${(base.trigger_freq * 100).toFixed(1)}%)`
      : ` from prior (sample too small: ${base.sample})`) +
    `; doctrine bias x${persona.bias}.`;

  const adjusted = await llmAdjust(persona, spec, base.rate_bps, recent);
  if (adjusted) {
    llm_delta = Math.max(-LLM_BOUND, Math.min(LLM_BOUND, adjusted.delta));
    reasoning += ` LLM adjustment ${(llm_delta * 100).toFixed(0)}%: ${adjusted.why}`;
  } else {
    reasoning += " No LLM key in this cycle; doctrine alone applies.";
  }

  const rate = Math.round(base.rate_bps * persona.bias * (1 + llm_delta));
  const rate_bps = Math.max(30, Math.min(9_500, rate));
  return {
    syndicate: persona.name,
    peril_id: spec.peril_id,
    rate_bps,
    base_bps: base.rate_bps,
    bias: persona.bias,
    llm_delta,
    reasoning,
  };
}

interface LlmAdjustment {
  delta: number;
  why: string;
}

async function llmAdjust(
  persona: Persona,
  spec: PerilSpec,
  base_bps: number,
  recent: SnapshotObservation[],
): Promise<LlmAdjustment | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const series = recent.slice(-12).map((o) => o.value).join(",");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system:
          `You are the pricing desk of "${persona.name}", an insurance syndicate. Doctrine: ${persona.doctrine} ` +
          `Reply with strict JSON {"delta": number, "why": string} where delta is a premium adjustment between -0.3 and 0.3 ` +
          `(fraction of base rate) and why is one sentence in your syndicate's voice.`,
        messages: [
          {
            role: "user",
            content: `Peril: ${spec.label}. Base actuarial rate: ${base_bps}bps for a 24h policy. Recent observation series (scaled ints): [${series}]. Adjust?`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as LlmAdjustment;
    if (typeof parsed.delta !== "number" || typeof parsed.why !== "string") return null;
    return parsed;
  } catch {
    return null; // pricing never blocks on the LLM
  }
}
