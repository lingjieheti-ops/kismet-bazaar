// The Auditor — the independent agent that reviews The Actuary's work.
//
//   node dist/actuary/audit.js --module <path-to-forged.rs> --provenance <path.json>
//
// Different system prompt, adversarial stance, separate verdict trail.
// The Auditor's job is to refuse: it approves only when it cannot find a
// way the predicate lies about its own product. Its verdict is posted on
// the pull request and recorded next to the provenance file.
//
// Exit codes: 0 approve, 1 reject, 2 cannot audit.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { scanForbidden } from "./skeleton.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Verdict {
  verdict: "approve" | "reject";
  findings: string[];
  summary: string;
}

export async function audit(modulePath: string, provenancePath: string): Promise<Verdict> {
  const code = readFileSync(modulePath, "utf8");
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as {
    brief: { brief: string; source_id: string };
    label: string;
  };

  // Deterministic re-scan first: the Auditor trusts no one, including the forge.
  const mechanical = scanForbidden(code.replace(/\/\/[^\n]*/g, ""));
  if (mechanical.length > 0) {
    return {
      verdict: "reject",
      findings: mechanical.map((m) => `forbidden pattern survived assembly: ${m}`),
      summary: "Mechanical scan failed; no LLM opinion required.",
    };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("The Auditor needs ANTHROPIC_API_KEY; refusing to rubber-stamp.");
  const model = process.env.KISMET_AUDIT_MODEL ?? "claude-sonnet-4-6";

  const system = `You are The Auditor of KISMET, an on-chain parametric insurance bazaar. An agent called The Actuary has authored a new trigger contract. Your stance is adversarial: your default is rejection, and you approve only if you cannot find a real problem.

Examine for:
1. Predicate honesty — does evaluate() actually implement what the label and brief promise? A trigger that pays out on the wrong condition is a defective product.
2. Boundary behavior — off-by-one at thresholds, overflow with extreme i64 values, sign errors, division by zero, p0/p1 misuse.
3. Test adequacy — do the tests actually pin the boundary? Tests that only check far-from-threshold values are decorative.
4. Unit sanity — observation scaling (rain mm x100, quake M x100, Kp x10, players x1) used correctly.

A trigger contract holds no funds; do not reject for custody concerns the skeleton already removes. Reject for honesty, correctness, or test-adequacy failures.

Reply STRICT JSON only: {"verdict": "approve"|"reject", "findings": ["..."], "summary": "two sentences"}`;

  const userMsg = `Product brief: ${provenance.brief.brief}\nSource: ${provenance.brief.source_id}\nLabel: ${provenance.label}\n\nFull module:\n\n${code}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The Auditor returned no JSON verdict");
  const verdict = JSON.parse(match[0]) as Verdict;

  // Record the audit beside the provenance.
  const auditPath = provenancePath.replace(/\.json$/, ".audit.json");
  writeFileSync(
    auditPath,
    JSON.stringify(
      {
        ...verdict,
        model,
        module_sha256: createHash("sha256").update(code).digest("hex"),
        audited_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return verdict;
}

const isMain = process.argv[1]?.endsWith("audit.js");
if (isMain) {
  const modulePath = arg("--module");
  const provenancePath = arg("--provenance");
  if (!modulePath || !provenancePath) {
    console.error("usage: audit.js --module <forged.rs> --provenance <slug.json>");
    process.exit(2);
  }
  audit(modulePath, provenancePath)
    .then((v) => {
      console.log(JSON.stringify(v, null, 2));
      process.exit(v.verdict === "approve" ? 0 : 1);
    })
    .catch((e) => {
      console.error("audit failed:", e.message ?? e);
      process.exit(2);
    });
}
