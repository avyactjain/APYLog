# APYLog

Snapshots PST smart-vault positions and tracks Net APY against a 2% guarantee.

Only **smart collateral borrow** positions (a token pair as collateral, a single token as debt).

## Setup

```bash
npm install
npm run build
npm start
```

Config is layered, last file wins: `config/default.json` → `config/staging.json` or `config/prod.json` → `config/local.json`.

Copy `config/local.json.example` to `config/local.json` and put your RPC URL there. `local.json` is not committed.

If `rpcUrl` is still empty after those files, the `RPC_URL` env var is used (for deploy). Same for `dbUrl` and `DB_URL`.

`APP_ENV` or `NODE_ENV`: `staging` or `prod` (`production` means `prod`). Unset means default + local only.

`npm start` runs the compiled app (run `npm run build` first). It snapshots on the interval and serves a summary page on `PORT` (default `3000`). Open `http://localhost:3000`.

If `DB_URL` (or `dbUrl` in config) is set, snapshots go to Postgres only. If it is empty, snapshots go to `output.csv` only. Prod snapshots every hour (`config/prod.json`).

The page charts supply rate and borrow rate. Hover a point to see the spread (supply − borrow). Use **1d / 1w / 1m / 1y** to load that window only.

## Deploy

This must stay running (snapshot timer + web UI). On the Oracle VM, run Postgres and the app with Compose. Postgres listens on the VM loopback only (`127.0.0.1:5432`). Do not open 5432 on the public internet.

Create a `.env` next to `docker-compose.yml` (do not commit it):

```
RPC_URL=https://your-rpc
POSTGRES_PASSWORD=pick-a-secret
```

```bash
docker compose up -d
```

App: `http://YOUR_PUBLIC_IP:3000`. Inside Compose the app uses `DB_URL=postgresql://apylog:PASSWORD@postgres:5432/apylog`.

CSV-only (no database):

```bash
docker build -t apylog .
docker run --rm -p 3000:3000 -e RPC_URL="https://your-rpc" -e APP_ENV=prod -e PORT=3000 apylog
```

### Open Postgres from your laptop

Keep 5432 closed on the VM. Tunnel it:

```bash
ssh -L 5432:127.0.0.1:5432 ubuntu@YOUR_PUBLIC_IP
```

Then in DBeaver, TablePlus, or `psql`, connect to `localhost:5432`:

- database: `apylog`
- user: `apylog`
- password: the same `POSTGRES_PASSWORD`

```bash
psql "postgresql://apylog:PASSWORD@127.0.0.1:5432/apylog"
```

## Output

One snapshot:

![One snapshot of vault 93, NFT 8](docs/screenshots/snapshot.png)

Ctrl+C prints a short summary of `output.csv`:

![Ctrl+C summary of output.csv](docs/screenshots/summary.png)

## Charge

Net APY under 2% for one interval:

`shortfall = (2% − Net APY) × equity × (intervalSeconds / 31536000)`

If Net APY is at least 2%, that row’s shortfall is `0`. **Charge the other team the sum of `shortfall`.** `chargeToDate` on the latest row is that running total for that vault + NFT.

## Sample dump

[`docs/getPositionByVaultIdV2-vault93-nft8.json`](docs/getPositionByVaultIdV2-vault93-nft8.json) is a live `getPositionByVaultIdV2(93, 8)` result.

A live print may show `[Circular]`. That is the same number printed twice. The saved file fills those in.

Rates from the SDK are integers: **100 = 1%**, so divide by 10 000 for a 0.05-style yearly rate, then compound daily to APY. DEX “token per share” uses **1e12 = 1×**.

Not in this dump: USD prices (Jupiter price API), PST’s 8% (`config/default.json`), trading yield (Fluid vault feed).

### Fields we use

| Field | Meaning | What we do |
| --- | --- | --- |
| `nftId` | This position. `8`. | Store and print. |
| `isSupplyPosition` | `false` = this NFT has debt. | Reject if `true`. |
| `isLiquidated` | `false` = still open. | Print if `true`. |
| `supply` | This NFT’s collateral as DEX **shares**, not PST or USDC. | `shares × tokenPerShare / 1e12` → PST and USDC amounts → USD. |
| `borrow` | This NFT’s debt in **vault units** (extra zeros). | Divide by the scale below, then × JupUSD price → borrowed USD. |
| `vault.vaultId` | Vault `93`. | Store and print. |
| `vault.isSmartCol` | Collateral is a DEX pair. | Must be `true`. |
| `vault.isSmartDebt` | Debt is a pair. Here `false` (plain JupUSD). | Reject if `true`. |
| `vault.supplyDex` | The collateral pool. | Must exist. |
| `vault.constantViews.borrowToken` | JupUSD mint. | Look up JupUSD’s USD price. |
| `vault.exchangePricesAndRates.borrowRateVault` | JupUSD borrow yearly rate (SDK integer). | ÷ 10 000, then daily compound → borrow APY. |
| `vault.totalSupplyAndBorrow.totalBorrowVault` | All NFTs’ debt in vault units. | Numerator of the extra-zeros scale. |
| `vault.totalSupplyAndBorrow.totalBorrowLiquidityOrDex` | Same debt in real JupUSD raw units. | Denominator. `vault / liquidity` ≈ 1000. Then `borrow / 1000`. |
| `supplyDex.token0` | PST mint. | USD price, and match `config.tokenYields` for the 8%. |
| `supplyDex.token1` | USDC mint. | USD price. |
| `supplyDex.dexState.token0PerSupplyShare` | How much PST one share is worth (before decimals). | With `supply`, get this NFT’s PST amount. |
| `supplyDex.dexState.token1PerSupplyShare` | How much USDC one share is worth. | With `supply`, get this NFT’s USDC amount. |
| `supplyDex.limitsAndAvailability.liquidityTokenData0.supplyRate` | Fluid lending yearly rate on PST. Here `0`. | ÷ 10 000, compound, add PST’s 8% from config. |
| `supplyDex.limitsAndAvailability.liquidityTokenData1.supplyRate` | Fluid lending yearly rate on USDC. | ÷ 10 000, compound → USDC supply APY. |

### After that

- **Supplied USD** = PST USD + USDC USD.
- **Supply APY** = those two APYs mixed by dollar size, plus trading APY from Fluid.
- **Net APY** = `(supplied × supply APY − borrowed × borrow APY) / (supplied − borrowed)`.
