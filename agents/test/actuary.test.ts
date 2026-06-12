import { describe, expect, it } from "vitest";
import {
  assembleDeployBin,
  assembleModule,
  scanForbidden,
  validateDraft,
  type ForgeBrief,
  type ForgeDraft,
} from "../src/actuary/skeleton.js";

const brief: ForgeBrief = {
  brief: "Dead-server cover: pays out when CS2 concurrent players collapse below a floor",
  source_id: "cs2-players",
};

const goodDraft: ForgeDraft = {
  slug: "dead_server",
  struct_name: "DeadServerPeril",
  label: "CS2 concurrent players < 400,000",
  p0_meaning: "player-count floor",
  p1_meaning: "unused",
  default_p0: 400_000,
  default_p1: 0,
  evaluate_body: "value < p0",
  tests_body: `#[test]
fn fires_below_floor() {
    let peril = deploy(400_000, 0);
    assert!(peril.evaluate(399_999));
    assert!(!peril.evaluate(400_000));
}`,
  pitch: "Empty servers are an insurable event; we have seen quieter Tuesdays.",
};

describe("guarded skeleton", () => {
  it("accepts an honest draft", () => {
    expect(validateDraft(goodDraft)).toEqual([]);
  });

  it("rejects predicates that try to touch state, env, or funds", () => {
    for (const body of [
      "self.p0.set(&1); true",
      "self.env().caller(); true",
      "transfer_tokens(value); true",
      "loop { }",
      "unsafe { value < p0 }",
    ]) {
      expect(scanForbidden(body).length, body).toBeGreaterThan(0);
    }
  });

  it("rejects drafts without boundary tests or with bad names", () => {
    expect(validateDraft({ ...goodDraft, tests_body: "// none" })).not.toEqual([]);
    expect(validateDraft({ ...goodDraft, slug: "BadSlug" })).not.toEqual([]);
    expect(validateDraft({ ...goodDraft, struct_name: "not_a_peril" })).not.toEqual([]);
  });

  it("assembles a module with fixed shell and the draft's predicate", () => {
    const src = assembleModule(goodDraft, brief, "free-forged:abc123def456");
    expect(src).toContain("pub struct DeadServerPeril");
    expect(src).toContain("value < p0");
    expect(src).toContain("fn fires_below_floor()");
    expect(src).toContain("free-forged:abc123def456");
    expect(src).toContain("holds no funds");
    // The shell, not the LLM, controls these:
    expect(src).toContain("pub fn init(&mut self, label: String, forge_tag: String, p0: i64, p1: i64)");
    expect(scanForbidden(goodDraft.evaluate_body)).toEqual([]);
  });

  it("assembles a typed deploy bin wired to the bazaar", () => {
    const src = assembleDeployBin(goodDraft, brief, "free-forged:abc123def456");
    expect(src).toContain("DeadServerPeril::deploy");
    expect(src).toContain("KISMET_BAZAAR");
    expect(src).toContain('"cs2-players".to_string()');
  });
});
