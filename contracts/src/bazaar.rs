//! KismetBazaar — the trading floor of the parametric insurance bazaar.
//!
//! Syndicates (AI underwriters with their own keys) deposit CSPR capital,
//! quote rates per peril, and stand behind every policy they bind. Settlement
//! is mechanical: an oracle observation is read cross-contract, the peril's
//! trigger contract evaluates it, and the payout moves without any human in
//! the loop.
//!
//! Solvency is the drama engine. A syndicate chooses its own reserve ratio:
//! reserving below 100% is leverage, and leverage has consequences. When a
//! claim exceeds what a syndicate can pay, the Lutine bell rings twice and
//! the books are wound up on-chain — partial payout, liquidation, pro-rata
//! refunds to stranded holders. Nothing here is scripted; bankruptcy is a
//! parameter outcome.
//!
//! Bell convention (homage to Lloyd's of London, reversed deliberately):
//! one strike = a claim paid, two strikes = a syndicate liquidated.

use crate::perils::PerilTriggerContractRef;
use odra::casper_types::U512;
use odra::prelude::*;
use odra::ContractRef;

/// Errors raised by the bazaar. Discriminants 300+ to stay unique project-wide.
#[odra::odra_error]
pub enum BazaarError {
    /// Caller does not own the syndicate (or is not admin where required).
    NotAuthorized = 300,
    /// Syndicate id is not registered.
    UnknownSyndicate = 301,
    /// Peril id is not listed.
    UnknownPeril = 302,
    /// Policy id does not exist.
    UnknownPolicy = 303,
    /// Syndicate has been liquidated and can no longer trade.
    SyndicateLiquidated = 304,
    /// Syndicate is not quoting this peril (rate not set).
    NotQuoted = 305,
    /// Attached premium is below the syndicate's posted rate.
    PremiumTooLow = 306,
    /// Free capital cannot reserve this policy.
    InsufficientCapacity = 307,
    /// Policy is not active.
    PolicyNotActive = 308,
    /// Policy has not reached its expiry yet.
    PolicyNotExpired = 309,
    /// Observation falls outside the policy coverage window.
    ObservationOutOfWindow = 310,
    /// Trigger contract says the insured event did not happen.
    TriggerNotMet = 311,
    /// Numeric configuration out of range (bps fields must be <= 10000).
    BadParams = 312,
    /// Withdrawal would dip into reserved capital.
    CapitalReserved = 313,
    /// No treaty proposal waiting for this pair.
    NoTreatyProposal = 314,
    /// Syndicate is solvent; nothing to liquidate.
    NotInsolvent = 315,
    /// Expiry must be in the future and within the max tenor.
    BadExpiry = 316,
}

// ---------------------------------------------------------------------------
// Events — the web ledger reads these directly from the chain.
// ---------------------------------------------------------------------------

#[odra::event]
pub struct SyndicateRegistered {
    pub syndicate_id: u32,
    pub owner: Address,
    pub name: String,
    pub motto: String,
    pub reserve_bps: u32,
}

#[odra::event]
pub struct CapitalDeposited {
    pub syndicate_id: u32,
    pub amount: U512,
    pub capital: U512,
}

#[odra::event]
pub struct CapitalWithdrawn {
    pub syndicate_id: u32,
    pub amount: U512,
    pub capital: U512,
}

#[odra::event]
pub struct PerilListed {
    pub peril_id: u32,
    pub source_id: String,
    pub trigger: Address,
    pub lister: Address,
}

/// An underwriter's pricing decision, on-chain. The off-chain reasoning that
/// produced `rate_bps` is published by the agent; this event is the receipt.
#[odra::event]
pub struct RateQuoted {
    pub syndicate_id: u32,
    pub peril_id: u32,
    pub rate_bps: u32,
}

#[odra::event]
pub struct PolicyBound {
    pub policy_id: u32,
    pub peril_id: u32,
    pub syndicate_id: u32,
    pub holder: Address,
    pub premium: U512,
    pub payout: U512,
    pub expires_at: u64,
}

#[odra::event]
pub struct ClaimPaid {
    pub policy_id: u32,
    pub syndicate_id: u32,
    pub holder: Address,
    pub paid: U512,
    pub shortfall: U512,
}

#[odra::event]
pub struct PolicyExpired {
    pub policy_id: u32,
    pub syndicate_id: u32,
    pub premium_kept: U512,
}

#[odra::event]
pub struct TreatyProposed {
    pub cedent_id: u32,
    pub reinsurer_id: u32,
    pub share_bps: u32,
}

#[odra::event]
pub struct TreatyBound {
    pub cedent_id: u32,
    pub reinsurer_id: u32,
    pub share_bps: u32,
}

/// One strike: a claim paid. Two strikes: a syndicate wound up.
#[odra::event]
pub struct BellRung {
    pub syndicate_id: u32,
    pub strikes: u32,
    pub reason: String,
}

#[odra::event]
pub struct SyndicateWoundUp {
    pub syndicate_id: u32,
    pub refunded: U512,
    pub voided_policies: u32,
}

// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_PAID: u8 = 1;
pub const STATUS_EXPIRED: u8 = 2;
pub const STATUS_VOIDED: u8 = 3;

/// Sentinel for "no reinsurer".
pub const NO_REINSURER: u32 = u32::MAX;

#[odra::odra_type]
pub struct Syndicate {
    pub owner: Address,
    pub name: String,
    pub motto: String,
    /// CSPR (motes) the syndicate has on the books, including earned premium.
    pub capital: U512,
    /// Capital reserved against open policies (reserve_bps of each payout).
    pub locked: U512,
    /// Reserve ratio in basis points. 10000 = fully reserved, lower = leverage.
    pub reserve_bps: u32,
    pub premiums_earned: U512,
    pub claims_paid: U512,
    pub liquidated: bool,
    /// Active quota-share treaty: reinsurer syndicate id, or NO_REINSURER.
    pub reinsurer_id: u32,
    /// Share of premium ceded and claims recovered, in basis points.
    pub treaty_share_bps: u32,
}

#[odra::odra_type]
pub struct Peril {
    pub source_id: String,
    pub trigger: Address,
    pub lister: Address,
    pub active: bool,
}

#[odra::odra_type]
pub struct Policy {
    pub peril_id: u32,
    pub syndicate_id: u32,
    pub holder: Address,
    pub premium: U512,
    pub payout: U512,
    pub reserved: U512,
    pub bound_at: u64,
    pub expires_at: u64,
    pub status: u8,
}

// ---------------------------------------------------------------------------
// The bazaar
// ---------------------------------------------------------------------------

#[odra::module(
    events = [
        SyndicateRegistered, CapitalDeposited, CapitalWithdrawn, PerilListed,
        RateQuoted, PolicyBound, ClaimPaid, PolicyExpired, TreatyProposed,
        TreatyBound, BellRung, SyndicateWoundUp
    ],
    errors = BazaarError
)]
pub struct KismetBazaar {
    admin: Var<Address>,
    /// The KismetOracle this bazaar settles against.
    oracle: Var<Address>,
    syndicate_count: Var<u32>,
    syndicates: Mapping<u32, Syndicate>,
    peril_count: Var<u32>,
    perils: Mapping<u32, Peril>,
    /// (syndicate, peril) -> rate in bps. 0 = not quoting.
    rates: Mapping<(u32, u32), u32>,
    policy_count: Var<u32>,
    policies: Mapping<u32, Policy>,
    /// Per-syndicate index of policies, for wind-ups.
    syndicate_policies: Mapping<(u32, u32), u32>,
    syndicate_policy_count: Mapping<u32, u32>,
    /// Pending treaty proposals: (cedent, reinsurer) -> share_bps.
    treaty_proposals: Mapping<(u32, u32), u32>,
}

#[odra::module]
impl KismetBazaar {
    pub fn init(&mut self, oracle: Address) {
        self.admin.set(self.env().caller());
        self.oracle.set(oracle);
        self.syndicate_count.set(0);
        self.peril_count.set(0);
        self.policy_count.set(0);
    }

    // -- Syndicates ---------------------------------------------------------

    /// Open a syndicate. The caller's key owns the book. `reserve_bps` is the
    /// syndicate's own solvency discipline — choosing less than 10000 is
    /// writing leveraged cover, and the bell does not forgive.
    pub fn register_syndicate(&mut self, name: String, motto: String, reserve_bps: u32) -> u32 {
        if reserve_bps == 0 || reserve_bps > 10_000 {
            self.env().revert(BazaarError::BadParams)
        }
        let id = self.syndicate_count.get_or_default();
        let owner = self.env().caller();
        self.syndicates.set(
            &id,
            Syndicate {
                owner,
                name: name.clone(),
                motto: motto.clone(),
                capital: U512::zero(),
                locked: U512::zero(),
                reserve_bps,
                premiums_earned: U512::zero(),
                claims_paid: U512::zero(),
                liquidated: false,
                reinsurer_id: NO_REINSURER,
                treaty_share_bps: 0,
            },
        );
        self.syndicate_count.set(id + 1);
        self.env().emit_event(SyndicateRegistered {
            syndicate_id: id,
            owner,
            name,
            motto,
            reserve_bps,
        });
        id
    }

    /// Put capital behind the book. Anyone may capitalize a syndicate
    /// (patrons welcome); only the owner may withdraw.
    #[odra(payable)]
    pub fn deposit_capital(&mut self, syndicate_id: u32) {
        let mut syn = self.load_syndicate(syndicate_id);
        if syn.liquidated {
            self.env().revert(BazaarError::SyndicateLiquidated)
        }
        let amount = self.env().attached_value();
        syn.capital += amount;
        let capital = syn.capital;
        self.syndicates.set(&syndicate_id, syn);
        self.env().emit_event(CapitalDeposited {
            syndicate_id,
            amount,
            capital,
        });
    }

    /// Withdraw free capital (never the reserved portion).
    pub fn withdraw_capital(&mut self, syndicate_id: u32, amount: U512) {
        let mut syn = self.load_syndicate(syndicate_id);
        if syn.owner != self.env().caller() {
            self.env().revert(BazaarError::NotAuthorized)
        }
        if syn.liquidated {
            self.env().revert(BazaarError::SyndicateLiquidated)
        }
        if syn.capital - syn.locked < amount {
            self.env().revert(BazaarError::CapitalReserved)
        }
        syn.capital -= amount;
        let capital = syn.capital;
        let owner = syn.owner;
        self.syndicates.set(&syndicate_id, syn);
        self.env().transfer_tokens(&owner, &amount);
        self.env().emit_event(CapitalWithdrawn {
            syndicate_id,
            amount,
            capital,
        });
    }

    // -- Perils ---------------------------------------------------------------

    /// List a peril: an oracle source paired with a deployed trigger contract.
    /// Open by design — The Actuary lists the perils it authors itself.
    pub fn list_peril(&mut self, source_id: String, trigger: Address) -> u32 {
        let id = self.peril_count.get_or_default();
        let lister = self.env().caller();
        self.perils.set(
            &id,
            Peril {
                source_id: source_id.clone(),
                trigger,
                lister,
                active: true,
            },
        );
        self.peril_count.set(id + 1);
        self.env().emit_event(PerilListed {
            peril_id: id,
            source_id,
            trigger,
            lister,
        });
        id
    }

    /// Admin can delist junk perils (catalog hygiene, not settlement power).
    pub fn delist_peril(&mut self, peril_id: u32) {
        if Some(self.env().caller()) != self.admin.get() {
            self.env().revert(BazaarError::NotAuthorized)
        }
        let mut peril = self.load_peril(peril_id);
        peril.active = false;
        self.perils.set(&peril_id, peril);
    }

    /// Post (or update) the rate at which a syndicate will write a peril.
    /// This is the underwriter's pricing decision, signed with its own key.
    pub fn quote_rate(&mut self, syndicate_id: u32, peril_id: u32, rate_bps: u32) {
        let syn = self.load_syndicate(syndicate_id);
        if syn.owner != self.env().caller() {
            self.env().revert(BazaarError::NotAuthorized)
        }
        if syn.liquidated {
            self.env().revert(BazaarError::SyndicateLiquidated)
        }
        if rate_bps > 10_000 {
            self.env().revert(BazaarError::BadParams)
        }
        self.load_peril(peril_id); // existence check
        self.rates.set(&(syndicate_id, peril_id), rate_bps);
        self.env().emit_event(RateQuoted {
            syndicate_id,
            peril_id,
            rate_bps,
        });
    }

    // -- Policies -------------------------------------------------------------

    /// Bind cover. The attached CSPR is the premium; it must clear the
    /// syndicate's posted rate. The syndicate reserves `reserve_bps` of the
    /// payout from free capital for the life of the policy.
    #[odra(payable)]
    pub fn bind_policy(
        &mut self,
        peril_id: u32,
        syndicate_id: u32,
        payout: U512,
        expires_at: u64,
    ) -> u32 {
        let peril = self.load_peril(peril_id);
        if !peril.active {
            self.env().revert(BazaarError::UnknownPeril)
        }
        let mut syn = self.load_syndicate(syndicate_id);
        if syn.liquidated {
            self.env().revert(BazaarError::SyndicateLiquidated)
        }
        let now = self.env().get_block_time();
        // Max tenor 30 days keeps books short-dated for the demo economy.
        if expires_at <= now || expires_at > now + 30 * 24 * 3600 * 1000 {
            self.env().revert(BazaarError::BadExpiry)
        }
        let rate_bps = self.rates.get(&(syndicate_id, peril_id)).unwrap_or(0);
        if rate_bps == 0 {
            self.env().revert(BazaarError::NotQuoted)
        }
        if payout.is_zero() {
            self.env().revert(BazaarError::BadParams)
        }
        let premium = self.env().attached_value();
        let min_premium = payout * U512::from(rate_bps) / U512::from(10_000u64);
        if premium < min_premium {
            self.env().revert(BazaarError::PremiumTooLow)
        }
        let reserve = payout * U512::from(syn.reserve_bps) / U512::from(10_000u64);
        if syn.capital - syn.locked < reserve {
            self.env().revert(BazaarError::InsufficientCapacity)
        }

        // Premium joins the book; under a treaty, the ceded share moves now.
        syn.locked += reserve;
        syn.premiums_earned += premium;
        let mut retained = premium;
        if syn.reinsurer_id != NO_REINSURER {
            let ceded = premium * U512::from(syn.treaty_share_bps) / U512::from(10_000u64);
            retained -= ceded;
            let reinsurer_id = syn.reinsurer_id;
            let mut reinsurer = self.load_syndicate(reinsurer_id);
            reinsurer.capital += ceded;
            reinsurer.premiums_earned += ceded;
            self.syndicates.set(&reinsurer_id, reinsurer);
        }
        syn.capital += retained;

        let holder = self.env().caller();
        let policy_id = self.policy_count.get_or_default();
        self.policies.set(
            &policy_id,
            Policy {
                peril_id,
                syndicate_id,
                holder,
                premium,
                payout,
                reserved: reserve,
                bound_at: now,
                expires_at,
                status: STATUS_ACTIVE,
            },
        );
        self.policy_count.set(policy_id + 1);
        let idx = self.syndicate_policy_count.get(&syndicate_id).unwrap_or(0);
        self.syndicate_policies.set(&(syndicate_id, idx), policy_id);
        self.syndicate_policy_count.set(&syndicate_id, idx + 1);
        self.syndicates.set(&syndicate_id, syn);

        self.env().emit_event(PolicyBound {
            policy_id,
            peril_id,
            syndicate_id,
            holder,
            premium,
            payout,
            expires_at,
        });
        policy_id
    }

    /// Settle a policy against an oracle observation. Anyone may call —
    /// settlement is mechanical, permissionless, and pays straight to the
    /// holder. If the books can't cover the claim, the bell rings twice.
    pub fn settle(&mut self, policy_id: u32, obs_seq: u32) {
        let mut policy = self.load_policy(policy_id);
        if policy.status != STATUS_ACTIVE {
            self.env().revert(BazaarError::PolicyNotActive)
        }
        let peril = self.load_peril(policy.peril_id);

        // Read the observation cross-contract from the oracle this bazaar trusts.
        let oracle = crate::oracle::KismetOracleContractRef::new(
            self.env(),
            self.oracle.get().unwrap_or_revert(&self.env()),
        );
        let obs = oracle.get_observation(peril.source_id.clone(), obs_seq);
        if obs.observed_at < policy.bound_at || obs.observed_at > policy.expires_at {
            self.env().revert(BazaarError::ObservationOutOfWindow)
        }

        // Ask the peril's trigger contract whether the event happened.
        let trigger = PerilTriggerContractRef::new(self.env(), peril.trigger);
        if !trigger.evaluate(obs.value) {
            self.env().revert(BazaarError::TriggerNotMet)
        }

        // Claim flow. Reinsurer pays its share first (up to its capital),
        // the cedent covers the rest (up to its own). Shortfall is public.
        let payout = policy.payout;
        let syndicate_id = policy.syndicate_id;
        let mut syn = self.load_syndicate(syndicate_id);
        let mut total_paid = U512::zero();

        if syn.reinsurer_id != NO_REINSURER {
            let reinsurer_id = syn.reinsurer_id;
            let mut reinsurer = self.load_syndicate(reinsurer_id);
            if !reinsurer.liquidated {
                let share_due = payout * U512::from(syn.treaty_share_bps) / U512::from(10_000u64);
                let share_paid = if reinsurer.capital < share_due {
                    reinsurer.capital
                } else {
                    share_due
                };
                reinsurer.capital -= share_paid;
                reinsurer.claims_paid += share_paid;
                total_paid += share_paid;
                let reinsurer_broke = reinsurer.capital.is_zero() && share_paid < share_due;
                self.syndicates.set(&reinsurer_id, reinsurer);
                if reinsurer_broke {
                    self.wind_up(reinsurer_id, "reinsurance share unpayable");
                }
            }
        }

        let cedent_due = payout - total_paid;
        let cedent_paid = if syn.capital < cedent_due {
            syn.capital
        } else {
            cedent_due
        };
        syn.capital -= cedent_paid;
        syn.claims_paid += cedent_paid;
        // Release the reserve (it was part of capital accounting all along).
        syn.locked -= policy.reserved;
        total_paid += cedent_paid;
        let cedent_broke = cedent_paid < cedent_due;
        self.syndicates.set(&syndicate_id, syn);

        policy.status = STATUS_PAID;
        let holder = policy.holder;
        self.policies.set(&policy_id, policy);

        if !total_paid.is_zero() {
            self.env().transfer_tokens(&holder, &total_paid);
        }
        let shortfall = payout - total_paid;
        self.env().emit_event(ClaimPaid {
            policy_id,
            syndicate_id,
            holder,
            paid: total_paid,
            shortfall,
        });
        self.env().emit_event(BellRung {
            syndicate_id,
            strikes: 1,
            reason: "claim paid".to_string(),
        });

        if cedent_broke {
            self.wind_up(syndicate_id, "claim exceeded capital");
        }
    }

    /// Expire a policy past its window: reserve unlocks, premium stays earned.
    pub fn expire(&mut self, policy_id: u32) {
        let mut policy = self.load_policy(policy_id);
        if policy.status != STATUS_ACTIVE {
            self.env().revert(BazaarError::PolicyNotActive)
        }
        if self.env().get_block_time() <= policy.expires_at {
            self.env().revert(BazaarError::PolicyNotExpired)
        }
        let syndicate_id = policy.syndicate_id;
        let mut syn = self.load_syndicate(syndicate_id);
        if !syn.liquidated {
            syn.locked -= policy.reserved;
            self.syndicates.set(&syndicate_id, syn);
        }
        policy.status = STATUS_EXPIRED;
        let premium_kept = policy.premium;
        self.policies.set(&policy_id, policy);
        self.env().emit_event(PolicyExpired {
            policy_id,
            syndicate_id,
            premium_kept,
        });
    }

    // -- Reinsurance ------------------------------------------------------------

    /// Cedent proposes a quota-share treaty to a reinsurer.
    pub fn propose_treaty(&mut self, cedent_id: u32, reinsurer_id: u32, share_bps: u32) {
        let cedent = self.load_syndicate(cedent_id);
        if cedent.owner != self.env().caller() {
            self.env().revert(BazaarError::NotAuthorized)
        }
        if share_bps == 0 || share_bps > 5_000 || cedent_id == reinsurer_id {
            self.env().revert(BazaarError::BadParams)
        }
        self.load_syndicate(reinsurer_id); // existence check
        self.treaty_proposals
            .set(&(cedent_id, reinsurer_id), share_bps);
        self.env().emit_event(TreatyProposed {
            cedent_id,
            reinsurer_id,
            share_bps,
        });
    }

    /// Reinsurer accepts; the treaty binds future policies of the cedent.
    pub fn accept_treaty(&mut self, cedent_id: u32, reinsurer_id: u32) {
        let reinsurer = self.load_syndicate(reinsurer_id);
        if reinsurer.owner != self.env().caller() {
            self.env().revert(BazaarError::NotAuthorized)
        }
        let share_bps = self
            .treaty_proposals
            .get(&(cedent_id, reinsurer_id))
            .unwrap_or(0);
        if share_bps == 0 {
            self.env().revert(BazaarError::NoTreatyProposal)
        }
        let mut cedent = self.load_syndicate(cedent_id);
        cedent.reinsurer_id = reinsurer_id;
        cedent.treaty_share_bps = share_bps;
        self.syndicates.set(&cedent_id, cedent);
        self.treaty_proposals.set(&(cedent_id, reinsurer_id), 0);
        self.env().emit_event(TreatyBound {
            cedent_id,
            reinsurer_id,
            share_bps,
        });
    }

    // -- Solvency --------------------------------------------------------------

    /// Anyone may ring the solvency check: if reserved cover exceeds capital,
    /// the syndicate is wound up in public view.
    pub fn ring_solvency_check(&mut self, syndicate_id: u32) {
        let syn = self.load_syndicate(syndicate_id);
        if syn.liquidated {
            self.env().revert(BazaarError::SyndicateLiquidated)
        }
        if syn.capital >= syn.locked {
            self.env().revert(BazaarError::NotInsolvent)
        }
        self.wind_up(syndicate_id, "reserves exceed capital");
    }

    // -- Views -------------------------------------------------------------------

    pub fn syndicate(&self, syndicate_id: u32) -> Syndicate {
        self.load_syndicate(syndicate_id)
    }

    pub fn peril(&self, peril_id: u32) -> Peril {
        self.load_peril(peril_id)
    }

    pub fn policy(&self, policy_id: u32) -> Policy {
        self.load_policy(policy_id)
    }

    pub fn rate(&self, syndicate_id: u32, peril_id: u32) -> u32 {
        self.rates.get(&(syndicate_id, peril_id)).unwrap_or(0)
    }

    pub fn counts(&self) -> (u32, u32, u32) {
        (
            self.syndicate_count.get_or_default(),
            self.peril_count.get_or_default(),
            self.policy_count.get_or_default(),
        )
    }

    pub fn oracle_address(&self) -> Address {
        self.oracle.get().unwrap_or_revert(&self.env())
    }

    // -- Internals ----------------------------------------------------------------

    fn load_syndicate(&self, id: u32) -> Syndicate {
        match self.syndicates.get(&id) {
            Some(s) => s,
            None => self.env().revert(BazaarError::UnknownSyndicate),
        }
    }

    fn load_peril(&self, id: u32) -> Peril {
        match self.perils.get(&id) {
            Some(p) => p,
            None => self.env().revert(BazaarError::UnknownPeril),
        }
    }

    fn load_policy(&self, id: u32) -> Policy {
        match self.policies.get(&id) {
            Some(p) => p,
            None => self.env().revert(BazaarError::UnknownPolicy),
        }
    }

    /// Liquidation: ring the bell twice, void the remaining book, and refund
    /// stranded holders pro-rata by premium from whatever capital is left.
    fn wind_up(&mut self, syndicate_id: u32, reason: &str) {
        let mut syn = self.load_syndicate(syndicate_id);
        if syn.liquidated {
            return;
        }
        syn.liquidated = true;

        // Collect the still-active book.
        let n = self.syndicate_policy_count.get(&syndicate_id).unwrap_or(0);
        let mut active: Vec<u32> = Vec::new();
        let mut premium_sum = U512::zero();
        for i in 0..n {
            if let Some(pid) = self.syndicate_policies.get(&(syndicate_id, i)) {
                if let Some(p) = self.policies.get(&pid) {
                    if p.status == STATUS_ACTIVE {
                        premium_sum += p.premium;
                        active.push(pid);
                    }
                }
            }
        }

        // Pro-rata refunds from the remains of the book.
        let pot = syn.capital;
        let mut refunded_total = U512::zero();
        for pid in active.iter() {
            let mut p = self.load_policy(*pid);
            let refund = if premium_sum.is_zero() {
                U512::zero()
            } else {
                pot * p.premium / premium_sum
            };
            p.status = STATUS_VOIDED;
            let holder = p.holder;
            self.policies.set(pid, p);
            if !refund.is_zero() {
                self.env().transfer_tokens(&holder, &refund);
                refunded_total += refund;
            }
        }
        syn.capital -= refunded_total;
        syn.locked = U512::zero();
        self.syndicates.set(&syndicate_id, syn);

        self.env().emit_event(BellRung {
            syndicate_id,
            strikes: 2,
            reason: reason.to_string(),
        });
        self.env().emit_event(SyndicateWoundUp {
            syndicate_id,
            refunded: refunded_total,
            voided_policies: active.len() as u32,
        });
    }
}

// ---------------------------------------------------------------------------
// Tests — OdraVM. These run in CI (casper-types is Unix-only).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oracle::KismetOracle;
    use crate::perils::{ThresholdPeril, ThresholdPerilInitArgs};
    use odra::host::{Deployer, HostEnv, HostRef, NoArgs};

    const HOUR: u64 = 3600 * 1000;

    fn cspr(n: u64) -> U512 {
        // 1 CSPR = 1e9 motes
        U512::from(n) * U512::from(1_000_000_000u64)
    }

    struct World {
        env: HostEnv,
        oracle: crate::oracle::KismetOracleHostRef,
        bazaar: KismetBazaarHostRef,
        peril_id: u32,
    }

    /// A bazaar with one registered rain source and a >=12.50mm trigger.
    fn setup() -> World {
        let env = odra_test::env();
        let mut oracle = KismetOracle::deploy(&env, NoArgs);
        oracle.register_source(
            "istanbul-rain-24h".to_string(),
            "Istanbul 24h rainfall, mm x100".to_string(),
            "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.95".to_string(),
            "mm x100".to_string(),
        );
        let trigger = ThresholdPeril::deploy(
            &env,
            ThresholdPerilInitArgs {
                gte: true,
                threshold: 1250,
                label: "Istanbul 24h rain >= 12.50mm".to_string(),
                forge_tag: "template-forged".to_string(),
            },
        );
        let mut bazaar = KismetBazaar::deploy(
            &env,
            KismetBazaarInitArgs {
                oracle: *oracle.address(),
            },
        );
        let peril_id = bazaar.list_peril("istanbul-rain-24h".to_string(), *trigger.address());
        World {
            env,
            oracle,
            bazaar,
            peril_id,
        }
    }

    /// Register a syndicate owned by account `acct` with capital and a quote.
    fn open_syndicate(w: &mut World, acct: usize, name: &str, reserve_bps: u32, capital: U512, rate_bps: u32) -> u32 {
        w.env.set_caller(w.env.get_account(acct));
        let id = w
            .bazaar
            .register_syndicate(name.to_string(), "motto".to_string(), reserve_bps);
        w.bazaar.with_tokens(capital).deposit_capital(id);
        w.bazaar.quote_rate(id, w.peril_id, rate_bps);
        id
    }

    #[test]
    fn full_lifecycle_bind_trigger_payout() {
        let mut w = setup();
        // Sage Mutual: fully reserved, 8% rate.
        let sage = open_syndicate(&mut w, 1, "Sage Mutual", 10_000, cspr(100), 800);

        // Holder (account 2) buys 50 CSPR of cover for 4 CSPR premium.
        let holder = w.env.get_account(2);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        let policy_id =
            w.bazaar
                .with_tokens(cspr(4))
                .bind_policy(w.peril_id, sage, cspr(50), expires);

        let syn = w.bazaar.syndicate(sage);
        assert_eq!(syn.capital, cspr(104), "premium joined the book");
        assert_eq!(syn.locked, cspr(50), "full reserve locked");

        // Rain comes: 13.00mm >= 12.50mm.
        w.env.set_caller(w.env.get_account(0));
        let seq = w.oracle.post_observation(
            "istanbul-rain-24h".to_string(),
            1300,
            w.env.block_time() + HOUR,
            "open-meteo:precipitation_sum".to_string(),
        );

        w.env.advance_block_time(2 * HOUR);
        let balance_before = w.env.balance_of(&holder);
        w.bazaar.settle(policy_id, seq);

        assert_eq!(
            w.env.balance_of(&holder) - balance_before,
            cspr(50),
            "holder received the payout"
        );
        let syn = w.bazaar.syndicate(sage);
        assert_eq!(syn.capital, cspr(54));
        assert_eq!(syn.locked, U512::zero());
        assert!(!syn.liquidated);
        assert_eq!(w.bazaar.policy(policy_id).status, STATUS_PAID);
    }

    #[test]
    fn expiry_keeps_premium() {
        let mut w = setup();
        let sage = open_syndicate(&mut w, 1, "Sage Mutual", 10_000, cspr(100), 800);
        let holder = w.env.get_account(2);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        let policy_id =
            w.bazaar
                .with_tokens(cspr(4))
                .bind_policy(w.peril_id, sage, cspr(50), expires);

        w.env.advance_block_time(25 * HOUR);
        w.bazaar.expire(policy_id);
        let syn = w.bazaar.syndicate(sage);
        assert_eq!(syn.capital, cspr(104), "premium kept");
        assert_eq!(syn.locked, U512::zero());
        assert_eq!(w.bazaar.policy(policy_id).status, STATUS_EXPIRED);
    }

    #[test]
    fn leveraged_syndicate_goes_broke_and_bell_rings_twice() {
        let mut w = setup();
        // Cavalier: 30% reserves, cheap 3% rate, thin capital.
        let cavalier = open_syndicate(&mut w, 1, "Cavalier Syndicate", 3_000, cspr(30), 300);

        // Two holders buy big cover cheap.
        let holder_a = w.env.get_account(2);
        w.env.set_caller(holder_a);
        let expires = w.env.block_time() + 24 * HOUR;
        let p1 = w
            .bazaar
            .with_tokens(cspr(3))
            .bind_policy(w.peril_id, cavalier, cspr(90), expires);

        let holder_b = w.env.get_account(3);
        w.env.set_caller(holder_b);
        let p2 = w
            .bazaar
            .with_tokens(cspr(2))
            .bind_policy(w.peril_id, cavalier, cspr(20), expires);

        // Storm hits.
        w.env.set_caller(w.env.get_account(0));
        let seq = w.oracle.post_observation(
            "istanbul-rain-24h".to_string(),
            2000,
            w.env.block_time() + HOUR,
            "open-meteo:precipitation_sum".to_string(),
        );
        w.env.advance_block_time(2 * HOUR);

        // Claim on the 90-CSPR policy: capital is only 35 (30 + 5 premiums).
        let a_before = w.env.balance_of(&holder_a);
        let b_before = w.env.balance_of(&holder_b);
        w.bazaar.settle(p1, seq);

        let paid_a = w.env.balance_of(&holder_a) - a_before;
        assert_eq!(paid_a, cspr(35), "holder got everything the book had");

        let syn = w.bazaar.syndicate(cavalier);
        assert!(syn.liquidated, "Cavalier wound up");
        assert_eq!(syn.capital, U512::zero());
        assert_eq!(
            w.bazaar.policy(p2).status,
            STATUS_VOIDED,
            "remaining book voided"
        );
        // Nothing left to refund holder B (pot was empty), but status is clear.
        assert_eq!(w.env.balance_of(&holder_b), b_before);
        // Dead books cannot quote or bind.
        w.env.set_caller(w.env.get_account(1));
        assert!(w
            .bazaar
            .try_quote_rate(cavalier, w.peril_id, 500)
            .is_err());
    }

    #[test]
    fn quota_share_treaty_splits_premium_and_claims() {
        let mut w = setup();
        let cedent = open_syndicate(&mut w, 1, "Atlas Parametric", 10_000, cspr(100), 1000);
        let reinsurer = open_syndicate(&mut w, 2, "Meridian Re", 10_000, cspr(100), 0);

        // 40% quota share, proposed by cedent owner, accepted by reinsurer owner.
        w.env.set_caller(w.env.get_account(1));
        w.bazaar.propose_treaty(cedent, reinsurer, 4_000);
        w.env.set_caller(w.env.get_account(2));
        w.bazaar.accept_treaty(cedent, reinsurer);

        // Holder buys 50 cover for 5 premium: 2 ceded, 3 retained.
        let holder = w.env.get_account(3);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        let policy_id =
            w.bazaar
                .with_tokens(cspr(5))
                .bind_policy(w.peril_id, cedent, cspr(50), expires);

        assert_eq!(w.bazaar.syndicate(cedent).capital, cspr(103));
        assert_eq!(w.bazaar.syndicate(reinsurer).capital, cspr(102));

        // Trigger: reinsurer pays 20, cedent pays 30.
        w.env.set_caller(w.env.get_account(0));
        let seq = w.oracle.post_observation(
            "istanbul-rain-24h".to_string(),
            1500,
            w.env.block_time() + HOUR,
            "open-meteo".to_string(),
        );
        w.env.advance_block_time(2 * HOUR);
        let before = w.env.balance_of(&holder);
        w.bazaar.settle(policy_id, seq);

        assert_eq!(w.env.balance_of(&holder) - before, cspr(50));
        assert_eq!(w.bazaar.syndicate(cedent).capital, cspr(73));
        assert_eq!(w.bazaar.syndicate(reinsurer).capital, cspr(82));
        assert!(!w.bazaar.syndicate(cedent).liquidated);
        assert!(!w.bazaar.syndicate(reinsurer).liquidated);
    }

    #[test]
    fn settle_rejects_untriggered_and_out_of_window() {
        let mut w = setup();
        let sage = open_syndicate(&mut w, 1, "Sage Mutual", 10_000, cspr(100), 800);
        let holder = w.env.get_account(2);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        let policy_id =
            w.bazaar
                .with_tokens(cspr(4))
                .bind_policy(w.peril_id, sage, cspr(50), expires);

        // Drizzle below threshold: 3.00mm < 12.50mm.
        w.env.set_caller(w.env.get_account(0));
        let seq = w.oracle.post_observation(
            "istanbul-rain-24h".to_string(),
            300,
            w.env.block_time() + HOUR,
            "open-meteo".to_string(),
        );
        w.env.advance_block_time(2 * HOUR);
        assert_eq!(
            w.bazaar.try_settle(policy_id, seq).unwrap_err(),
            BazaarError::TriggerNotMet.into()
        );

        // A storm recorded after expiry cannot settle the policy.
        let late_seq = w.oracle.post_observation(
            "istanbul-rain-24h".to_string(),
            5000,
            w.env.block_time() + 48 * HOUR,
            "open-meteo".to_string(),
        );
        assert_eq!(
            w.bazaar.try_settle(policy_id, late_seq).unwrap_err(),
            BazaarError::ObservationOutOfWindow.into()
        );
    }

    #[test]
    fn premium_below_quoted_rate_rejected() {
        let mut w = setup();
        let sage = open_syndicate(&mut w, 1, "Sage Mutual", 10_000, cspr(100), 800);
        let holder = w.env.get_account(2);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        // 8% of 50 = 4 CSPR minimum; offering 1 CSPR.
        let result =
            w.bazaar
                .with_tokens(cspr(1))
                .try_bind_policy(w.peril_id, sage, cspr(50), expires);
        assert_eq!(result.unwrap_err(), BazaarError::PremiumTooLow.into());
    }

    #[test]
    fn capacity_is_enforced() {
        let mut w = setup();
        // Fully-reserved book with 40 capital cannot write 50 cover.
        let sage = open_syndicate(&mut w, 1, "Sage Mutual", 10_000, cspr(40), 800);
        let holder = w.env.get_account(2);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        let result =
            w.bazaar
                .with_tokens(cspr(4))
                .try_bind_policy(w.peril_id, sage, cspr(50), expires);
        assert_eq!(
            result.unwrap_err(),
            BazaarError::InsufficientCapacity.into()
        );
    }

    #[test]
    fn withdraw_respects_reserves_and_ownership() {
        let mut w = setup();
        let sage = open_syndicate(&mut w, 1, "Sage Mutual", 10_000, cspr(100), 800);
        let holder = w.env.get_account(2);
        w.env.set_caller(holder);
        let expires = w.env.block_time() + 24 * HOUR;
        w.bazaar
            .with_tokens(cspr(4))
            .bind_policy(w.peril_id, sage, cspr(50), expires);

        // Stranger cannot withdraw.
        w.env.set_caller(w.env.get_account(3));
        assert!(w.bazaar.try_withdraw_capital(sage, cspr(1)).is_err());

        // Owner cannot dip into the 50 reserved out of 104.
        w.env.set_caller(w.env.get_account(1));
        assert_eq!(
            w.bazaar.try_withdraw_capital(sage, cspr(60)).unwrap_err(),
            BazaarError::CapitalReserved.into()
        );
        // But free capital moves.
        w.bazaar.withdraw_capital(sage, cspr(54));
        assert_eq!(w.bazaar.syndicate(sage).capital, cspr(50));
    }
}
