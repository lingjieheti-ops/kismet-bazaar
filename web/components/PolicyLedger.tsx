import type { SnapshotPolicy, SnapshotSyndicate } from "../lib/types";
import {
  STATUS_ACTIVE,
  STATUS_EXPIRED,
  STATUS_PAID,
  STATUS_VOIDED,
} from "../lib/types";
import { perilLabel } from "../lib/constants";
import { motesToCspr, truncateHash, utcShort } from "../lib/format";
import { Bell, SectionHead } from "./glyphs";

function StatusCell({ status }: { status: number }) {
  switch (status) {
    case STATUS_ACTIVE:
      return <span className="statusActive">ACTIVE</span>;
    case STATUS_PAID:
      return (
        <span className="statusPaid">
          <Bell />
          claim paid
        </span>
      );
    case STATUS_EXPIRED:
      return <span className="statusExpired">EXPIRED</span>;
    case STATUS_VOIDED:
      return (
        <span className="statusVoided">
          <span className="struck">VOIDED</span> book wound up
        </span>
      );
    default:
      return <span className="muted">status {status}</span>;
  }
}

export function PolicyLedger({
  policies,
  syndicates,
}: {
  policies: SnapshotPolicy[];
  syndicates: SnapshotSyndicate[];
}) {
  const byId = new Map(syndicates.map((s) => [s.syndicate_id, s]));
  const rows = [...policies].sort((a, b) => b.policy_id - a.policy_id);

  return (
    <section className="section">
      <SectionHead title="THE POLICY LEDGER" note={`${policies.length} entries`} />
      {rows.length === 0 ? (
        <p className="emptyLine">
          No cover has been bound. The first policy will be entered here in ink.
        </p>
      ) : (
        <div className="tableScroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>No.</th>
                <th>Peril</th>
                <th>Syndicate</th>
                <th>Holder</th>
                <th>Premium → Payout</th>
                <th>Bound</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.policy_id}>
                  <td>#{p.policy_id}</td>
                  <td className="wrap">{perilLabel(p.peril_id)}</td>
                  <td>{byId.get(p.syndicate_id)?.name ?? `Syndicate ${p.syndicate_id}`}</td>
                  <td title={p.holder}>{truncateHash(p.holder)}</td>
                  <td>
                    {motesToCspr(p.premium_motes)} → {motesToCspr(p.payout_motes)} CSPR
                  </td>
                  <td>{utcShort(p.bound_at)}</td>
                  <td>{utcShort(p.expires_at)}</td>
                  <td>
                    <StatusCell status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
