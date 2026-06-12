// Shared shapes. Commands mirror contracts/bin/executor.rs exactly — the
// executor is the only thing that touches keys, so this file is the whole
// contract between "agents decide" and "chain executes".

export type Command =
  | { actor: number; op: "register_source"; source_id: string; description: string; upstream_url: string; scale_note: string }
  | { actor: number; op: "add_reporter"; reporter: string }
  | { actor: number; op: "post_observation"; source_id: string; value: number; observed_at: number; provenance: string }
  | { actor: number; op: "deploy_threshold_peril"; gte: boolean; threshold: number; label: string; forge_tag: string }
  | { actor: number; op: "list_peril"; source_id: string; trigger: string }
  | { actor: number; op: "register_syndicate"; name: string; motto: string; reserve_bps: number }
  | { actor: number; op: "deposit_capital"; syndicate_id: number; amount_motes: string }
  | { actor: number; op: "quote_rate"; syndicate_id: number; peril_id: number; rate_bps: number }
  | { actor: number; op: "bind_policy"; peril_id: number; syndicate_id: number; payout_motes: string; expires_at: number; premium_motes: string }
  | { actor: number; op: "settle"; policy_id: number; obs_seq: number }
  | { actor: number; op: "expire"; policy_id: number }
  | { actor: number; op: "ring_solvency_check"; syndicate_id: number }
  | { actor: number; op: "propose_treaty"; cedent_id: number; reinsurer_id: number; share_bps: number }
  | { actor: number; op: "accept_treaty"; cedent_id: number; reinsurer_id: number };

export interface CommandFile {
  commands: Command[];
}

// --- Snapshot, as written by the executor ---------------------------------

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

export interface Snapshot {
  network: string;
  oracle: string;
  bazaar: string;
  counts: { syndicates: number; perils: number; policies: number };
  syndicates: SnapshotSyndicate[];
  perils: SnapshotPeril[];
  policies: SnapshotPolicy[];
  observations: { source_id: string; count: number; recent: SnapshotObservation[] }[];
}

// --- Local peril registry (decision-side knowledge of trigger params) ------
//
// The chain is the source of truth for settlement; this registry is the
// keeper's working knowledge of what each trigger contract was deployed
// with, so it can decide when settling is worth attempting. A wrong entry
// costs one reverted TriggerNotMet call, never a wrong payout.

export interface PerilSpec {
  peril_id: number;
  source_id: string;
  gte: boolean;
  threshold: number;
  label: string;
  forge_tag: string;
  /// Default cover sold on the floor, in motes.
  demo_payout_motes: string;
  /// Default policy tenor in milliseconds.
  demo_tenor_ms: number;
}

export const MOTES_PER_CSPR = 1_000_000_000n;

export function cspr(n: number): string {
  return (BigInt(Math.round(n * 1000)) * MOTES_PER_CSPR / 1000n).toString();
}
