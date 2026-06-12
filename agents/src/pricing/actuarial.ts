// Deterministic actuarial baseline. Anyone can recompute every number on
// this floor: base rate = observed trigger frequency over the recent
// observation window, projected over the policy tenor, with a floor and a
// cap. Personas adjust around this baseline within published bounds — the
// model is auditable, the personality is priced on top.

import type { PerilSpec, SnapshotObservation } from "../lib/types.js";

export interface BaseRate {
  rate_bps: number;
  trigger_freq: number;
  sample: number;
  prior_bps: number;
}

// Priors per source family, used until enough observations accumulate.
// Expressed as bps of payout for a 24h policy.
const PRIORS: Record<string, number> = {
  "istanbul-rain-24h": 900, // rain happens
  "quake-global-1h": 2500, // an M4.5+ somewhere on Earth is common
  "solar-kp": 400, // storms are rarer
  "cs2-players": 600,
};
const DEFAULT_PRIOR = 800;
const MIN_RATE_BPS = 30;
const MAX_RATE_BPS = 9_000;

export function wouldTrigger(spec: Pick<PerilSpec, "gte" | "threshold">, value: number): boolean {
  return spec.gte ? value >= spec.threshold : value <= spec.threshold;
}

/**
 * Estimate the per-tenor trigger probability from recent observations and
 * convert it to a premium rate in basis points.
 */
export function baseRate(
  spec: PerilSpec,
  recent: SnapshotObservation[],
): BaseRate {
  const prior_bps = PRIORS[spec.source_id] ?? DEFAULT_PRIOR;
  const sample = recent.length;
  if (sample < 6) {
    return { rate_bps: prior_bps, trigger_freq: -1, sample, prior_bps };
  }
  const hits = recent.filter((o) => wouldTrigger(spec, o.value)).length;
  // Laplace smoothing keeps a quiet window from pricing risk at zero.
  const freq = (hits + 1) / (sample + 2);
  const raw = Math.round(freq * 10_000);
  // Blend with the prior so a short sample can't whipsaw the floor.
  const blended = Math.round(0.7 * raw + 0.3 * prior_bps);
  const rate_bps = Math.max(MIN_RATE_BPS, Math.min(MAX_RATE_BPS, blended));
  return { rate_bps, trigger_freq: freq, sample, prior_bps };
}
