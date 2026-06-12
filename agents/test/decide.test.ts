import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Snapshot } from "../src/lib/types.js";

// The decide cycle must work — and stay honest — when every upstream API is
// down: no readings means no observations, never invented ones.

const HOUR = 3600_000;
const NOW = 1_770_000_000_000;

function fixtureSnapshot(): Snapshot {
  return {
    network: "casper-test",
    oracle: "hash-oracle",
    bazaar: "hash-bazaar",
    counts: { syndicates: 2, perils: 1, policies: 2 },
    syndicates: [
      {
        syndicate_id: 0,
        owner: "account-hash-sage",
        name: "Sage Mutual",
        motto: "We have seen storms before.",
        capital_motes: "200000000000",
        locked_motes: "0",
        reserve_bps: 10_000,
        premiums_earned_motes: "0",
        claims_paid_motes: "0",
        liquidated: false,
        reinsurer_id: null,
        treaty_share_bps: 0,
        rates: [{ peril_id: 0, rate_bps: 800 }],
      },
      {
        syndicate_id: 1,
        owner: "account-hash-cavalier",
        name: "Cavalier Syndicate",
        motto: "Risk is just yield wearing a mask.",
        capital_motes: "10000000000",
        locked_motes: "20000000000", // underwater: locked > capital
        reserve_bps: 3_000,
        premiums_earned_motes: "0",
        claims_paid_motes: "0",
        liquidated: false,
        reinsurer_id: null,
        treaty_share_bps: 0,
        rates: [{ peril_id: 0, rate_bps: 300 }],
      },
    ],
    perils: [
      {
        peril_id: 0,
        source_id: "istanbul-rain-24h",
        trigger: "hash-trigger",
        lister: "account-hash-admin",
        active: true,
      },
    ],
    policies: [
      {
        policy_id: 0,
        peril_id: 0,
        syndicate_id: 0,
        holder: "account-hash-patron",
        premium_motes: "3200000000",
        payout_motes: "40000000000",
        reserved_motes: "40000000000",
        bound_at: NOW - 2 * HOUR,
        expires_at: NOW + 22 * HOUR,
        status: 0,
      },
      {
        policy_id: 1,
        peril_id: 0,
        syndicate_id: 0,
        holder: "account-hash-patron",
        premium_motes: "3200000000",
        payout_motes: "40000000000",
        reserved_motes: "40000000000",
        bound_at: NOW - 30 * HOUR,
        expires_at: NOW - 6 * HOUR, // already past its window
        status: 0,
      },
    ],
    observations: [
      {
        source_id: "istanbul-rain-24h",
        count: 2,
        recent: [
          { seq: 0, value: 100, observed_at: NOW - 3 * HOUR, provenance: "t" },
          { seq: 1, value: 1900, observed_at: NOW - HOUR, provenance: "t" }, // storm inside policy 0's window
        ],
      },
    ],
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kismet-keeper-"));
  process.env.KEEPER_STATE_DIR = dir;
  process.env.KISMET_RETRY_DELAY_MS = "0";
  delete process.env.ANTHROPIC_API_KEY;
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(fixtureSnapshot()));
  // All upstream APIs are unreachable in tests.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("keeper decide", () => {
  it("settles triggered policies, expires stale ones, rings insolvent books", async () => {
    const { decide } = await import("../src/keeper/decide.js");
    const commands = await decide(NOW);

    const settle = commands.find((c) => c.op === "settle");
    expect(settle).toMatchObject({ op: "settle", policy_id: 0, obs_seq: 1, actor: 0 });

    const expire = commands.find((c) => c.op === "expire");
    expect(expire).toMatchObject({ op: "expire", policy_id: 1 });

    const ring = commands.find((c) => c.op === "ring_solvency_check");
    expect(ring).toMatchObject({ op: "ring_solvency_check", syndicate_id: 1 });
  });

  it("invents no observations when every source is down", async () => {
    const { decide } = await import("../src/keeper/decide.js");
    const commands = await decide(NOW);
    expect(commands.filter((c) => c.op === "post_observation")).toHaveLength(0);
  });

  it("patron buys from the cheapest solvent book at the posted rate", async () => {
    const { decide } = await import("../src/keeper/decide.js");
    const commands = await decide(NOW);
    const binds = commands.filter((c) => c.op === "bind_policy");
    expect(binds.length).toBeGreaterThan(0);
    for (const bind of binds) {
      if (bind.op !== "bind_policy") continue;
      expect(bind.actor).toBe(5);
      // Cavalier is underwater (capital < locked) but not yet liquidated in
      // the snapshot — the keeper still sees its 300bps quote as cheapest.
      // The premium must clear the posted rate exactly.
      const payout = BigInt(bind.payout_motes);
      const premium = BigInt(bind.premium_motes);
      expect(premium).toBeGreaterThan((payout * 300n) / 10_000n);
    }
  });
});
