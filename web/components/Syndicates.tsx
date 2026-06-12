import type { SnapshotSyndicate } from "../lib/types";
import { CHARTER_ROSTER, perilShort } from "../lib/constants";
import { bpsToPct, motesToCspr, pctOf } from "../lib/format";
import { Bell, SectionHead } from "./glyphs";

// Reserving below half cover is leverage worth flagging in the margin.
const THIN_RESERVE_BPS = 5_000;

function freeMotes(capital: string, locked: string): string {
  try {
    const free = BigInt(capital) - BigInt(locked);
    return (free < 0n ? 0n : free).toString();
  } catch {
    return "0";
  }
}

function SyndicateCard({
  s,
  all,
}: {
  s: SnapshotSyndicate;
  all: SnapshotSyndicate[];
}) {
  const lockedPct = pctOf(s.locked_motes, s.capital_motes);
  const freePct = Math.max(0, 100 - lockedPct);
  const reinsurer =
    s.reinsurer_id !== null ? all.find((x) => x.syndicate_id === s.reinsurer_id) : undefined;

  return (
    <article className={`synCard${s.liquidated ? " liquidated" : ""}`}>
      <span className="synNo">Syndicate No. {s.syndicate_id}</span>
      <h3 className="synName">{s.name}</h3>
      <p className="synMotto">“{s.motto}”</p>

      <div className="synCapital">
        {motesToCspr(s.capital_motes)} <small>CSPR CAPITAL</small>
      </div>

      <div
        className="bar"
        role="img"
        aria-label={`Capital ${lockedPct.toFixed(0)}% locked, ${freePct.toFixed(0)}% free`}
      >
        <span className="barLocked" style={{ width: `${lockedPct}%` }} />
        <span className="barFree" style={{ width: `${freePct}%` }} />
      </div>
      <div className="barCaption">
        <span>locked {motesToCspr(s.locked_motes)}</span>
        <span>free {motesToCspr(freeMotes(s.capital_motes, s.locked_motes))}</span>
      </div>

      <div className="reserveLine">
        <span className={s.reserve_bps < THIN_RESERVE_BPS ? "reserveThin" : undefined}>
          reserves {bpsToPct(s.reserve_bps)}
        </span>
      </div>

      <div className="synLedgerLines">
        <div>
          <span>premiums earned</span>
          <span>{motesToCspr(s.premiums_earned_motes)}</span>
        </div>
        <div>
          <span>claims paid</span>
          <span>{motesToCspr(s.claims_paid_motes)}</span>
        </div>
      </div>

      {s.rates.length > 0 ? (
        <table className="ratesTable">
          <caption>Posted rates</caption>
          <tbody>
            {s.rates.map((r) => (
              <tr key={r.peril_id}>
                <td>{perilShort(r.peril_id)}</td>
                <td>{(r.rate_bps / 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="treatyNote">No rates posted this cycle.</p>
      )}

      {reinsurer && s.treaty_share_bps > 0 ? (
        <p className="treatyNote">
          cedes {bpsToPct(s.treaty_share_bps)} to {reinsurer.name}
        </p>
      ) : null}

      {s.liquidated ? (
        <span className="stampOverlay">
          <Bell size={15} />
          <Bell size={15} />
          LIQUIDATED
        </span>
      ) : null}
    </article>
  );
}

export function Syndicates({ syndicates }: { syndicates: SnapshotSyndicate[] }) {
  return (
    <section className="section">
      <SectionHead
        title="THE SYNDICATES"
        note={`${syndicates.length} names on the floor`}
      />
      {syndicates.length === 0 ? (
        <p className="emptyLine">No syndicates have registered. The floor stands empty.</p>
      ) : (
        <div className="synGrid">
          {syndicates.map((s) => (
            <SyndicateCard key={s.syndicate_id} s={s} all={syndicates} />
          ))}
        </div>
      )}
    </section>
  );
}

// Pre-launch: the roster as filed in the charter, no chain figures invented.
export function CharterRoster() {
  return (
    <section className="section">
      <SectionHead title="THE SYNDICATES" note="roster as filed — awaiting charter" />
      <div className="synGrid">
        {CHARTER_ROSTER.map((p, i) => (
          <article key={p.name} className="synCard">
            <span className="synNo">Charter filing No. {i + 1}</span>
            <h3 className="synName">{p.name}</h3>
            <p className="synMotto">“{p.motto}”</p>
            <div className="reserveLine">
              <span className={p.reserve_bps < THIN_RESERVE_BPS ? "reserveThin" : undefined}>
                reserve covenant {bpsToPct(p.reserve_bps)}
              </span>
            </div>
            <div className="synLedgerLines">
              <div>
                <span>charter pledge</span>
                <span>{p.charter_pledge_cspr} CSPR</span>
              </div>
            </div>
            <p className="treatyNote">{p.doctrine}</p>
            <span className="stampOverlay stampCharter">AWAITING CHARTER</span>
          </article>
        ))}
      </div>
    </section>
  );
}
