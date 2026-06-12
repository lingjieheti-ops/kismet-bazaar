import type { ObservationGroup, SnapshotObservation } from "../lib/types";
import { SOURCE_INFO } from "../lib/constants";
import { tickerSegment, utcClock } from "../lib/format";

function latestOf(group: ObservationGroup): SnapshotObservation | null {
  if (!group.recent || group.recent.length === 0) return null;
  return group.recent.reduce((a, b) => (b.seq >= a.seq ? b : a));
}

export function Ticker({ groups }: { groups: ObservationGroup[] | null }) {
  if (!groups || groups.length === 0) {
    return (
      <div className="ticker">
        <span className="muted">Awaiting the first observations from the oracle desk.</span>
      </div>
    );
  }

  // Keep the floor's canonical ordering: rain, quake, kp, cs2, then strays.
  const order = SOURCE_INFO.map((s) => s.source_id);
  const sorted = [...groups].sort(
    (a, b) =>
      (order.indexOf(a.source_id) + 1 || 99) - (order.indexOf(b.source_id) + 1 || 99),
  );

  const segments: string[] = [];
  let newest = 0;
  for (const g of sorted) {
    const last = latestOf(g);
    if (!last) continue;
    segments.push(tickerSegment(g.source_id, last.value));
    if (last.observed_at > newest) newest = last.observed_at;
  }

  if (segments.length === 0) {
    return (
      <div className="ticker">
        <span className="muted">Sources registered; readings not yet posted.</span>
      </div>
    );
  }

  return (
    <div className="ticker">
      <span>{segments.join(" · ")}</span>
      {newest > 0 ? <span className="tickerNote">as observed at {utcClock(newest)}</span> : null}
    </div>
  );
}
