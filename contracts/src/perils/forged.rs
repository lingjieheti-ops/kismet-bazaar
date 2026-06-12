//! Forged perils — insurance products authored by The Actuary.
//!
//! The Actuary is KISMET's contract-writing agent. It drafts new trigger
//! logic inside a guarded skeleton (the LLM writes the `evaluate` body and
//! the tests; imports, storage shape, and custody surface are fixed),
//! passes a forbidden-pattern scan, is compiled and tested in CI, reviewed
//! by an independent Auditor agent, and only then merged and deployed with
//! The Actuary's own key.
//!
//! Safety surface, stated plainly: a trigger contract holds no funds and
//! cannot move any. The worst a bad trigger can do is mis-evaluate its own
//! product. Custody never leaves the audited bazaar contract.
//!
//! Every module below carries its full provenance in docs/forge/.

// Forged modules are appended here by agents/src/actuary/forge.ts:
// pub mod <slug>;
