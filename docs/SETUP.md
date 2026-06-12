# KISMET — operator setup (one-time)

Everything autonomous about KISMET runs in GitHub Actions. To stand the
floor up you do exactly four things; none of them involve handing a private
key to anyone.

## 1. Key ceremony (your machine)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-keys.ps1
```

Six ed25519 keypairs land in `keys/` (gitignored): the admin/oracle key,
one key per syndicate — each underwriter signs its own decisions — and the
patron, the house's own demo buyer.

## 2. Fund the accounts (Casper Testnet faucet)

The script prints each public key with a faucet link:
<https://testnet.cspr.live/tools/faucet>

| Account | Needs | Why |
|---|---|---|
| main | ≥ 1500 CSPR | deploys 3 contracts + 3 extra peril triggers, posts observations |
| sage | ≥ 400 | 220 capital + gas |
| cavalier | ≥ 250 | 120 capital + gas |
| meridian | ≥ 400 | 260 capital + gas |
| atlas | ≥ 300 | 180 capital + gas |
| patron | ≥ 250 | premiums + gas |

If the faucet rations, the Casper hackathon Discord/Telegram hands out
testnet CSPR on request.

## 3. Upload secrets

The script prints the exact commands, of the form:

```
gh secret set CASPER_KEY_MAIN -R lingjieheti-ops/kismet-bazaar < keys/main.pem
```

Optional extras:
- `ANTHROPIC_API_KEY` — underwriter personas get their LLM adjustment
  (bounded ±30%); without it the floor trades on doctrine alone.
- `CSPR_CLOUD_AUTH_TOKEN` — CSPR.cloud access token for the sponsored
  node endpoint, from the hackathon support channel.

## 4. Light the floor

GitHub → Actions:

1. **deploy** → Run workflow. Deploys oracle + genesis trigger + bazaar,
   runs genesis, commits `deployments/casper-test.json`.
2. **keeper** → Run workflow with commands file
   `keeper-state/bootstrap-commands.json`. Registers the three extra data
   sources, forges three more perils, opens the four syndicates, binds the
   Cavalier→Meridian quota-share treaty.
3. Done. The keeper cron takes it from here: observations every cycle,
   repricing, binding, settlement, expiry — and the bell, when it earns it.

## Where the truth lives

- `deployments/casper-test.json` — contract addresses (also on cspr.live)
- `keeper-state/snapshot.json` — full chain state, refreshed every cycle
- `keeper-state/receipts.json` — what the last cycle did
- `keeper-state/reasoning/` — why each underwriter quoted what it quoted
