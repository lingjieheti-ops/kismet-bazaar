// The keeper's working knowledge of every listed peril's trigger params.
// Settlement truth lives on-chain; a stale entry here costs one reverted
// call, never a wrong payout.
//
// Thresholds use each source's scaled units (see sources/index.ts).

import type { PerilSpec } from "../lib/types.js";
import { cspr } from "../lib/types.js";

const HOUR = 3600_000;

export const PERILS: PerilSpec[] = [
  {
    peril_id: 0,
    source_id: "istanbul-rain-24h",
    gte: true,
    threshold: 1250, // 12.50mm/24h
    label: "Istanbul 24h rain >= 12.50mm",
    forge_tag: "template-forged",
    demo_payout_motes: cspr(40),
    demo_tenor_ms: 24 * HOUR,
  },
  {
    peril_id: 1,
    source_id: "quake-global-1h",
    gte: true,
    threshold: 550, // M5.5 anywhere on Earth within the hour
    label: "Earthquake M >= 5.5 worldwide (hourly window)",
    forge_tag: "template-forged",
    demo_payout_motes: cspr(30),
    demo_tenor_ms: 24 * HOUR,
  },
  {
    peril_id: 2,
    source_id: "solar-kp",
    gte: true,
    threshold: 50, // Kp >= 5.0 = G1 geomagnetic storm
    label: "Geomagnetic storm Kp >= 5.0",
    forge_tag: "template-forged",
    demo_payout_motes: cspr(25),
    demo_tenor_ms: 24 * HOUR,
  },
  {
    peril_id: 3,
    source_id: "quake-global-1h",
    gte: true,
    threshold: 450, // M4.5 — the calibration line, several hits per day
    label: "Earthquake M >= 4.5 worldwide (demo calibration peril)",
    forge_tag: "template-forged",
    demo_payout_motes: cspr(8),
    demo_tenor_ms: 12 * HOUR,
  },
];

export function perilSpec(peril_id: number): PerilSpec | undefined {
  return PERILS.find((p) => p.peril_id === peril_id);
}
