import type { SnapshotPolicy, SnapshotSyndicate } from "../lib/types";
import { STATUS_PAID } from "../lib/types";
import { motesToCspr, utcShort } from "../lib/format";
import { Bell, SectionHead } from "./glyphs";

interface BellEvent {
  key: string;
  strikes: 1 | 2;
  text: string;
  detail: string;
  when: string | null;
  /** Sort key: liquidations float above the claims they caused. */
  order: number;
}

export function BellEvents({
  policies,
  syndicates,
}: {
  policies: SnapshotPolicy[];
  syndicates: SnapshotSyndicate[];
}) {
  const byId = new Map(syndicates.map((s) => [s.syndicate_id, s]));

  const events: BellEvent[] = [];

  for (const s of syndicates) {
    if (s.liquidated) {
      events.push({
        key: `wind-up-${s.syndicate_id}`,
        strikes: 2,
        text: `${s.name} wound up`,
        detail: "the bell rings twice — partial payout, voided book, pro-rata refunds",
        when: null,
        order: Number.MAX_SAFE_INTEGER - s.syndicate_id,
      });
    }
  }

  for (const p of policies) {
    if (p.status === STATUS_PAID) {
      const name = byId.get(p.syndicate_id)?.name ?? `Syndicate ${p.syndicate_id}`;
      events.push({
        key: `claim-${p.policy_id}`,
        strikes: 1,
        text: `one strike — claim #${p.policy_id} paid by ${name}`,
        detail: `${motesToCspr(p.payout_motes)} CSPR to the holder, settled by the contract`,
        when: `bound ${utcShort(p.bound_at)}`,
        order: p.policy_id,
      });
    }
  }

  events.sort((a, b) => b.order - a.order);

  return (
    <section className="section">
      <SectionHead title="BELL EVENTS" note="the Lutine record" />
      {events.length === 0 ? (
        <p className="emptyLine">The bell has not rung yet. Give the weather time.</p>
      ) : (
        <ul className="bellList">
          {events.map((e) => (
            <li key={e.key}>
              <span className="bellGlyphs">
                <Bell size={14} />
                {e.strikes === 2 ? <Bell size={14} /> : null}
              </span>
              <span className="bellText">
                <span className="mono">{e.text}</span>
                <span className="muted"> — {e.detail}</span>
              </span>
              {e.when ? <span className="bellWhen">{e.when}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
