# The Forge — how an agent ships a smart contract here

> "No other Layer 1 gives AI agents both the ability to transact as economic
> actors and to autonomously build new applications." — Casper's stated
> thesis. KISMET takes the second half literally, and documents exactly how
> far "autonomously" goes.

## The two tiers, stated honestly

| Tier | Who writes what | Tag on-chain |
|---|---|---|
| **template-forged** | A parameterized instance of the audited `ThresholdPeril` template. The agent chooses source, direction, threshold, label. | `template-forged` |
| **free-forged** | The Actuary (an LLM agent) authors the **trigger predicate and its test suite** inside a guarded skeleton. The skeleton fixes imports, storage shape, init signature, and the custody surface. | `free-forged:<response-hash>` |

We do not claim the agent writes arbitrary smart contracts. We claim — and
prove, with logs — that it designs, implements, tests, and ships the part
of an insurance product that *is* the product: the risk logic. The boundary
is published because the boundary is the point: this is what responsible
autonomous contract authorship looks like.

## Why this is safe to let an agent do

A trigger contract holds no funds and cannot move any. Its entire interface
is `evaluate(i64) -> bool` and `describe()`. The bazaar — human-written,
fully tested — keeps custody of every mote. The worst a malicious or
defective predicate can do is mis-evaluate its own product, which is a
defect the Auditor, the tests, and ultimately the market price.

The forbidden-pattern scan enforces this mechanically: no state writes, no
environment access, no transfers, no loops, no unsafe, no cross-contract
calls, ASCII only. The scan runs twice — at assembly, and again by the
Auditor, which trusts nothing it did not check itself.

## The pipeline (every step in public CI logs)

```
brief ──► The Actuary drafts (LLM, strict JSON: predicate + tests + product language)
      ──► guarded-skeleton validation + forbidden-pattern scan (deterministic)
      ──► deterministic assembly (module + typed deploy bin + registry entries)
      ──► cargo odra test  (the agent's own tests must pass)
      ──► cargo odra build (wasm artifact)
      ──► The Auditor reviews (independent LLM, adversarial stance, votes on the PR)
      ──► pull request opened, reviewed, merged — authored by machine, in the open
      ──► deployed with The Actuary's key; listed on the bazaar
```

Provenance for every forged product lives in `docs/forge/<slug>.json`:
model, prompt hash, response hash, timestamps, parameter semantics — plus
`<slug>.audit.json` with the Auditor's verdict. The deploy transaction and
the on-chain `forge_provenance()` field close the loop: from brief to
Testnet, every step is checkable.

## Run it

GitHub → Actions → **actuary** → Run workflow, with a product brief and an
oracle source. Requires `ANTHROPIC_API_KEY` in repo secrets — the forge
refuses to run without it rather than fake authorship.
