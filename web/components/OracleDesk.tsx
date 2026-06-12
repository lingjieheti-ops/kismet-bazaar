import type { ObservationGroup, SnapshotObservation } from "../lib/types";
import { sourceInfo } from "../lib/constants";
import { humanizeObservation, utcShort } from "../lib/format";
import { SectionHead, Sparkline } from "./glyphs";

function chronological(group: ObservationGroup): SnapshotObservation[] {
  return [...(group.recent ?? [])].sort((a, b) => a.seq - b.seq);
}

export function OracleDesk({ groups }: { groups: ObservationGroup[] }) {
  return (
    <section className="section">
      <SectionHead title="THE ORACLE DESK" note="every reading re-fetchable upstream" />
      {groups.length === 0 ? (
        <p className="emptyLine">The desk is quiet. Sources are being registered.</p>
      ) : (
        <div className="tableScroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>Source</th>
                <th>Latest</th>
                <th>Observed</th>
                <th>Recent</th>
                <th>Provenance</th>
                <th>Upstream</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const series = chronological(g);
                const last = series.length > 0 ? series[series.length - 1] : null;
                const info = sourceInfo(g.source_id);
                return (
                  <tr key={g.source_id} className="oracleRow">
                    <td className="wrap" title={info?.label}>
                      {g.source_id}
                    </td>
                    <td>{last ? humanizeObservation(g.source_id, last.value) : "—"}</td>
                    <td>{last ? utcShort(last.observed_at) : "—"}</td>
                    <td>
                      <Sparkline values={series.map((o) => o.value)} />
                    </td>
                    <td className="provenance">{last ? last.provenance : "—"}</td>
                    <td className="refetch">
                      {info ? (
                        <a href={info.upstreamUrl} target="_blank" rel="noreferrer">
                          re-fetch upstream yourself ({info.upstreamName})
                        </a>
                      ) : (
                        <span className="muted">unregistered source</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
