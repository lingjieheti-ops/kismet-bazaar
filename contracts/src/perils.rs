//! Peril trigger contracts — the bazaar's pluggable risk logic.
//!
//! A peril contract answers one question: given an oracle observation value,
//! did the insured event happen? The bazaar dispatches to whichever trigger
//! contract a peril was listed with, so **new perils are new deployed
//! contracts, not config rows**. This is the surface The Actuary (our
//! contract-authoring agent) ships to: it generates a trigger, compiles it,
//! tests it in CI, deploys it with its own key, and lists it on the bazaar.
//!
//! `ThresholdPeril` below is the audited "template genome" (template-forged
//! tier). Free-forged triggers authored by The Actuary live alongside it in
//! this module tree, each tagged with its generation provenance.

use odra::prelude::*;

/// Interface every trigger contract must implement.
/// The bazaar calls this across contracts via `PerilTriggerContractRef`.
#[odra::external_contract]
pub trait PerilTrigger {
    fn evaluate(&self, value: i64) -> bool;
    fn describe(&self) -> String;
}

#[odra::odra_error]
pub enum PerilError {
    /// Threshold configuration is nonsensical.
    InvalidConfig = 200,
}

/// Template genome: fires when an observation crosses a fixed threshold.
/// Covers rain (mm x100 >= T), earthquake (magnitude x100 >= T),
/// solar storm (Kp x10 >= T) and their inverses (gte = false).
#[odra::module(errors = PerilError)]
pub struct ThresholdPeril {
    /// true: trigger when value >= threshold; false: when value <= threshold.
    gte: Var<bool>,
    threshold: Var<i64>,
    /// Human-readable label, e.g. "Istanbul 24h rain >= 12.50mm".
    label: Var<String>,
    /// Provenance tag: "template-forged" or "free-forged:<spec-hash>".
    forge_tag: Var<String>,
}

#[odra::module]
impl ThresholdPeril {
    pub fn init(&mut self, gte: bool, threshold: i64, label: String, forge_tag: String) {
        if label.is_empty() {
            self.env().revert(PerilError::InvalidConfig)
        }
        self.gte.set(gte);
        self.threshold.set(threshold);
        self.label.set(label);
        self.forge_tag.set(forge_tag);
    }

    pub fn evaluate(&self, value: i64) -> bool {
        let threshold = self.threshold.get_or_default();
        if self.gte.get_or_default() {
            value >= threshold
        } else {
            value <= threshold
        }
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

    #[test]
    fn threshold_gte_fires_at_and_above() {
        let env = odra_test::env();
        let peril = ThresholdPeril::deploy(
            &env,
            ThresholdPerilInitArgs {
                gte: true,
                threshold: 1250,
                label: "Istanbul 24h rain >= 12.50mm".to_string(),
                forge_tag: "template-forged".to_string(),
            },
        );
        assert!(!peril.evaluate(1249));
        assert!(peril.evaluate(1250));
        assert!(peril.evaluate(99_999));
    }

    #[test]
    fn threshold_lte_fires_at_and_below() {
        let env = odra_test::env();
        let peril = ThresholdPeril::deploy(
            &env,
            ThresholdPerilInitArgs {
                gte: false,
                threshold: 500_000,
                label: "CS2 players <= 500k".to_string(),
                forge_tag: "template-forged".to_string(),
            },
        );
        assert!(peril.evaluate(499_999));
        assert!(!peril.evaluate(500_001));
    }
}
