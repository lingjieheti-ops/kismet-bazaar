// One keeper cycle: look at the world, look at the books, decide.
//
// Reads  keeper-state/snapshot.json   (chain truth, written by the executor)
// Writes keeper-state/commands.json   (intents, executed by the executor)
//        keeper-state/reasoning/*.json (why each quote is what it is)
//
// Actor map: 0 oracle reporter & admin · 1-4 syndicates · 5 the patron
// (the house's own demo buyer — labeled as such everywhere; external
// holders buy through the x402 desk instead).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ALL_SOURCES } from "../sources/index.js";
import { PERILS } from "./registry.js";
import { SYNDICATES, decideQuote, type QuoteDecision } from "../pricing/personas.js";
import { wouldTrigger } from "../pricing/actuarial.js";
import {
  STATUS_ACTIVE,
  type Command,
  type Snapshot,
  type SnapshotObservation,
} from "../lib/types.js";

function stateDir(): string {
  return process.env.KEEPER_STATE_DIR ?? "keeper-state";
}
const PATRON_ACTOR = 5;
/** The patron tops the floor up to this many live policies, no further. */
const PATRON_TARGET_ACTIVE = 3;
/** Re-quote only when the new rate moves more than this vs the posted one. */
const REQUOTE_THRESHOLD = 0.1;

export async function decide(now: number = Date.now()): Promise<Command[]> {
  const snapshot = loadSnapshot();
  const commands: Command[] = [];

  // 1. Observe the world. Sources fail independently; a missing reading
  //    skips the observation, never fakes one.
  const readings = new Map<string, { value: number; provenance: string }>();
  for (const source of ALL_SOURCES) {
    try {
      const reading = await source.fetchReading();
      readings.set(source.id, reading);
      commands.push({
        actor: 0,
        op: "post_observation",
        source_id: source.id,
        value: reading.value,
        observed_at: now,
        provenance: reading.provenance,
      });
    } catch (e) {
      console.error(`source ${source.id} unreadable this cycle: ${e}`);
    }
  }

  if (!snapshot) {
    // Pre-genesis: nothing else to decide against.
    return commands;
  }

  // 2. Underwriters reprice. Quotes are skipped for liquidated books and
  //    for moves smaller than the requote threshold.
  const decisions: QuoteDecision[] = [];
  for (const persona of SYNDICATES) {
    const syn = snapshot.syndicates.find((s) => s.name === persona.name);
    if (!syn || syn.liquidated) continue;
    for (const spec of PERILS) {
      if (!snapshot.perils.some((p) => p.peril_id === spec.peril_id && p.active)) continue;
      if (persona.name === "Meridian Re" && spec.peril_id !== 3) continue; // treaty house quotes only the calibration line
      const recent = recentObs(snapshot, spec.source_id);
      const decision = await decideQuote(persona, spec, recent);
      decisions.push(decision);
      const posted = syn.rates.find((r) => r.peril_id === spec.peril_id)?.rate_bps ?? 0;
      const moved =
        posted === 0 || Math.abs(decision.rate_bps - posted) / posted > REQUOTE_THRESHOLD;
      if (moved) {
        commands.push({
          actor: persona.actor,
          op: "quote_rate",
          syndicate_id: syn.syndicate_id,
          peril_id: spec.peril_id,
          rate_bps: decision.rate_bps,
        });
      }
    }
  }
  persistReasoning(decisions, now);

  // 3. Settle what the world has triggered, expire what it has outlived.
  for (const policy of snapshot.policies) {
    if (policy.status !== STATUS_ACTIVE) continue;
    if (now > policy.expires_at) {
      commands.push({ actor: 0, op: "expire", policy_id: policy.policy_id });
      continue;
    }
    const spec = PERILS.find((p) => p.peril_id === policy.peril_id);
    if (!spec) continue;
    const hit = findTriggeringObs(snapshot, spec, policy.bound_at, policy.expires_at);
    if (hit !== null) {
      commands.push({
        actor: 0,
        op: "settle",
        policy_id: policy.policy_id,
        obs_seq: hit,
      });
    }
  }

  // 4. Public solvency duty: anyone may ring; the keeper actually does.
  for (const syn of snapshot.syndicates) {
    if (syn.liquidated) continue;
    if (BigInt(syn.capital_motes) < BigInt(syn.locked_motes)) {
      commands.push({
        actor: 0,
        op: "ring_solvency_check",
        syndicate_id: syn.syndicate_id,
      });
    }
  }

  // 5. The patron keeps the floor alive: top up to N live policies, buying
  //    from the cheapest solvent quote, premium at exactly the posted rate.
  const liveCount = snapshot.policies.filter((p) => p.status === STATUS_ACTIVE).length;
  const settling = commands.filter((c) => c.op === "settle" || c.op === "expire").length;
  let toBuy = Math.max(0, PATRON_TARGET_ACTIVE - Math.max(0, liveCount - settling));
  if (toBuy > 0) {
    const rotation = [...PERILS].sort(
      (a, b) => seedOf(now, a.peril_id) - seedOf(now, b.peril_id),
    );
    for (const spec of rotation) {
      if (toBuy === 0) break;
      const offer = bestOffer(snapshot, spec.peril_id);
      if (!offer) continue;
      const payout = BigInt(spec.demo_payout_motes);
      const premium = (payout * BigInt(offer.rate_bps)) / 10_000n + 1n;
      commands.push({
        actor: PATRON_ACTOR,
        op: "bind_policy",
        peril_id: spec.peril_id,
        syndicate_id: offer.syndicate_id,
        payout_motes: payout.toString(),
        expires_at: now + spec.demo_tenor_ms,
        premium_motes: premium.toString(),
      });
      toBuy--;
    }
  }

  return commands;
}

function loadSnapshot(): Snapshot | null {
  const path = join(stateDir(), "snapshot.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function recentObs(snapshot: Snapshot, source_id: string): SnapshotObservation[] {
  return snapshot.observations.find((o) => o.source_id === source_id)?.recent ?? [];
}

function findTriggeringObs(
  snapshot: Snapshot,
  spec: { source_id: string; gte: boolean; threshold: number },
  from: number,
  to: number,
): number | null {
  for (const obs of recentObs(snapshot, spec.source_id)) {
    if (obs.observed_at < from || obs.observed_at > to) continue;
    if (wouldTrigger(spec, obs.value)) return obs.seq;
  }
  return null;
}

function bestOffer(
  snapshot: Snapshot,
  peril_id: number,
): { syndicate_id: number; rate_bps: number } | null {
  let best: { syndicate_id: number; rate_bps: number } | null = null;
  for (const syn of snapshot.syndicates) {
    if (syn.liquidated) continue;
    const rate = syn.rates.find((r) => r.peril_id === peril_id)?.rate_bps ?? 0;
    if (rate === 0) continue;
    if (!best || rate < best.rate_bps) {
      best = { syndicate_id: syn.syndicate_id, rate_bps: rate };
    }
  }
  return best;
}

/** Deterministic rotation seed so the patron's taste varies by cycle. */
function seedOf(now: number, peril_id: number): number {
  const hour = Math.floor(now / 3600_000);
  return ((hour * 2654435761 + peril_id * 40503) >>> 0) % 1000;
}

function persistReasoning(decisions: QuoteDecision[], now: number) {
  if (decisions.length === 0) return;
  const dir = join(stateDir(), "reasoning");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    join(dir, `${stamp}.json`),
    JSON.stringify({ decided_at: now, decisions }, null, 2),
  );
}

// CLI entrypoint
const isMain = process.argv[1]?.endsWith("decide.js");
if (isMain) {
  decide()
    .then((commands) => {
      mkdirSync(stateDir(), { recursive: true });
      const path = join(stateDir(), "commands.json");
      writeFileSync(path, JSON.stringify({ commands }, null, 2));
      console.log(`keeper: ${commands.length} command(s) -> ${path}`);
      for (const c of commands) console.log(`  actor=${c.actor} ${c.op}`);
    })
    .catch((e) => {
      console.error("keeper decide failed:", e);
      process.exit(1);
    });
}
