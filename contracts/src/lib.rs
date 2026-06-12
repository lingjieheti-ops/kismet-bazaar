//! KISMET — the on-chain parametric insurance bazaar, underwritten by machines.
//!
//! Three contract families:
//! - [`oracle`]   — KismetOracle: signed real-world observations with provenance
//! - [`perils`]   — pluggable trigger contracts (The Actuary deploys new ones)
//! - [`bazaar`]   — KismetBazaar: syndicates, policies, reinsurance, the bell
#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod bazaar;
pub mod oracle;
pub mod perils;
