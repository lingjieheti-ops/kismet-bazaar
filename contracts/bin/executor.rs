//! KISMET livenet executor — runs batched agent decisions on-chain.
//!
//! The TypeScript agents decide; this binary executes. Each keeper cycle the
//! agents write a command file (one JSON object per intent: post an
//! observation, quote a rate, bind cover, settle a claim...), and this
//! executor replays it against Casper with the keys configured in the
//! livenet environment. Receipts — including per-command success, returned
//! ids, and errors — are written back as JSON for the agents and the web
//! ledger to consume.
//!
//! Actor indexing maps to livenet accounts: 0 is the main secret key,
//! 1..n are ODRA_CASPER_LIVENET_KEY_1..n. Each syndicate signs with its own
//! key; the chain, not the repo, is the source of truth for who did what.
//!
//! Usage:
//!   cargo run --bin contracts_executor -- \
//!     --deployments deployments/casper-test.json \
//!     --commands keeper-state/commands.json \
//!     --receipts keeper-state/receipts.json

use std::fs;
use std::str::FromStr;

use contracts::bazaar::KismetBazaar;
use contracts::oracle::KismetOracle;
use contracts::perils::ThresholdPeril;
use odra::casper_types::U512;
use odra::host::{Deployer, HostEnv, HostRef};
use odra::Address;
use serde::Deserialize;
use serde_json::{json, Value};

const DEFAULT_CALL_GAS: u64 = 5_000_000_000;
const HEAVY_CALL_GAS: u64 = 15_000_000_000;
const DEPLOY_GAS: u64 = 350_000_000_000;

#[derive(Deserialize)]
struct Deployments {
    oracle: String,
    bazaar: String,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
#[allow(clippy::enum_variant_names)]
enum Op {
    RegisterSource {
        source_id: String,
        description: String,
        upstream_url: String,
        scale_note: String,
    },
    AddReporter {
        reporter: String,
    },
    PostObservation {
        source_id: String,
        value: i64,
        observed_at: u64,
        provenance: String,
    },
    DeployThresholdPeril {
        gte: bool,
        threshold: i64,
        label: String,
        forge_tag: String,
    },
    ListPeril {
        source_id: String,
        trigger: String,
    },
    /// Deploy a threshold trigger and list it on the bazaar in one intent.
    CreateThresholdPeril {
        source_id: String,
        gte: bool,
        threshold: i64,
        label: String,
        forge_tag: String,
    },
    RegisterSyndicate {
        name: String,
        motto: String,
        reserve_bps: u32,
    },
    DepositCapital {
        syndicate_id: u32,
        amount_motes: String,
    },
    QuoteRate {
        syndicate_id: u32,
        peril_id: u32,
        rate_bps: u32,
    },
    BindPolicy {
        peril_id: u32,
        syndicate_id: u32,
        payout_motes: String,
        expires_at: u64,
        premium_motes: String,
    },
    Settle {
        policy_id: u32,
        obs_seq: u32,
    },
    Expire {
        policy_id: u32,
    },
    RingSolvencyCheck {
        syndicate_id: u32,
    },
    ProposeTreaty {
        cedent_id: u32,
        reinsurer_id: u32,
        share_bps: u32,
    },
    AcceptTreaty {
        cedent_id: u32,
        reinsurer_id: u32,
    },
}

#[derive(Deserialize)]
struct Command {
    /// Livenet account index: 0 = main key, n = ODRA_CASPER_LIVENET_KEY_n.
    actor: usize,
    /// Optional gas override in motes.
    gas: Option<u64>,
    #[serde(flatten)]
    op: Op,
}

#[derive(Deserialize)]
struct CommandFile {
    commands: Vec<Command>,
}

fn arg_value(args: &[String], flag: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

fn motes(s: &str) -> U512 {
    U512::from_dec_str(s).expect("amount in motes must be a decimal string")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let deployments_path = arg_value(&args, "--deployments", "deployments/casper-test.json");
    let commands_path = arg_value(&args, "--commands", "keeper-state/commands.json");
    let receipts_path = arg_value(&args, "--receipts", "keeper-state/receipts.json");
    let snapshot_path = arg_value(&args, "--snapshot", "keeper-state/snapshot.json");

    let deployments: Deployments = serde_json::from_str(
        &fs::read_to_string(&deployments_path).expect("deployments file unreadable"),
    )
    .expect("deployments file malformed");
    let file: CommandFile = serde_json::from_str(
        &fs::read_to_string(&commands_path).expect("commands file unreadable"),
    )
    .expect("commands file malformed");

    let env = odra_casper_livenet_env::env();
    let oracle_addr = Address::from_str(&deployments.oracle).expect("bad oracle address");
    let bazaar_addr = Address::from_str(&deployments.bazaar).expect("bad bazaar address");

    let mut receipts: Vec<Value> = Vec::new();
    let total = file.commands.len();

    for (i, cmd) in file.commands.into_iter().enumerate() {
        let caller = env.get_account(cmd.actor);
        env.set_caller(caller);
        let gas = cmd.gas.unwrap_or(match cmd.op {
            Op::BindPolicy { .. } | Op::Settle { .. } => HEAVY_CALL_GAS,
            Op::DeployThresholdPeril { .. } | Op::CreateThresholdPeril { .. } => DEPLOY_GAS,
            _ => DEFAULT_CALL_GAS,
        });
        env.set_gas(gas);

        let receipt = execute(&env, oracle_addr, bazaar_addr, &cmd.op);
        let ok = receipt.get("error").is_none();
        println!(
            "[{}/{}] actor={} {} -> {}",
            i + 1,
            total,
            cmd.actor,
            receipt.get("op").and_then(Value::as_str).unwrap_or("?"),
            if ok { "ok" } else { "ERR" }
        );
        receipts.push(receipt);
    }

    let failed = receipts
        .iter()
        .filter(|r| r.get("error").is_some())
        .count();
    let out = json!({
        "executed_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        "total": total,
        "failed": failed,
        "receipts": receipts,
    });
    fs::write(&receipts_path, serde_json::to_string_pretty(&out).unwrap())
        .expect("cannot write receipts");
    println!("executor: {}/{} succeeded", total - failed, total);

    // Snapshot the whole bazaar after execution. View calls are free node
    // queries on livenet; this file is the keeper's and the web ledger's
    // single source of on-chain truth.
    let snapshot = build_snapshot(&env, oracle_addr, bazaar_addr);
    fs::write(
        &snapshot_path,
        serde_json::to_string_pretty(&snapshot).unwrap(),
    )
    .expect("cannot write snapshot");
    println!("executor: snapshot written to {snapshot_path}");
    // A failed command is data, not a crash: the keeper decides what to retry.
}

fn build_snapshot(env: &HostEnv, oracle_addr: Address, bazaar_addr: Address) -> Value {
    let oracle = KismetOracle::load(env, oracle_addr);
    let bazaar = KismetBazaar::load(env, bazaar_addr);
    let (syn_n, peril_n, policy_n) = bazaar.counts();

    let mut perils = Vec::new();
    let mut source_ids: Vec<String> = Vec::new();
    for i in 0..peril_n {
        let p = bazaar.peril(i);
        if !source_ids.contains(&p.source_id) {
            source_ids.push(p.source_id.clone());
        }
        perils.push(json!({
            "peril_id": i,
            "source_id": p.source_id,
            "trigger": p.trigger.to_string(),
            "lister": p.lister.to_string(),
            "active": p.active,
        }));
    }

    let mut syndicates = Vec::new();
    for i in 0..syn_n {
        let s = bazaar.syndicate(i);
        let mut rates = Vec::new();
        for p in 0..peril_n {
            let r = bazaar.rate(i, p);
            if r > 0 {
                rates.push(json!({"peril_id": p, "rate_bps": r}));
            }
        }
        syndicates.push(json!({
            "syndicate_id": i,
            "owner": s.owner.to_string(),
            "name": s.name,
            "motto": s.motto,
            "capital_motes": s.capital.to_string(),
            "locked_motes": s.locked.to_string(),
            "reserve_bps": s.reserve_bps,
            "premiums_earned_motes": s.premiums_earned.to_string(),
            "claims_paid_motes": s.claims_paid.to_string(),
            "liquidated": s.liquidated,
            "reinsurer_id": if s.reinsurer_id == contracts::bazaar::NO_REINSURER { Value::Null } else { json!(s.reinsurer_id) },
            "treaty_share_bps": s.treaty_share_bps,
            "rates": rates,
        }));
    }

    let mut policies = Vec::new();
    for i in 0..policy_n {
        let p = bazaar.policy(i);
        policies.push(json!({
            "policy_id": i,
            "peril_id": p.peril_id,
            "syndicate_id": p.syndicate_id,
            "holder": p.holder.to_string(),
            "premium_motes": p.premium.to_string(),
            "payout_motes": p.payout.to_string(),
            "reserved_motes": p.reserved.to_string(),
            "bound_at": p.bound_at,
            "expires_at": p.expires_at,
            "status": p.status,
        }));
    }

    let mut observations = Vec::new();
    for sid in source_ids {
        let count = oracle.observation_count(sid.clone());
        if count == 0 {
            continue;
        }
        // Keep the last 24 observations per source in the snapshot.
        let from = count.saturating_sub(24);
        let mut series = Vec::new();
        for seq in from..count {
            let o = oracle.get_observation(sid.clone(), seq);
            series.push(json!({
                "seq": seq,
                "value": o.value,
                "observed_at": o.observed_at,
                "provenance": o.provenance,
            }));
        }
        observations.push(json!({"source_id": sid, "count": count, "recent": series}));
    }

    json!({
        "network": "casper-test",
        "oracle": oracle_addr.to_string(),
        "bazaar": bazaar_addr.to_string(),
        "counts": {"syndicates": syn_n, "perils": peril_n, "policies": policy_n},
        "syndicates": syndicates,
        "perils": perils,
        "policies": policies,
        "observations": observations,
    })
}

fn execute(env: &HostEnv, oracle_addr: Address, bazaar_addr: Address, op: &Op) -> Value {
    let mut oracle = KismetOracle::load(env, oracle_addr);
    let mut bazaar = KismetBazaar::load(env, bazaar_addr);
    match op {
        Op::RegisterSource {
            source_id,
            description,
            upstream_url,
            scale_note,
        } => wrap("register_source", oracle.try_register_source(
            source_id.clone(),
            description.clone(),
            upstream_url.clone(),
            scale_note.clone(),
        ).map(|_| json!({"source_id": source_id}))),
        Op::AddReporter { reporter } => {
            let addr = Address::from_str(reporter).expect("bad reporter address");
            wrap("add_reporter", oracle.try_add_reporter(addr).map(|_| json!({})))
        }
        Op::PostObservation {
            source_id,
            value,
            observed_at,
            provenance,
        } => wrap("post_observation", oracle.try_post_observation(
            source_id.clone(),
            *value,
            *observed_at,
            provenance.clone(),
        ).map(|seq| json!({"source_id": source_id, "seq": seq}))),
        Op::DeployThresholdPeril {
            gte,
            threshold,
            label,
            forge_tag,
        } => {
            let peril = ThresholdPeril::deploy(
                env,
                contracts::perils::ThresholdPerilInitArgs {
                    gte: *gte,
                    threshold: *threshold,
                    label: label.clone(),
                    forge_tag: forge_tag.clone(),
                },
            );
            json!({"op": "deploy_threshold_peril", "address": peril.address().to_string()})
        }
        Op::ListPeril { source_id, trigger } => {
            let addr = Address::from_str(trigger).expect("bad trigger address");
            wrap("list_peril", bazaar.try_list_peril(source_id.clone(), addr)
                .map(|id| json!({"peril_id": id})))
        }
        Op::CreateThresholdPeril {
            source_id,
            gte,
            threshold,
            label,
            forge_tag,
        } => {
            let peril = ThresholdPeril::deploy(
                env,
                contracts::perils::ThresholdPerilInitArgs {
                    gte: *gte,
                    threshold: *threshold,
                    label: label.clone(),
                    forge_tag: forge_tag.clone(),
                },
            );
            let trigger_addr = peril.address();
            env.set_gas(DEFAULT_CALL_GAS);
            wrap(
                "create_threshold_peril",
                bazaar
                    .try_list_peril(source_id.clone(), trigger_addr)
                    .map(|id| json!({"peril_id": id, "trigger": trigger_addr.to_string()})),
            )
        }
        Op::RegisterSyndicate {
            name,
            motto,
            reserve_bps,
        } => wrap("register_syndicate", bazaar.try_register_syndicate(
            name.clone(),
            motto.clone(),
            *reserve_bps,
        ).map(|id| json!({"syndicate_id": id}))),
        Op::DepositCapital {
            syndicate_id,
            amount_motes,
        } => wrap("deposit_capital", bazaar
            .with_tokens(motes(amount_motes))
            .try_deposit_capital(*syndicate_id)
            .map(|_| json!({"syndicate_id": syndicate_id}))),
        Op::QuoteRate {
            syndicate_id,
            peril_id,
            rate_bps,
        } => wrap("quote_rate", bazaar.try_quote_rate(*syndicate_id, *peril_id, *rate_bps)
            .map(|_| json!({"syndicate_id": syndicate_id, "peril_id": peril_id, "rate_bps": rate_bps}))),
        Op::BindPolicy {
            peril_id,
            syndicate_id,
            payout_motes,
            expires_at,
            premium_motes,
        } => wrap("bind_policy", bazaar
            .with_tokens(motes(premium_motes))
            .try_bind_policy(*peril_id, *syndicate_id, motes(payout_motes), *expires_at)
            .map(|id| json!({"policy_id": id}))),
        Op::Settle { policy_id, obs_seq } => wrap(
            "settle",
            bazaar.try_settle(*policy_id, *obs_seq).map(|_| json!({"policy_id": policy_id})),
        ),
        Op::Expire { policy_id } => wrap(
            "expire",
            bazaar.try_expire(*policy_id).map(|_| json!({"policy_id": policy_id})),
        ),
        Op::RingSolvencyCheck { syndicate_id } => wrap(
            "ring_solvency_check",
            bazaar
                .try_ring_solvency_check(*syndicate_id)
                .map(|_| json!({"syndicate_id": syndicate_id})),
        ),
        Op::ProposeTreaty {
            cedent_id,
            reinsurer_id,
            share_bps,
        } => wrap("propose_treaty", bazaar
            .try_propose_treaty(*cedent_id, *reinsurer_id, *share_bps)
            .map(|_| json!({}))),
        Op::AcceptTreaty {
            cedent_id,
            reinsurer_id,
        } => wrap("accept_treaty", bazaar
            .try_accept_treaty(*cedent_id, *reinsurer_id)
            .map(|_| json!({}))),
    }
}

fn wrap(op: &str, result: Result<Value, odra::OdraError>) -> Value {
    match result {
        Ok(mut v) => {
            v["op"] = json!(op);
            v
        }
        Err(e) => json!({"op": op, "error": format!("{:?}", e)}),
    }
}
