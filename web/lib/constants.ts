// Hand-copied working knowledge from agents/src — peril labels, the syndicate
// roster as chartered, and the four public upstream APIs anyone can re-fetch.
// The chain is the source of truth for numbers; this file only carries names.

export const SNAPSHOT_URL =
  "https://raw.githubusercontent.com/lingjieheti-ops/kismet-bazaar/main/keeper-state/snapshot.json";

export const DEPLOYMENTS_URL =
  "https://raw.githubusercontent.com/lingjieheti-ops/kismet-bazaar/main/deployments/casper-test.json";

export const GITHUB_URL = "https://github.com/lingjieheti-ops/kismet-bazaar";

export const KEEPER_WORKFLOW_URL =
  "https://github.com/lingjieheti-ops/kismet-bazaar/actions/workflows/keeper.yml";

export const DEFAULT_EXPLORER = "https://testnet.cspr.live";

// --- Perils (agents/src/keeper/registry.ts) --------------------------------

export interface PerilInfo {
  peril_id: number;
  source_id: string;
  label: string;
  short: string;
}

export const PERIL_INFO: PerilInfo[] = [
  {
    peril_id: 0,
    source_id: "istanbul-rain-24h",
    label: "Istanbul 24h rain ≥ 12.50mm",
    short: "Istanbul rain",
  },
  {
    peril_id: 1,
    source_id: "quake-global-1h",
    label: "Earthquake M ≥ 5.5 worldwide (hourly window)",
    short: "Quake M5.5",
  },
  {
    peril_id: 2,
    source_id: "solar-kp",
    label: "Geomagnetic storm Kp ≥ 5.0",
    short: "Solar Kp5.0",
  },
  {
    peril_id: 3,
    source_id: "quake-global-1h",
    label: "Earthquake M ≥ 4.5 worldwide (demo calibration peril)",
    short: "Quake M4.5",
  },
];

export function perilLabel(peril_id: number): string {
  return PERIL_INFO.find((p) => p.peril_id === peril_id)?.label ?? `Peril #${peril_id}`;
}

export function perilShort(peril_id: number): string {
  return PERIL_INFO.find((p) => p.peril_id === peril_id)?.short ?? `Peril #${peril_id}`;
}

// --- Oracle sources (agents/src/sources/index.ts) ---------------------------

export interface SourceInfo {
  source_id: string;
  label: string;
  scaleNote: string;
  upstreamUrl: string;
  upstreamName: string;
}

export const SOURCE_INFO: SourceInfo[] = [
  {
    source_id: "istanbul-rain-24h",
    label: "Istanbul 24h accumulated rainfall",
    scaleNote: "mm ×100",
    upstreamUrl:
      "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.95&hourly=precipitation&past_days=1&forecast_days=1&timezone=UTC",
    upstreamName: "Open-Meteo",
  },
  {
    source_id: "quake-global-1h",
    label: "Strongest earthquake worldwide, past hour",
    scaleNote: "magnitude ×100",
    upstreamUrl:
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
    upstreamName: "USGS",
  },
  {
    source_id: "solar-kp",
    label: "Planetary K-index (geomagnetic storms)",
    scaleNote: "Kp ×10",
    upstreamUrl: "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
    upstreamName: "NOAA SWPC",
  },
  {
    source_id: "cs2-players",
    label: "Counter-Strike 2 concurrent players",
    scaleNote: "players ×1",
    upstreamUrl:
      "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=730",
    upstreamName: "Steam",
  },
];

export function sourceInfo(source_id: string): SourceInfo | undefined {
  return SOURCE_INFO.find((s) => s.source_id === source_id);
}

// --- The roster as chartered (agents/src/pricing/personas.ts) ---------------
// Shown verbatim in the pre-launch state. Once the snapshot lands, the
// chain's own figures replace everything here except the prose.

export interface CharterPersona {
  name: string;
  motto: string;
  reserve_bps: number;
  doctrine: string;
  charter_pledge_cspr: number;
}

export const CHARTER_ROSTER: CharterPersona[] = [
  {
    name: "Sage Mutual",
    motto: "We have seen storms before.",
    reserve_bps: 10_000,
    doctrine:
      "Old money. Prices tail risk first, walks away from anything it cannot fully reserve. Would rather earn nothing than owe anything.",
    charter_pledge_cspr: 220,
  },
  {
    name: "Cavalier Syndicate",
    motto: "Risk is just yield wearing a mask.",
    reserve_bps: 3_000,
    doctrine:
      "Writes cheap, reserves thin, wins volume. Believes diversification will save it. History disagrees.",
    charter_pledge_cspr: 120,
  },
  {
    name: "Meridian Re",
    motto: "Everyone needs a backstop.",
    reserve_bps: 10_000,
    doctrine:
      "Reinsurance house. Quotes direct cover rarely and dearly; its real book is quota-share treaties with the floor's gamblers.",
    charter_pledge_cspr: 260,
  },
  {
    name: "Atlas Parametric",
    motto: "The model is the message.",
    reserve_bps: 8_000,
    doctrine:
      "Quant shop. Prices close to the observed frequency with a modest margin and publishes its confidence interval.",
    charter_pledge_cspr: 180,
  },
];
