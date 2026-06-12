//! KismetOracle — append-only registry of signed real-world observations.
//!
//! Reporters fetch public, key-free data feeds (Open-Meteo, USGS, NOAA SWPC, Steam),
//! clamp them to per-source sane bounds off-chain, and post them here with a
//! provenance tag so anyone can re-fetch the upstream API and compare.
//!
//! KISMET's bazaar settles parametric policies against these observations,
//! but the registry is intentionally standalone: any other Casper contract
//! can consume the same feed history.

use odra::prelude::*;

/// Errors raised by the oracle. Discriminants 100+ to stay unique project-wide.
#[odra::odra_error]
pub enum OracleError {
    /// Caller is not an authorized reporter or admin.
    NotAuthorized = 100,
    /// Source id has not been registered.
    UnknownSource = 101,
    /// Observation index out of range.
    UnknownObservation = 102,
    /// Source id already registered.
    SourceExists = 103,
    /// Observation timestamp is zero or absurd.
    BadObservation = 104,
}

#[odra::event]
pub struct SourceRegistered {
    pub source_id: String,
    pub description: String,
    pub upstream_url: String,
}

#[odra::event]
pub struct ObservationPosted {
    pub source_id: String,
    pub seq: u32,
    pub value: i64,
    pub observed_at: u64,
    pub provenance: String,
}

/// A single observation. `value` is the upstream reading scaled to an integer
/// (e.g. rain mm x100, quake magnitude x100, Kp index x10, player count x1).
#[odra::odra_type]
pub struct Observation {
    pub value: i64,
    pub observed_at: u64,
    pub provenance: String,
}

#[odra::odra_type]
pub struct SourceMeta {
    pub description: String,
    pub upstream_url: String,
    pub scale_note: String,
}

#[odra::module(events = [SourceRegistered, ObservationPosted], errors = OracleError)]
pub struct KismetOracle {
    admin: Var<Address>,
    reporters: Mapping<Address, bool>,
    source_registered: Mapping<String, bool>,
    source_meta: Mapping<String, SourceMeta>,
    obs_count: Mapping<String, u32>,
    observations: Mapping<(String, u32), Observation>,
}

#[odra::module]
impl KismetOracle {
    pub fn init(&mut self) {
        let caller = self.env().caller();
        self.admin.set(caller);
        self.reporters.set(&caller, true);
    }

    /// Admin can authorize additional reporter accounts (agent keys).
    pub fn add_reporter(&mut self, reporter: Address) {
        self.assert_admin();
        self.reporters.set(&reporter, true);
    }

    pub fn remove_reporter(&mut self, reporter: Address) {
        self.assert_admin();
        self.reporters.set(&reporter, false);
    }

    /// Register a data source. Reporter-gated to keep the catalog curated.
    pub fn register_source(
        &mut self,
        source_id: String,
        description: String,
        upstream_url: String,
        scale_note: String,
    ) {
        self.assert_reporter();
        if self.source_registered.get(&source_id).unwrap_or(false) {
            self.env().revert(OracleError::SourceExists)
        }
        self.source_registered.set(&source_id, true);
        self.source_meta.set(
            &source_id,
            SourceMeta {
                description: description.clone(),
                upstream_url: upstream_url.clone(),
                scale_note,
            },
        );
        self.env().emit_event(SourceRegistered {
            source_id,
            description,
            upstream_url,
        });
    }

    /// Append an observation for a registered source.
    pub fn post_observation(
        &mut self,
        source_id: String,
        value: i64,
        observed_at: u64,
        provenance: String,
    ) -> u32 {
        self.assert_reporter();
        if !self.source_registered.get(&source_id).unwrap_or(false) {
            self.env().revert(OracleError::UnknownSource)
        }
        if observed_at == 0 {
            self.env().revert(OracleError::BadObservation)
        }
        let seq = self.obs_count.get(&source_id).unwrap_or(0);
        self.observations.set(
            &(source_id.clone(), seq),
            Observation {
                value,
                observed_at,
                provenance: provenance.clone(),
            },
        );
        self.obs_count.set(&source_id, seq + 1);
        self.env().emit_event(ObservationPosted {
            source_id,
            seq,
            value,
            observed_at,
            provenance,
        });
        seq
    }

    /// Fetch an observation by index; reverts when missing so cross-contract
    /// consumers get a clean failure instead of an Option ABI.
    pub fn get_observation(&self, source_id: String, seq: u32) -> Observation {
        match self.observations.get(&(source_id, seq)) {
            Some(obs) => obs,
            None => self.env().revert(OracleError::UnknownObservation),
        }
    }

    pub fn latest(&self, source_id: String) -> Observation {
        let count = self.obs_count.get(&source_id).unwrap_or(0);
        if count == 0 {
            self.env().revert(OracleError::UnknownObservation)
        }
        self.get_observation(source_id, count - 1)
    }

    pub fn observation_count(&self, source_id: String) -> u32 {
        self.obs_count.get(&source_id).unwrap_or(0)
    }

    pub fn source_info(&self, source_id: String) -> SourceMeta {
        match self.source_meta.get(&source_id) {
            Some(meta) => meta,
            None => self.env().revert(OracleError::UnknownSource),
        }
    }

    pub fn is_reporter(&self, account: Address) -> bool {
        self.reporters.get(&account).unwrap_or(false)
    }

    fn assert_admin(&self) {
        if Some(self.env().caller()) != self.admin.get() {
            self.env().revert(OracleError::NotAuthorized)
        }
    }

    fn assert_reporter(&self) {
        if !self.reporters.get(&self.env().caller()).unwrap_or(false) {
            self.env().revert(OracleError::NotAuthorized)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    #[test]
    fn post_and_read_observations() {
        let env = odra_test::env();
        let mut oracle = KismetOracle::deploy(&env, NoArgs);

        oracle.register_source(
            "istanbul-rain-24h".to_string(),
            "Istanbul 24h accumulated rainfall, mm x100".to_string(),
            "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.95".to_string(),
            "mm x100".to_string(),
        );

        let seq = oracle.post_observation(
            "istanbul-rain-24h".to_string(),
            1250,
            1_760_000_000_000,
            "open-meteo:precipitation_sum".to_string(),
        );
        assert_eq!(seq, 0);

        let obs = oracle.latest("istanbul-rain-24h".to_string());
        assert_eq!(obs.value, 1250);
        assert_eq!(oracle.observation_count("istanbul-rain-24h".to_string()), 1);
    }

    #[test]
    fn unknown_source_reverts() {
        let env = odra_test::env();
        let mut oracle = KismetOracle::deploy(&env, NoArgs);
        let result = oracle.try_post_observation(
            "ghost".to_string(),
            1,
            1_760_000_000_000,
            "x".to_string(),
        );
        assert_eq!(result.unwrap_err(), OracleError::UnknownSource.into());
    }

    #[test]
    fn non_reporter_cannot_post() {
        let env = odra_test::env();
        let mut oracle = KismetOracle::deploy(&env, NoArgs);
        oracle.register_source(
            "s".to_string(),
            "d".to_string(),
            "u".to_string(),
            "n".to_string(),
        );
        env.set_caller(env.get_account(1));
        let result =
            oracle.try_post_observation("s".to_string(), 1, 1_760_000_000_000, "x".to_string());
        assert_eq!(result.unwrap_err(), OracleError::NotAuthorized.into());
    }
}
