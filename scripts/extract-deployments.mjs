#!/usr/bin/env node
// Reads the odra-cli deployed-contracts record and writes the compact
// deployments file the executor, the keeper, and the web ledger read.
//
// Usage: node scripts/extract-deployments.mjs <resources-dir> <out-json>

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [resourcesDir = "contracts/resources", outPath = "deployments/casper-test.json"] =
  process.argv.slice(2);

// odra-cli writes one TOML per deployment batch; take the newest.
const files = readdirSync(resourcesDir)
  .filter((f) => f.endsWith(".toml"))
  .sort();
if (files.length === 0) {
  console.error(`no deployment TOML found in ${resourcesDir}`);
  process.exit(1);
}
const newest = files[files.length - 1];
const body = readFileSync(join(resourcesDir, newest), "utf8");

// Minimal TOML scrape: [[contracts]] entries with name + address fields.
const entries = [...body.matchAll(
  /name\s*=\s*"([^"]+)"[\s\S]*?(?:address|package_hash)\s*=\s*"([^"]+)"/g,
)];
const byName = Object.fromEntries(entries.map(([, name, addr]) => [name, addr]));

const oracle = byName["KismetOracle"];
const bazaar = byName["KismetBazaar"];
const rainTrigger = byName["ThresholdPeril"];
if (!oracle || !bazaar) {
  console.error(`record ${newest} is missing KismetOracle/KismetBazaar:`, byName);
  process.exit(1);
}

writeFileSync(
  outPath,
  JSON.stringify(
    {
      network: "casper-test",
      oracle,
      bazaar,
      genesis_rain_trigger: rainTrigger ?? null,
      explorer: "https://testnet.cspr.live",
      recorded_from: newest,
    },
    null,
    2,
  ) + "\n",
);
console.log(`deployments -> ${outPath}`);
