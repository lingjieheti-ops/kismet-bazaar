"use client";

// The trading floor's only client: fetch the snapshot the keeper publishes,
// poll it on the minute, and never invent a number it did not contain.

import { useEffect, useState } from "react";
import type { Deployments, Snapshot } from "../lib/types";
import { DEPLOYMENTS_URL, SNAPSHOT_URL } from "../lib/constants";
import { contractUrl } from "../lib/format";
import { Masthead } from "./Masthead";
import { Ticker } from "./Ticker";
import { CharterRoster, Syndicates } from "./Syndicates";
import { PolicyLedger } from "./PolicyLedger";
import { OracleDesk } from "./OracleDesk";
import { BellEvents } from "./BellEvents";
import { Footer, VerifyEverything, X402Desk } from "./Desks";

const POLL_MS = 60_000;

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null; // 404 until the first deploy — by design
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function looksLikeSnapshot(x: unknown): x is Snapshot {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    Array.isArray(s.syndicates) &&
    Array.isArray(s.perils) &&
    Array.isArray(s.policies) &&
    Array.isArray(s.observations)
  );
}

function looksLikeDeployments(x: unknown): x is Deployments {
  return typeof x === "object" && x !== null;
}

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      const [snap, dep] = await Promise.all([
        fetchJsonOrNull<unknown>(SNAPSHOT_URL),
        fetchJsonOrNull<unknown>(DEPLOYMENTS_URL),
      ]);
      if (!alive) return;
      if (looksLikeSnapshot(snap)) setSnapshot(snap);
      if (looksLikeDeployments(dep)) setDeployments(dep);
      setChecked(true);
    }

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const live = snapshot !== null;
  const bazaarUrl = contractUrl(deployments?.explorer, deployments?.bazaar ?? snapshot?.bazaar);

  return (
    <div className="page">
      <Masthead bazaarUrl={bazaarUrl} />
      <Ticker groups={snapshot?.observations ?? null} />

      {live ? (
        <>
          <Syndicates syndicates={snapshot.syndicates} />
          <PolicyLedger policies={snapshot.policies} syndicates={snapshot.syndicates} />
          <OracleDesk groups={snapshot.observations} />
          <BellEvents policies={snapshot.policies} syndicates={snapshot.syndicates} />
        </>
      ) : (
        <>
          <div className="prelaunch">
            <h2>THE FLOOR OPENS SOON</h2>
            <p>
              The ink is drying. {checked
                ? "Contracts are being drawn on Casper Testnet; the names below have filed their charters and wait to be capitalised."
                : "Calling the ledger from the keeper's records."}
            </p>
          </div>
          <CharterRoster />
          <section className="section">
            <div className="sectionHead">
              <h2>THE POLICY LEDGER</h2>
            </div>
            <p className="emptyLine">
              No cover has been bound. The first policy will be entered here in ink.
            </p>
          </section>
          <section className="section">
            <div className="sectionHead">
              <h2>THE ORACLE DESK</h2>
            </div>
            <p className="emptyLine">The desk is quiet. Sources are being registered.</p>
          </section>
          <section className="section">
            <div className="sectionHead">
              <h2>BELL EVENTS</h2>
            </div>
            <p className="emptyLine">The bell has not rung yet. Give the weather time.</p>
          </section>
        </>
      )}

      <X402Desk />
      <VerifyEverything deployments={deployments} />
      <Footer />
    </div>
  );
}
