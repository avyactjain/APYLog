import type { Client } from "@jup-ag/lend-read";
import { stakingYieldFor, type PositionRef, type TokenYield } from "./config.js";
import { tradingApr } from "./fluid.js";
import { toJsonSafe } from "./json.js";
import { amountUsd, usdPrices, type TokenPrice } from "./prices.js";

/** Chain integers use this scale: 100 = 1%, so 625 = 6.25%. */
const RATE_SCALE = 10_000;
/** DEX “token per share” numbers use this scale: 1e12 = 1×. */
const SHARE_SCALE = 1_000_000_000_000n;
/** Daily compounding, same as the Jupiter UI. */
const DAYS_PER_YEAR = 365;
/** Used only for the 2% shortfall dollar amount. */
const SECONDS_PER_YEAR = 31_536_000;
export const GUARANTEE = 0.02;
/** Usual extra zeros between vault debt units and JupUSD units. */
const DEFAULT_BORROW_SCALE = 1000n;

type ChainInt = { toString(): string };
type NftPosition = Awaited<ReturnType<Client["vault"]["getPositionByVaultIdV2"]>>;
type SupplyDex = NonNullable<NftPosition["vault"]["supplyDex"]>;

export type PositionSnapshot = {
  vaultId: number;
  nftId: number;
  supplied: number;
  borrowed: number;
  equity: number;
  supplyApy: number;
  borrowApy: number;
  netApy: number;
  shortfall: number;
  isLiquidated: boolean;
  token0Usd: number;
  token1Usd: number;
  token0Apy: number;
  token1Apy: number;
  tradingApy: number;
  rawPosition: unknown;
};

// --- numbers ---

/** SDK big numbers as bigint. */
function asInt(value: ChainInt): bigint {
  return BigInt(value.toString());
}

/** DEX shares → raw token amount. */
function fromShares(shares: bigint, perShare: bigint): bigint {
  return (shares * perShare) / SHARE_SCALE;
}

/** Fail if Jupiter did not return a USD price for this mint. */
function requirePrice(prices: Map<string, TokenPrice>, mint: string): TokenPrice {
  const price = prices.get(mint);
  if (!price) {
    throw new Error(`No USD price for ${mint}`);
  }
  return price;
}

/**
 * Vault debt is written with extra zeros. Divide the two vault-wide totals
 * to learn how many (usually 1000). Then NFT borrow / that = real JupUSD.
 */
function borrowLiquidityScale(vaultBorrow: bigint, liquidityBorrow: bigint): bigint {
  if (liquidityBorrow === 0n || vaultBorrow === 0n) {
    return DEFAULT_BORROW_SCALE;
  }
  const scale = vaultBorrow / liquidityBorrow;
  return scale === 0n ? DEFAULT_BORROW_SCALE : scale;
}

// --- rates ---

/** Chain rate integer → yearly rate. 625 → 0.0625. */
function rateToApr(rate: ChainInt): number {
  return Number(asInt(rate)) / RATE_SCALE;
}

/** Yearly rate → APY, compounding once a day. */
function aprToApy(apr: number): number {
  if (apr === 0) {
    return 0;
  }
  return (1 + apr / DAYS_PER_YEAR) ** DAYS_PER_YEAR - 1;
}

/** Extra yield from config (PST 800 → 0.08). Already APY, do not compound again. */
function stakingApy(tokenYields: TokenYield[], tokenAddress: string): number {
  return stakingYieldFor(tokenYields, tokenAddress) / RATE_SCALE;
}

/** One token’s supply APY: Fluid lending APY + config extra yield. */
function tokenSupplyApy(fluidRate: ChainInt, tokenAddress: string, tokenYields: TokenYield[]): number {
  return aprToApy(rateToApr(fluidRate)) + stakingApy(tokenYields, tokenAddress);
}

/** Mix APYs by dollar size. Bigger pile counts more. */
function weightedApy(parts: Array<{ usd: number; apy: number }>): number {
  let usd = 0;
  let earned = 0;
  for (const part of parts) {
    usd += part.usd;
    earned += part.usd * part.apy;
  }
  if (usd === 0) {
    return 0;
  }
  return earned / usd;
}

// --- snapshot ---

/** Only smart-collateral borrow positions. Collateral is a DEX pair; debt is a single token. */
function requireSmartColBorrow(position: NftPosition): SupplyDex {
  const { vault } = position;
  if (!vault.isSmartCol || vault.supplyDex === null) {
    throw new Error(`vault ${String(vault.vaultId)} is not smart collateral`);
  }
  if (vault.isSmartDebt) {
    throw new Error(`vault ${String(vault.vaultId)} has smart debt; only smart collateral is supported`);
  }
  if (position.isSupplyPosition) {
    throw new Error(`vault ${String(vault.vaultId)}, NFT ${String(position.nftId)} has no debt`);
  }
  return vault.supplyDex;
}

/**
 * One live reading of a smart-collateral borrow position:
 * dollars, APYs, Net APY, and 2% shortfall.
 */
export async function snapshotPosition(
  client: Client,
  ref: PositionRef,
  tokenYields: TokenYield[],
  intervalSeconds: number,
): Promise<PositionSnapshot> {
  const [position, trading] = await Promise.all([
    client.vault.getPositionByVaultIdV2(ref.vaultId, ref.nftId),
    tradingApr(ref.vaultId),
  ]);
  const dex = requireSmartColBorrow(position);
  const { vault } = position;
  const borrowApy = aprToApy(rateToApr(vault.exchangePricesAndRates.borrowRateVault));
  const tradingApy = aprToApy(trading);

  const token0 = dex.token0.toBase58();
  const token1 = dex.token1.toBase58();
  const borrowMint = vault.constantViews.borrowToken.toBase58();
  const prices = await usdPrices([token0, token1, borrowMint]);
  const shares = asInt(position.supply);

  const token0Usd = amountUsd(fromShares(shares, asInt(dex.dexState.token0PerSupplyShare)), requirePrice(prices, token0));
  const token1Usd = amountUsd(fromShares(shares, asInt(dex.dexState.token1PerSupplyShare)), requirePrice(prices, token1));
  const token0Apy = tokenSupplyApy(dex.limitsAndAvailability.liquidityTokenData0.supplyRate, token0, tokenYields);
  const token1Apy = tokenSupplyApy(dex.limitsAndAvailability.liquidityTokenData1.supplyRate, token1, tokenYields);
  const supplied = token0Usd + token1Usd;
  const supplyApy = weightedApy([
    { usd: token0Usd, apy: token0Apy },
    { usd: token1Usd, apy: token1Apy },
  ]) + tradingApy;

  const scale = borrowLiquidityScale(
    asInt(vault.totalSupplyAndBorrow.totalBorrowVault),
    asInt(vault.totalSupplyAndBorrow.totalBorrowLiquidityOrDex),
  );

  const borrowed = amountUsd(asInt(position.borrow) / scale, requirePrice(prices, borrowMint));

  return finishSnapshot(
    position,
    supplied,
    borrowed,
    supplyApy,
    borrowApy,
    intervalSeconds,
    token0Usd,
    token1Usd,
    token0Apy,
    token1Apy,
    tradingApy,
    toJsonSafe(position),
  );
}

/** Equity, Net APY, and shortfall vs 2%. */
function finishSnapshot(
  position: NftPosition,
  supplied: number,
  borrowed: number,
  supplyApy: number,
  borrowApy: number,
  intervalSeconds: number,
  token0Usd: number,
  token1Usd: number,
  token0Apy: number,
  token1Apy: number,
  tradingApy: number,
  rawPosition: unknown,
): PositionSnapshot {
  const equity = supplied - borrowed;
  const netApy = equity === 0 ? 0 : (supplied * supplyApy - borrowed * borrowApy) / equity;
  const shortfall =
    netApy >= GUARANTEE ? 0 : (GUARANTEE - netApy) * equity * (intervalSeconds / SECONDS_PER_YEAR);

  return {
    vaultId: position.vault.vaultId,
    nftId: position.nftId,
    supplied,
    borrowed,
    equity,
    supplyApy,
    borrowApy,
    netApy,
    shortfall,
    isLiquidated: position.isLiquidated,
    token0Usd,
    token1Usd,
    token0Apy,
    token1Apy,
    tradingApy,
    rawPosition,
  };
}
