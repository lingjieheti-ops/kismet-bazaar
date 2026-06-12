//! KISMET livenet CLI — deploys the bazaar stack to Casper and runs genesis.
//!
//! Usage (requires livenet env vars, see README):
//!   cargo run --bin contracts_cli --features=livenet -- deploy
//!   cargo run --bin contracts_cli --features=livenet -- scenario genesis

use contracts::bazaar::{KismetBazaar, KismetBazaarInitArgs};
use contracts::oracle::KismetOracle;
use contracts::perils::{ThresholdPeril, ThresholdPerilInitArgs};
use odra::host::{HostEnv, NoArgs};
use odra_cli::{
    deploy::DeployScript,
    scenario::{Args, Error, Scenario, ScenarioMetadata},
    ContractProvider, DeployedContractsContainer, DeployerExt, OdraCli,
};

const DEPLOY_GAS: u64 = 350_000_000_000;
const CALL_GAS: u64 = 5_000_000_000;

/// Istanbul 24h rainfall is the bazaar's genesis peril: the host city of the
/// buildathon, observed by a key-free public API anyone can re-fetch.
const GENESIS_SOURCE_ID: &str = "istanbul-rain-24h";
const GENESIS_SOURCE_URL: &str =
    "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.95&daily=precipitation_sum&timezone=UTC";

/// Deploys the oracle, the genesis trigger, and the bazaar wired to the oracle.
pub struct KismetDeployScript;

impl DeployScript for KismetDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer,
    ) -> Result<(), odra_cli::deploy::Error> {
        let oracle = KismetOracle::load_or_deploy(env, NoArgs, container, DEPLOY_GAS)?;

        let _trigger = ThresholdPeril::load_or_deploy(
            env,
            ThresholdPerilInitArgs {
                gte: true,
                threshold: 1250, // 12.50mm x100
                label: "Istanbul 24h rain >= 12.50mm".to_string(),
                forge_tag: "template-forged".to_string(),
            },
            container,
            DEPLOY_GAS,
        )?;

        let _bazaar = KismetBazaar::load_or_deploy(
            env,
            KismetBazaarInitArgs {
                oracle: *oracle.address(),
            },
            container,
            DEPLOY_GAS,
        )?;

        Ok(())
    }
}

/// Genesis: register the rain source on the oracle and list the peril on the
/// bazaar. Run once after deploy; both calls are idempotent-guarded on-chain.
pub struct GenesisScenario;

impl Scenario for GenesisScenario {
    fn args(&self) -> Vec<odra_cli::CommandArg> {
        vec![]
    }

    fn run(
        &self,
        env: &HostEnv,
        container: &DeployedContractsContainer,
        _args: Args,
    ) -> Result<(), Error> {
        let mut oracle = container.contract_ref::<KismetOracle>(env)?;
        let trigger = container.contract_ref::<ThresholdPeril>(env)?;
        let mut bazaar = container.contract_ref::<KismetBazaar>(env)?;

        env.set_gas(CALL_GAS);
        oracle.try_register_source(
            GENESIS_SOURCE_ID.to_string(),
            "Istanbul 24h accumulated rainfall, mm x100".to_string(),
            GENESIS_SOURCE_URL.to_string(),
            "mm x100".to_string(),
        )?;

        env.set_gas(CALL_GAS);
        bazaar.try_list_peril(GENESIS_SOURCE_ID.to_string(), *trigger.address())?;

        Ok(())
    }
}

impl ScenarioMetadata for GenesisScenario {
    const NAME: &'static str = "genesis";
    const DESCRIPTION: &'static str =
        "Registers the Istanbul rain source and lists the genesis peril";
}

pub fn main() {
    OdraCli::new()
        .about("KISMET bazaar deployment CLI")
        .deploy(KismetDeployScript)
        .contract::<KismetOracle>()
        .contract::<ThresholdPeril>()
        .contract::<KismetBazaar>()
        .scenario(GenesisScenario)
        .build()
        .run();
}
