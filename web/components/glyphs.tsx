// Hand-drawn marks. The bell is the Lutine bell — one strike for a claim
// honoured, two for a book wound up. No emoji on this floor.

export function Bell({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "-0.08em" }}
    >
      <path
        d="M8 1.1c.48 0 .87.39.87.87v.55c2.07.4 3.55 2.17 3.55 4.42 0 2.6.62 3.84 1.33 4.64a.62.62 0 0 1-.46 1.03H2.71a.62.62 0 0 1-.46-1.03c.71-.8 1.33-2.04 1.33-4.64 0-2.25 1.48-4.02 3.55-4.42v-.55c0-.48.39-.87.87-.87z"
        fill="currentColor"
      />
      <path d="M6.35 13.5h3.3a1.65 1.65 0 0 1-3.3 0z" fill="currentColor" />
    </svg>
  );
}

export function WaxSeal() {
  return (
    <div className="seal" aria-hidden="true">
      <span className="sealLetter">K</span>
    </div>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="muted mono">—</span>;
  }
  const w = 120;
  const h = 26;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
      const y = h - pad - ((v - min) * (h - 2 * pad)) / span;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="sectionHead">
      <h2>{title}</h2>
      {note ? <span className="sectionNote">{note}</span> : null}
    </div>
  );
}
