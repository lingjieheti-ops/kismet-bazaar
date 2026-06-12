// The Actuary's guarded skeleton.
//
// The LLM authors exactly three things: the trigger predicate, the tests,
// and the product language. Everything else — imports, storage shape, init
// signature, custody surface — is fixed here, deterministically. That line
// is the honest boundary of "an agent writes smart contracts", and we
// publish it rather than blur it.

export interface ForgeBrief {
  /** Free-text product idea, e.g. "calm-market cover: pays out when CS2 players drop below p0 while ..." */
  brief: string;
  /** Oracle source the product settles against. */
  source_id: string;
}

export interface ForgeDraft {
  /** snake_case module name, e.g. "calm_market". */
  slug: string;
  /** UpperCamelCase struct name ending in Peril, e.g. "CalmMarketPeril". */
  struct_name: string;
  /** One-line product label shown on the floor. */
  label: string;
  /** What p0 means, human words. */
  p0_meaning: string;
  /** What p1 means, human words. */
  p1_meaning: string;
  default_p0: number;
  default_p1: number;
  /** Rust expression/statement body of `evaluate`. Locals in scope: value, p0, p1 (all i64). Must end in a bool expression. */
  evaluate_body: string;
  /** Rust body of the tests module (one or more #[test] fns using `deploy(p0, p1)`). */
  tests_body: string;
  /** One sentence of underwriting rationale, in The Actuary's voice. */
  pitch: string;
}

// Patterns that must never appear in LLM-authored Rust. The skeleton gives
// the predicate no honest reason to use any of these.
export const FORBIDDEN_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /unsafe/i, why: "no unsafe code" },
  { re: /self\s*\.\s*env\s*\(/, why: "no environment access in a predicate" },
  { re: /\.set\s*\(/, why: "a predicate writes no state" },
  { re: /transfer|payable|attached_value/i, why: "a trigger holds no funds" },
  { re: /loop|while/, why: "no unbounded loops over a single integer" },
  { re: /std::|extern|include!|macro_rules|asm!/, why: "no imports, no macros, no escape hatches" },
  { re: /unwrap_or_revert|revert/, why: "a predicate answers true or false, it does not abort" },
  { re: /ContractRef|external_contract/, why: "no cross-contract calls from a predicate" },
  { re: /[^\x00-\x7F]/, why: "ASCII only (invisible-character hygiene)" },
];

export function scanForbidden(code: string): string[] {
  return FORBIDDEN_PATTERNS.filter(({ re }) => re.test(code)).map(
    ({ re, why }) => `${re} (${why})`,
  );
}

export function validateDraft(draft: ForgeDraft): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]{2,30}$/.test(draft.slug)) problems.push("slug must be snake_case");
  if (!/^[A-Z][A-Za-z0-9]{2,40}Peril$/.test(draft.struct_name))
    problems.push("struct_name must be UpperCamelCase ending in Peril");
  if (!draft.label || draft.label.length > 90) problems.push("label missing or too long");
  if (!Number.isFinite(draft.default_p0) || !Number.isFinite(draft.default_p1))
    problems.push("defaults must be finite numbers");
  if (!draft.evaluate_body.trim()) problems.push("empty evaluate body");
  if (!/#\[test\]/.test(draft.tests_body)) problems.push("tests_body must contain at least one #[test]");
  problems.push(...scanForbidden(draft.evaluate_body).map((p) => `evaluate: ${p}`));
  problems.push(...scanForbidden(draft.tests_body).map((p) => `tests: ${p}`));
  return problems;
}

/** Assemble the complete forged module, deterministically. */
export function assembleModule(draft: ForgeDraft, brief: ForgeBrief, forgeTag: string): string {
  return `//! FORGED PERIL — authored by The Actuary, KISMET's contract-writing agent.
//!
//! Product brief : ${brief.brief.replace(/\n/g, " ")}
//! Settles against: ${brief.source_id}
//! p0 = ${draft.p0_meaning} (default ${draft.default_p0})
//! p1 = ${draft.p1_meaning} (default ${draft.default_p1})
//! Rationale     : ${draft.pitch.replace(/\n/g, " ")}
//! Provenance    : ${forgeTag} — full trail in docs/forge/${draft.slug}.json
//!
//! The Actuary wrote the predicate and the tests. The module shell, storage
//! shape, and init signature are fixed by the skeleton; a trigger contract
//! holds no funds and cannot move any.

use odra::prelude::*;

#[odra::module]
pub struct ${draft.struct_name} {
    label: Var<String>,
    forge_tag: Var<String>,
    p0: Var<i64>,
    p1: Var<i64>,
}

#[odra::module]
impl ${draft.struct_name} {
    pub fn init(&mut self, label: String, forge_tag: String, p0: i64, p1: i64) {
        self.label.set(label);
        self.forge_tag.set(forge_tag);
        self.p0.set(p0);
        self.p1.set(p1);
    }

    pub fn evaluate(&self, value: i64) -> bool {
        let p0 = self.p0.get_or_default();
        let p1 = self.p1.get_or_default();
        let _ = p1;
        ${indent(draft.evaluate_body.trim(), 8)}
    }

    pub fn describe(&self) -> String {
        self.label.get_or_default()
    }

    pub fn forge_provenance(&self) -> String {
        self.forge_tag.get_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::Deployer;

    fn deploy(p0: i64, p1: i64) -> ${draft.struct_name}HostRef {
        let env = odra_test::env();
        ${draft.struct_name}::deploy(
            &env,
            ${draft.struct_name}InitArgs {
                label: "${draft.label}".to_string(),
                forge_tag: "${forgeTag}".to_string(),
                p0,
                p1,
            },
        )
    }

    ${indent(draft.tests_body.trim(), 4)}
}
`;
}

/** Deterministic deploy bin for a forged peril (typed, no codegen magic). */
export function assembleDeployBin(draft: ForgeDraft, brief: ForgeBrief, forgeTag: string): string {
  return `//! Deploys the forged peril \`${draft.struct_name}\` and lists it on the bazaar.
//! Generated deterministically by The Actuary's forge; see docs/forge/${draft.slug}.json.
//!
//! Env: standard livenet vars + KISMET_BAZAAR (address). Optional
//! KISMET_P0 / KISMET_P1 override the defaults.

use contracts::bazaar::KismetBazaar;
use contracts::perils::forged::${draft.slug}::{${draft.struct_name}, ${draft.struct_name}InitArgs};
use odra::host::{Deployer, HostRef};
use odra::Address;
use std::str::FromStr;

fn main() {
    let env = odra_casper_livenet_env::env();
    let p0: i64 = std::env::var("KISMET_P0").ok().and_then(|v| v.parse().ok()).unwrap_or(${draft.default_p0});
    let p1: i64 = std::env::var("KISMET_P1").ok().and_then(|v| v.parse().ok()).unwrap_or(${draft.default_p1});

    env.set_gas(350_000_000_000u64);
    let peril = ${draft.struct_name}::deploy(
        &env,
        ${draft.struct_name}InitArgs {
            label: "${draft.label}".to_string(),
            forge_tag: "${forgeTag}".to_string(),
            p0,
            p1,
        },
    );
    println!("forged peril deployed: {}", peril.address().to_string());

    let bazaar_addr = std::env::var("KISMET_BAZAAR").expect("KISMET_BAZAAR address required");
    let mut bazaar = KismetBazaar::load(&env, Address::from_str(&bazaar_addr).expect("bad bazaar address"));
    env.set_gas(5_000_000_000u64);
    let peril_id = bazaar.list_peril("${brief.source_id}".to_string(), peril.address());
    println!("listed on bazaar as peril {peril_id}");
}
`;
}

function indent(body: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return body
    .split("\n")
    .map((line, i) => (i === 0 ? line : line.trim() === "" ? "" : pad + line))
    .join("\n");
}
