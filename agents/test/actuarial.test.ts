import { describe, expect, it } from "vitest";
import { baseRate, wouldTrigger } from "../src/pricing/actuarial.js";
import { clamp } from "../src/sources/index.js";
import type { PerilSpec, SnapshotObservation } from "../src/lib/types.js";

const spec: PerilSpec = {
  peril_id: 0,
  source_id: "istanbul-rain-24h",
  gte: true,
  threshold: 1250,
  label: "rain",
  forge_tag: "template-forged",
  demo_payout_motes: "1",
  demo_tenor_ms: 1,
};

function obs(values: number[]): SnapshotObservation[] {
  return values.map((value, seq) => ({
    seq,
    value,
    observed_at: seq,
    provenance: "test",
  }));
}

describe("wouldTrigger", () => {
  it("fires at and above a gte threshold", () => {
    expect(wouldTrigger(spec, 1249)).toBe(false);
    expect(wouldTrigger(spec, 1250)).toBe(true);
  });
  it("fires at and below an lte threshold", () => {
    const lte = { gte: false, threshold: 100 };
    expect(wouldTrigger(lte, 100)).toBe(true);
    expect(wouldTrigger(lte, 101)).toBe(false);
  });
});

describe("baseRate", () => {
  it("falls back to the prior with a thin sample", () => {
    const r = baseRate(spec, obs([0, 0, 0]));
    expect(r.rate_bps).toBe(900);
    expect(r.trigger_freq).toBe(-1);
  });
  it("prices higher when triggers are frequent", () => {
    const quiet = baseRate(spec, obs(Array(20).fill(0)));
    const stormy = baseRate(spec, obs(Array(20).fill(2000)));
    expect(stormy.rate_bps).toBeGreaterThan(quiet.rate_bps);
    expect(stormy.rate_bps).toBeLessThanOrEqual(9_000);
    expect(quiet.rate_bps).toBeGreaterThanOrEqual(30);
  });
  it("never prices a quiet window at zero (Laplace smoothing)", () => {
    const r = baseRate(spec, obs(Array(30).fill(0)));
    expect(r.rate_bps).toBeGreaterThan(0);
  });
});

describe("clamp", () => {
  it("clamps glitched readings into sane bounds", () => {
    expect(clamp(-5, [0, 100])).toBe(0);
    expect(clamp(1e9, [0, 100])).toBe(100);
    expect(clamp(42, [0, 100])).toBe(42);
  });
});
