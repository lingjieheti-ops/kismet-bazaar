import type { Deployments } from "../lib/types";
import { GITHUB_URL, KEEPER_WORKFLOW_URL } from "../lib/constants";
import { contractUrl } from "../lib/format";
import { SectionHead } from "./glyphs";

export function X402Desk() {
  return (
    <section className="section">
      <SectionHead title="THE X402 DESK" note="desk opens during the buildathon" />
      <p className="deskProse">
        Quotes and signed oracle feeds will be sold per-request over x402 — the agent-native
        payment rail on Casper. No subscriptions, no keys exchanged in back rooms; an agent pays
        for a price and receives a price. The desk opens during the buildathon.
      </p>
    </section>
  );
}

export function VerifyEverything({ deployments }: { deployments: Deployments | null }) {
  const oracleUrl = contractUrl(deployments?.explorer, deployments?.oracle);
  const bazaarUrl = contractUrl(deployments?.explorer, deployments?.bazaar);

  return (
    <section className="section">
      <SectionHead title="VERIFY EVERYTHING" note="trust is for counterparties" />
      <ol className="verifyList">
        <li>
          <span className="verifyBody">
            The contracts live on Casper Testnet.{" "}
            {oracleUrl && bazaarUrl ? (
              <span className="mono">
                <a href={oracleUrl} target="_blank" rel="noreferrer">
                  KismetOracle
                </a>
                {" · "}
                <a href={bazaarUrl} target="_blank" rel="noreferrer">
                  KismetBazaar
                </a>
                {" on cspr.live"}
              </span>
            ) : (
              <span className="muted">
                Addresses are entered here the moment the charter deploy lands.
              </span>
            )}
          </span>
        </li>
        <li>
          <span className="verifyBody">
            The keeper runs in public, on a schedule, with its logs open:{" "}
            <a className="mono" href={KEEPER_WORKFLOW_URL} target="_blank" rel="noreferrer">
              keeper.yml on GitHub Actions
            </a>
            .
          </span>
        </li>
        <li>
          <span className="verifyBody">
            Run the twenty-second keyless demo on your own machine:{" "}
            <code>cd agents &amp;&amp; npm install &amp;&amp; npm run demo</code>
          </span>
        </li>
        <li>
          <span className="verifyBody">
            Every observation carries a provenance tag naming the public API it came from.
            Re-fetch the upstream yourself and compare; the oracle keeps no secrets worth keeping.
          </span>
        </li>
      </ol>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <span>
        MIT · built for the{" "}
        <a href="https://dorahacks.io/hackathon/casper-agentic-buildathon" target="_blank" rel="noreferrer">
          Casper Agentic Buildathon 2026
        </a>
      </span>
      <span>no humans were consulted in the pricing of these risks</span>
      <span>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          source
        </a>
      </span>
    </footer>
  );
}
