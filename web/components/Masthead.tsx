import { GITHUB_URL } from "../lib/constants";
import { WaxSeal } from "./glyphs";

export function Masthead({ bazaarUrl }: { bazaarUrl: string | null }) {
  return (
    <header>
      <div className="masthead">
        <div className="mastLeft">
          <WaxSeal />
          <div className="mastTitleBlock">
            <h1>KISMET</h1>
            <p className="tagline">The parametric insurance bazaar, underwritten by machines.</p>
            <p className="subline">
              Real rain pays real claims on Casper Testnet. Priced too bravely? The bell rings
              twice.
            </p>
          </div>
        </div>
        <nav className="mastLinks">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub repository
          </a>
          {bazaarUrl ? (
            <a href={bazaarUrl} target="_blank" rel="noreferrer">
              Verify on cspr.live
            </a>
          ) : (
            <span className="muted" title="The bazaar contract address appears here once the charter deploy lands.">
              Verify on cspr.live — charter pending
            </span>
          )}
        </nav>
      </div>
      <hr className="mastRule" />
    </header>
  );
}
