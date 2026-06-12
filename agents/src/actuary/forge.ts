// The Actuary's forge — where a product brief becomes a smart contract.
//
//   node dist/actuary/forge.js --brief "..." --source istanbul-rain-24h
//
// Pipeline (this file does steps 1-4; the actuary workflow does the rest):
//   1. LLM drafts the predicate, tests, and product language (strict JSON)
//   2. Forbidden-pattern scan + structural validation (deterministic)
//   3. Deterministic assembly into the guarded skeleton
//   4. Files written: forged module, deploy bin, Odra.toml + Cargo.toml
//      entries, provenance record under docs/forge/
//   5. CI compiles and runs the authored tests
//   6. An independent Auditor agent reviews the diff and votes
//   7. Merge, deploy with The Actuary's key, list on the bazaar
//
// Honesty note, published as written: the LLM authors the trigger predicate
// and its tests inside a fixed skeleton. It does not author imports, storage,
// or anything that touches custody. We call this "free-forged within a
// guarded skeleton" and we think that is exactly what an autonomous agent
// should be allowed to ship to a chain in 2026.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  assembleDeployBin,
  assembleModule,
  validateDraft,
  type ForgeBrief,
  type ForgeDraft,
} from "./skeleton.js";

const REPO_ROOT = process.env.KISMET_REPO_ROOT ?? "..";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const KNOWN_SOURCES = ["istanbul-rain-24h", "quake-global-1h", "solar-kp", "cs2-players"];

export async function forge(brief: ForgeBrief): Promise<{ slug: string; files: string[] }> {
  if (!KNOWN_SOURCES.includes(brief.source_id)) {
    throw new Error(`unknown source ${brief.source_id}; the oracle reports: ${KNOWN_SOURCES.join(", ")}`);
  }

  const { draft, promptSha, responseSha, model } = await draftWithLlm(brief);

  const problems = validateDraft(draft);
  if (problems.length > 0) {
    throw new Error(`draft rejected by the guarded skeleton:\n  - ${problems.join("\n  - ")}`);
  }

  const forgeTag = `free-forged:${responseSha.slice(0, 12)}`;
  const moduleSrc = assembleModule(draft, brief, forgeTag);
  const deploySrc = assembleDeployBin(draft, brief, forgeTag);

  const contractsDir = join(REPO_ROOT, "contracts");
  const modulePath = join(contractsDir, "src", "perils", "forged", `${draft.slug}.rs`);
  const binPath = join(contractsDir, "bin", `deploy_forged_${draft.slug}.rs`);
  if (existsSync(modulePath)) throw new Error(`forged module ${draft.slug} already exists`);

  mkdirSync(join(contractsDir, "src", "perils", "forged"), { recursive: true });
  writeFileSync(modulePath, moduleSrc);
  writeFileSync(binPath, deploySrc);

  // Register the module.
  const forgedMod = join(contractsDir, "src", "perils", "forged.rs");
  appendOnce(forgedMod, `pub mod ${draft.slug};\n`);

  // Register the contract for wasm builds.
  appendOnce(
    join(contractsDir, "Odra.toml"),
    `\n[[contracts]]\nfqn = "perils::forged::${draft.slug}::${draft.struct_name}"\n`,
  );

  // Register the deploy bin.
  appendOnce(
    join(contractsDir, "Cargo.toml"),
    `\n[[bin]]\nname = "deploy_forged_${draft.slug}"\npath = "bin/deploy_forged_${draft.slug}.rs"\ntest = false\n`,
  );

  // Provenance record: enough for anyone to reconstruct what happened.
  const provenanceDir = join(REPO_ROOT, "docs", "forge");
  mkdirSync(provenanceDir, { recursive: true });
  const provenance = {
    slug: draft.slug,
    struct_name: draft.struct_name,
    label: draft.label,
    brief,
    pitch: draft.pitch,
    params: {
      p0: { meaning: draft.p0_meaning, default: draft.default_p0 },
      p1: { meaning: draft.p1_meaning, default: draft.default_p1 },
    },
    model,
    prompt_sha256: promptSha,
    response_sha256: responseSha,
    forge_tag: forgeTag,
    forged_at: new Date().toISOString(),
    skeleton: "guarded-v1 (LLM authors predicate + tests; shell, storage, custody surface fixed)",
    deployment: { status: "pending", address: null as string | null, peril_id: null as number | null, deploy_tx: null as string | null },
  };
  const provenancePath = join(provenanceDir, `${draft.slug}.json`);
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));

  return {
    slug: draft.slug,
    files: [modulePath, binPath, forgedMod, provenancePath],
  };
}

function appendOnce(path: string, chunk: string) {
  const body = readFileSync(path, "utf8");
  if (body.includes(chunk.trim())) return;
  writeFileSync(path, body + chunk);
}

async function draftWithLlm(
  brief: ForgeBrief,
): Promise<{ draft: ForgeDraft; promptSha: string; responseSha: string; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("The Actuary needs ANTHROPIC_API_KEY to draft. No key, no forge — we do not fake authorship.");
  }
  const model = process.env.KISMET_FORGE_MODEL ?? "claude-sonnet-4-6";
  const system = `You are The Actuary, the contract-authoring agent of KISMET, an on-chain parametric insurance bazaar on Casper. You design a new parametric insurance trigger as Rust code inside a fixed skeleton.

Rules of the skeleton (hard constraints):
- You write the BODY of: fn evaluate(value: i64) -> bool. In scope: value, p0, p1 (all i64, already bound). It must be a pure predicate: no state writes, no env access, no loops, no unsafe, no macros, ASCII only. End with a bool expression.
- Observation scaling: istanbul-rain-24h = mm x100; quake-global-1h = max magnitude x100 (0 = quiet hour); solar-kp = Kp x10; cs2-players = raw player count.
- You also write the BODY of a Rust tests module. Available helper: deploy(p0: i64, p1: i64) returns a host ref with .evaluate(value). Write 2-4 #[test] fns covering boundary conditions. Same purity constraints.
- p0 and p1 are your product's two tunable parameters. Give them clear meanings and sane defaults in the observation's scaled units.

Reply with STRICT JSON only (no markdown fences): {"slug": "snake_case", "struct_name": "UpperCamelPeril", "label": "one line product name with the trigger condition", "p0_meaning": "...", "p1_meaning": "...", "default_p0": 0, "default_p1": 0, "evaluate_body": "...", "tests_body": "...", "pitch": "one sentence in The Actuary's dry, confident voice"}`;

  const userMsg = `Product brief: ${brief.brief}\nSettles against oracle source: ${brief.source_id}\nDesign the trigger.`;
  const promptSha = sha256(system + "\n" + userMsg);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const responseSha = sha256(text);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The Actuary returned no JSON draft");
  const draft = JSON.parse(match[0]) as ForgeDraft;
  return { draft, promptSha, responseSha, model };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// CLI entrypoint
const isMain = process.argv[1]?.endsWith("forge.js");
if (isMain) {
  const brief = arg("--brief");
  const source = arg("--source");
  if (!brief || !source) {
    console.error('usage: forge.js --brief "<product idea>" --source <oracle source id>');
    process.exit(2);
  }
  forge({ brief, source_id: source })
    .then(({ slug, files }) => {
      console.log(`forged: ${slug}`);
      for (const f of files) console.log(`  ${f}`);
      // Emitted for the workflow to pick up.
      console.log(`::set-slug::${slug}`);
    })
    .catch((e) => {
      console.error("forge failed:", e.message ?? e);
      process.exit(1);
    });
}
