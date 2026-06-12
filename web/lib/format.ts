// Pure, unit-safe formatting. Motes arrive as decimal strings and stay BigInt
// until the last character is printed — Number() never touches a mote.

const MOTES_PER_CSPR = 1_000_000_000n;

export function groupDigits(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "123456789012345" motes -> "123,456.78" CSPR. Bad input prints an em dash. */
export function motesToCspr(motes: string | null | undefined): string {
  if (motes === null || motes === undefined || motes === "") return "—";
  let v: bigint;
  try {
    v = BigInt(motes);
  } catch {
    return "—";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = v / MOTES_PER_CSPR;
  const cents = (v % MOTES_PER_CSPR) / 10_000_000n; // two decimals
  return `${neg ? "−" : ""}${groupDigits(whole.toString())}.${cents.toString().padStart(2, "0")}`;
}

/** Integer percentage of numer/denom computed entirely in BigInt (0..100). */
export function pctOf(numer: string | null | undefined, denom: string | null | undefined): number {
  try {
    const n = BigInt(numer ?? "0");
    const d = BigInt(denom ?? "0");
    if (d <= 0n || n <= 0n) return 0;
    const bps = (n * 10_000n) / d;
    return Math.min(100, Number(bps) / 100);
  } catch {
    return 0;
  }
}

export function bpsToPct(bps: number, decimals = 0): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

/** Timestamps may be seconds or milliseconds; anything past ~2001 in ms wins. */
export function toDate(t: number): Date {
  return new Date(t > 1_000_000_000_000 ? t : t * 1000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "12 Jun 14:05" — ledger-column compact, always UTC. */
export function utcShort(t: number): string {
  const d = toDate(t);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** "14:05 UTC" */
export function utcClock(t: number): string {
  const d = toDate(t);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** "account-hash-abc…f12" with the full string left for the title attribute. */
export function truncateHash(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Humanize a scaled oracle integer for THE ORACLE DESK. */
export function humanizeObservation(source_id: string, value: number): string {
  switch (source_id) {
    case "istanbul-rain-24h":
      return `${(value / 100).toFixed(2)} mm`;
    case "quake-global-1h":
      return value === 0 ? "quiet hour (M 0.00)" : `M ${(value / 100).toFixed(2)}`;
    case "solar-kp":
      return `Kp ${(value / 10).toFixed(1)}`;
    case "cs2-players":
      return `${groupDigits(String(value))} online`;
    default:
      return groupDigits(String(value));
  }
}

/** One ticker segment per source, upper-cased by CSS. */
export function tickerSegment(source_id: string, value: number): string {
  switch (source_id) {
    case "istanbul-rain-24h":
      return `Istanbul rain ${(value / 100).toFixed(2)}mm`;
    case "quake-global-1h":
      return `strongest quake M${(value / 100).toFixed(1)}`;
    case "solar-kp":
      return `Kp ${(value / 10).toFixed(1)}`;
    case "cs2-players":
      return `CS2 ${groupDigits(String(value))} online`;
    default:
      return `${source_id} ${value}`;
  }
}

/** cspr.live link for an odra contract-package address; null when unknown. */
export function contractUrl(
  explorer: string | undefined,
  addr: string | null | undefined,
): string | null {
  if (!addr) return null;
  const base = (explorer ?? "https://testnet.cspr.live").replace(/\/$/, "");
  const hex = addr.replace(/^(contract-package-wasm|contract-package-|contract-|hash-)/, "");
  if (!/^[0-9a-fA-F]{16,}$/.test(hex)) return null;
  return `${base}/contract-package/${hex}`;
}
