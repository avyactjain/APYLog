# APYLog

Snapshots PST smart-vault positions and tracks Net APY against a 2% guarantee.

Only **smart collateral borrow** positions (a token pair as collateral, a single token as debt).

## Setup

```bash
npm install
npm run build
npm start
```

Edit `config.json` for the RPC URL, snapshot interval, vault / NFT ids, and extra token yield (PST’s 8%).

## Sample dump

[`docs/getPositionByVaultIdV2-vault93-nft8.json`](docs/getPositionByVaultIdV2-vault93-nft8.json) is a live `getPositionByVaultIdV2(93, 8)` result.

A live print may show `[Circular]`. That is the same number printed twice. The saved file fills those in.

Rates from the SDK are integers: **100 = 1%**, so divide by 10 000 for a 0.05-style yearly rate, then compound daily to APY. DEX “token per share” uses **1e12 = 1×**.

Not in this dump: USD prices (Jupiter price API), PST’s 8% (`config.json`), trading yield (Fluid vault feed).

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
- If Net APY &lt; 2%: **shortfall** = `(2% − Net APY) × equity × (intervalMinutes / 525600)`.
