// Real-world data sources. All key-free, all public, all re-fetchable by
// anyone who wants to check our oracle's homework.
//
// Every reading is clamped to per-source sane bounds before it goes near
// the chain: a glitched upstream should produce a boring observation, not
// a phantom catastrophe.

import { fetchJson } from "../lib/http.js";

export interface Reading {
  value: number;
  provenance: string;
}

export interface DataSource {
  id: string;
  description: string;
  upstreamUrl: string;
  scaleNote: string;
  bounds: [number, number];
  fetchReading(): Promise<Reading>;
}

export function clamp(value: number, [lo, hi]: [number, number]): number {
  return Math.max(lo, Math.min(hi, value));
}

// --- Istanbul rainfall (Open-Meteo, 24h accumulated, mm x100) --------------

interface OpenMeteoHourly {
  hourly: { time: string[]; precipitation: (number | null)[] };
}

const ISTANBUL_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.95&hourly=precipitation&past_days=1&forecast_days=1&timezone=UTC";

export const istanbulRain: DataSource = {
  id: "istanbul-rain-24h",
  description: "Istanbul 24h accumulated rainfall, mm x100",
  upstreamUrl: ISTANBUL_URL,
  scaleNote: "mm x100",
  bounds: [0, 50_000], // 500mm/24h is beyond any recorded Istanbul storm
  async fetchReading() {
    const data = await fetchJson<OpenMeteoHourly>(ISTANBUL_URL);
    const nowIso = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const idx = data.hourly.time.findIndex((t) => t.startsWith(nowIso));
    const upto = idx >= 0 ? idx + 1 : data.hourly.time.length;
    const from = Math.max(0, upto - 24);
    let sum = 0;
    for (let i = from; i < upto; i++) sum += data.hourly.precipitation[i] ?? 0;
    return {
      value: clamp(Math.round(sum * 100), istanbulRain.bounds),
      provenance: `open-meteo:hourly.precipitation:sum24h@${nowIso}Z`,
    };
  },
};

// --- Global earthquakes (USGS, max magnitude last hour, M x100) ------------

interface UsgsFeed {
  features: { properties: { mag: number | null; code: string } }[];
}

const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";

export const quakeGlobal: DataSource = {
  id: "quake-global-1h",
  description: "Strongest earthquake worldwide in the past hour, magnitude x100",
  upstreamUrl: USGS_URL,
  scaleNote: "magnitude x100; 0 = quiet hour",
  bounds: [0, 1_000],
  async fetchReading() {
    const data = await fetchJson<UsgsFeed>(USGS_URL);
    let max = 0;
    let code = "none";
    for (const f of data.features) {
      const mag = f.properties.mag ?? 0;
      if (mag > max) {
        max = mag;
        code = f.properties.code;
      }
    }
    return {
      value: clamp(Math.round(max * 100), quakeGlobal.bounds),
      provenance: `usgs:all_hour:max_mag:${code}`,
    };
  },
};

// --- Solar storms (NOAA SWPC planetary K-index, Kp x10) --------------------

type NoaaKpRow = { time_tag: string; kp_index: number };

const NOAA_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";

export const solarKp: DataSource = {
  id: "solar-kp",
  description: "Planetary K-index (geomagnetic storm scale), Kp x10",
  upstreamUrl: NOAA_URL,
  scaleNote: "Kp x10",
  bounds: [0, 90],
  async fetchReading() {
    const rows = await fetchJson<NoaaKpRow[]>(NOAA_URL);
    const last = rows[rows.length - 1];
    if (!last) throw new Error("NOAA returned empty Kp series");
    return {
      value: clamp(Math.round(last.kp_index * 10), solarKp.bounds),
      provenance: `noaa-swpc:planetary_k_index_1m@${last.time_tag}`,
    };
  },
};

// --- CS2 concurrent players (Steam, x1) ------------------------------------

interface SteamPlayers {
  response: { player_count?: number; result: number };
}

const STEAM_URL =
  "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=730";

export const cs2Players: DataSource = {
  id: "cs2-players",
  description: "Counter-Strike 2 concurrent players on Steam",
  upstreamUrl: STEAM_URL,
  scaleNote: "players x1",
  bounds: [0, 5_000_000],
  async fetchReading() {
    const data = await fetchJson<SteamPlayers>(STEAM_URL);
    const count = data.response.player_count;
    if (count === undefined) throw new Error("Steam returned no player_count");
    return {
      value: clamp(count, cs2Players.bounds),
      provenance: `steam:GetNumberOfCurrentPlayers:appid=730`,
    };
  },
};

export const ALL_SOURCES: DataSource[] = [istanbulRain, quakeGlobal, solarKp, cs2Players];
