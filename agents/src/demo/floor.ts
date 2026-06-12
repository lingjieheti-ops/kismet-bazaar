// The trading floor, in memory, in twenty seconds.
//
//   cd agents && npm install && npm run demo
//
// No keys, no network, no chain. This file replays the bazaar's exact
// economics — same reserve math, same premium rule, same wind-up waterfall
// as contracts/src/bazaar.rs — so a judge can watch a full life-and-death
// cycle before deciding whether to look at the real one on Casper Testnet.

interface Syndicate {
  name: string;
  motto: string;
  capital: bigint;
  locked: bigint;
  reserveBps: bigint;
  liquidated: boolean;
}

interface Policy {
  id: number;
  holder: string;
  syndicate: Syndicate;
  premium: bigint;
  payout: bigint;
  reserved: bigint;
  status: "active" | "paid" | "expired" | "voided";
}

const CSPR = 1_000_000_000n;
const fmt = (m: bigint) => `${(Number(m / 10_000_000n) / 100).toFixed(2)} CSPR`;

const out: string[] = [];
function line(s = "") {
  out.push(s);
}
function rule() {
  line("  " + "─".repeat(64));
}

function bind(
  policies: Policy[],
  syndicate: Syndicate,
  holder: string,
  payout: bigint,
  rateBps: bigint,
): Policy {
  const premium = (payout * rateBps) / 10_000n;
  const reserved = (payout * syndicate.reserveBps) / 10_000n;
  if (syndicate.capital - syndicate.locked < reserved) {
    throw new Error(`${syndicate.name}: insufficient capacity`);
  }
  syndicate.locked += reserved;
  syndicate.capital += premium;
  const policy: Policy = {
    id: policies.length,
    holder,
    syndicate,
    premium,
    payout,
    reserved,
    status: "active",
  };
  policies.push(policy);
  line(
    `  POLICY #${policy.id}  ${holder} buys ${fmt(payout)} cover from ${syndicate.name}` +
      `  · premium ${fmt(premium)} (${rateBps}bps) · reserve ${fmt(reserved)}`,
  );
  return policy;
}

function settle(policies: Policy[], policy: Policy) {
  const syn = policy.syndicate;
  const due = policy.payout;
  const paid = syn.capital < due ? syn.capital : due;
  syn.capital -= paid;
  syn.locked -= policy.reserved;
  policy.status = "paid";
  line(`  CLAIM   policy #${policy.id} triggered — ${syn.name} pays ${fmt(paid)} to ${policy.holder}`);
  line(`  🔔      the bell rings once.`);
  if (paid < due) {
    line(`  SHORTFALL ${fmt(due - paid)} — ${syn.name} cannot cover its book.`);
    windUp(policies, syn);
  }
}

function windUp(policies: Policy[], syn: Syndicate) {
  syn.liquidated = true;
  const stranded = policies.filter((p) => p.syndicate === syn && p.status === "active");
  const premiumSum = stranded.reduce((a, p) => a + p.premium, 0n);
  line(`  🔔🔔    the bell rings twice. ${syn.name} is wound up on-chain.`);
  for (const p of stranded) {
    const refund = premiumSum === 0n ? 0n : (syn.capital * p.premium) / premiumSum;
    p.status = "voided";
    line(`  WIND-UP policy #${p.id} voided · ${p.holder} refunded ${fmt(refund)} pro-rata`);
  }
  syn.capital = 0n;
  syn.locked = 0n;
}

function balanceSheet(syndicates: Syndicate[]) {
  rule();
  line("  BALANCE SHEET");
  for (const s of syndicates) {
    const status = s.liquidated ? "LIQUIDATED" : "solvent";
    line(
      `    ${s.name.padEnd(20)} capital ${fmt(s.capital).padStart(12)} · locked ${fmt(s.locked).padStart(12)} · reserves ${s.reserveBps}bps · ${status}`,
    );
  }
  rule();
}

// ---------------------------------------------------------------------------

const sage: Syndicate = {
  name: "Sage Mutual",
  motto: "We have seen storms before.",
  capital: 200n * CSPR,
  locked: 0n,
  reserveBps: 10_000n,
  liquidated: false,
};
const cavalier: Syndicate = {
  name: "Cavalier Syndicate",
  motto: "Risk is just yield wearing a mask.",
  capital: 60n * CSPR,
  locked: 0n,
  reserveBps: 3_000n,
  liquidated: false,
};

const policies: Policy[] = [];

line();
line("  KISMET — the parametric insurance bazaar, underwritten by machines");
line("  (in-memory replay of the on-chain economics; same math as bazaar.rs)");
rule();
line(`  ${sage.name.padEnd(20)} "${sage.motto}"  reserves 100%`);
line(`  ${cavalier.name.padEnd(20)} "${cavalier.motto}"  reserves 30%`);
balanceSheet([sage, cavalier]);

line("  MORNING — the floor opens. Istanbul rain cover, 24h tenor.");
line(`  ${sage.name} quotes 1280bps (it has seen storms before).`);
line(`  ${cavalier.name} quotes 290bps (it has not).`);
line();
bind(policies, cavalier, "holder-A", 80n * CSPR, 290n);
bind(policies, cavalier, "holder-B", 30n * CSPR, 290n);
bind(policies, sage, "holder-C", 40n * CSPR, 1280n);
balanceSheet([sage, cavalier]);

line("  18:40 UTC — Open-Meteo reports 14.2mm over Istanbul. Threshold: 12.50mm.");
line("  Anyone may settle; settlement is mechanical.");
line();
const [a, b, c] = policies;
settle(policies, a!); // 80 CSPR claim vs Cavalier's thin book
line();
balanceSheet([sage, cavalier]);

line(`  ${sage.name} settles its own storm claim without drama:`);
settle(policies, c!);
void b;
balanceSheet([sage, cavalier]);

line("  Same storm. Same floor. One book priced fate; the other dared it.");
line();
line("  Everything above also happened for real on Casper Testnet —");
line("  see docs/ONCHAIN.md for the transaction trail.");
line();

console.log(out.join("\n"));
