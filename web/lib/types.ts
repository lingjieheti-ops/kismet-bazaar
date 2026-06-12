// Mirrors agents/src/lib/types.ts — the snapshot the executor writes is the
// whole contract between "chain settles" and "ledger displays". Keep in sync
// by hand; the ledger tolerates missing fields but never invents them.

export const STATUS_ACTIVE = 0;
export const STATUS_PAID = 1;
export const STATUS_EXPIRED = 2;
export const STATUS_VOIDED = 3;

export interface SnapshotSyndicate {
  syndicate_id: number;
  owner: string;
  name: string;
  motto: string;
  capital_motes: string;
  locked_motes: string;
  reserve_bps: number;
  premiums_earned_motes: string;
  claims_paid_motes: string;
  liquidated: boolean;
  reinsurer_id: number | null;
  treaty_share_bps: number;
  rates: { peril_id: number; rate_bps: number }[];
}

export interface SnapshotPeril {
  peril_id: number;
  source_id: string;
  trigger: string;
  lister: string;
  active: boolean;
}

export interface SnapshotPolicy {
  policy_id: number;
  peril_id: number;
  syndicate_id: number;
  holder: string;
  premium_motes: string;
  payout_motes: string;
  reserved_motes: string;
  bound_at: number;
  expires_at: number;
  status: number;
}

export interface SnapshotObservation {
  seq: number;
  value: number;
  observed_at: number;
  provenance: string;
}

export interface ObservationGroup {
  source_id: string;
  count: number;
  recent: SnapshotObservation[];
}

export interface Snapshot {
  network: string;
  oracle: string;
  bazaar: string;
  counts: { syndicates: number; perils: number; policies: number };
  syndicates: SnapshotSyndicate[];
  perils: SnapshotPeril[];
  policies: SnapshotPolicy[];
  observations: ObservationGroup[];
}

// Written by scripts/extract-deployments.mjs after the genesis deploy.
export interface Deployments {
  network?: string;
  oracle?: string;
  bazaar?: string;
  genesis_rain_trigger?: string | null;
  explorer?: string;
  recorded_from?: string;
}
