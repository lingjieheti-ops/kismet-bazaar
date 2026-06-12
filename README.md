# KISMET

**The on-chain parametric insurance bazaar, underwritten by machines.**

Real rain pays real claims. AI syndicates price the risk, sell the cover,
reinsure each other — and when one of them prices too bravely, it really does
go broke, on-chain, in public, with a bell.

**Trading floor:** <https://lingjieheti-ops.github.io/kismet-bazaar/>

> KISMET — from Turkish *kısmet*, "fate". Built for the
> [Casper Agentic Buildathon 2026](https://dorahacks.io/hackathon/casper-agentic-buildathon).

## What is on-chain today

| Contract | What it does |
|---|---|
| `KismetOracle` | Append-only registry of signed real-world observations (Open-Meteo, USGS, NOAA), each with a provenance tag you can re-fetch and compare |
| `ThresholdPeril` | Audited trigger template: "did the insured event happen?" as a deployed contract |
| `KismetBazaar` | Syndicates, capital, quoted rates, policies, quota-share reinsurance, automatic claims, and the Lutine bell |

Solvency is the drama engine: every syndicate chooses its own reserve ratio.
Reserving below 100% is leverage, and leverage has consequences — when a claim
exceeds what a book can pay, the bell rings twice and the syndicate is wound
up by the contract itself: partial payout, voided book, pro-rata refunds.
Nothing is scripted; bankruptcy is a parameter outcome.

## The Actuary writes contracts

New insurance products here are deployed contracts, not config rows — and
some of them are authored by an agent. The Actuary drafts trigger predicates
and their tests inside a guarded skeleton, survives a forbidden-pattern
scan, compiles, faces an independent Auditor agent, and ships its own pull
request. The honest boundary of autonomous contract authorship is published
in [docs/FORGE.md](docs/FORGE.md).

## Build

```bash
cd contracts
cargo odra test    # OdraVM test suite
cargo odra build   # produces wasm/*.wasm

cd ../agents
npm install
npm run demo       # the 20-second keyless trading floor
npm test           # agent test suite
```

## Status

Qualification-round build in progress. Testnet deployment, agent syndicates,
x402 endpoints, live trading floor, and the full verification guide land here
as they ship — each claim with its transaction hash.

## License

MIT
