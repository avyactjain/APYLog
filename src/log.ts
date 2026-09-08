import { createConsola } from "consola";
import type { OutputSummary, PositionSummary } from "./csv.js";
import { GUARANTEE, type PositionSnapshot } from "./snapshot.js";

export const log = createConsola({
  fancy: true,
  formatOptions: { date: true, colors: true },
});

function paint(code: string, text: string): string {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `\x1b[${code}m${text}\x1b[0m`;
}

function bold(text: string): string {
  return paint("1", text);
}

function dim(text: string): string {
  return paint("2", text);
}

function green(text: string): string {
  return paint("32", text);
}

function yellow(text: string): string {
  return paint("33", text);
}

function cyan(text: string): string {
  return paint("36", text);
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function netApyText(value: number): string {
  const text = formatPct(value);
  return value >= GUARANTEE ? green(text) : yellow(text);
}

/** Print one snapshot. */
export function printSnapshot(snap: PositionSnapshot, chargeToDate: number, dma7: number): void {
  log.info(bold(`vault ${String(snap.vaultId)}, NFT ${String(snap.nftId)}`));
  log.log(`  supplied: ${cyan(formatUsd(snap.supplied))}`);
  log.log(`  PST USD: ${cyan(formatUsd(snap.token0Usd))}  APY: ${formatPct(snap.token0Apy)}`);
  log.log(`  USDC USD: ${cyan(formatUsd(snap.token1Usd))}  APY: ${formatPct(snap.token1Apy)}`);
  log.log(`  trading APY: ${formatPct(snap.tradingApy)}`);
  log.log(`  supply APY (blend + trading): ${formatPct(snap.supplyApy)}`);
  log.log(`  borrowed (JupUSD): ${cyan(formatUsd(snap.borrowed))}  APY: ${formatPct(snap.borrowApy)}`);
  log.log(`  equity: ${cyan(formatUsd(snap.equity))}`);
  log.log(`  net APY: ${netApyText(snap.netApy)}`);
  log.log(`  7-day mean: ${formatPct(dma7)}`);
  if (snap.netApy < GUARANTEE) {
    log.warn(`  shortfall: ${snap.shortfall.toFixed(6)}`);
  }
  log.log(`  charge to date: ${bold(chargeToDate.toFixed(6))}`);
  if (snap.isLiquidated) {
    log.warn("  liquidated: true");
  }
}

function positionLines(row: PositionSummary): string[] {
  const last = row.lastSnapshot;
  return [
    bold(`vault ${String(row.vaultId)}, NFT ${String(row.nftId)}`),
    `  snapshots: ${String(row.snapshots)}`,
    `  first: ${dim(row.firstAt)}`,
    `  last: ${dim(row.lastAt)}`,
    `  PST USD: ${formatUsd(last.token0Usd)}  APY: ${formatPct(last.token0Apy)}`,
    `  USDC USD: ${formatUsd(last.token1Usd)}  APY: ${formatPct(last.token1Apy)}`,
    `  trading APY: ${formatPct(last.tradingApy)}`,
    `  supply APY: ${formatPct(last.supplyApy)}`,
    `  borrowed: ${formatUsd(last.borrowed)}  APY: ${formatPct(last.borrowApy)}`,
    `  equity: ${formatUsd(last.equity)}`,
    `  last net APY: ${netApyText(row.lastNetApy)}`,
    `  under 2%: ${String(row.below2pct)}`,
    `  charge: ${bold(row.chargeToDate.toFixed(6))}`,
  ];
}

/** Print a short wrap-up of stored snapshots. */
export function printOutputSummary(summary: OutputSummary): void {
  if (summary.snapshots === 0) {
    log.box("No snapshots stored");
    return;
  }

  const totalCharge = summary.positions.reduce((sum, row) => sum + row.chargeToDate, 0);
  const lines = [`${String(summary.snapshots)} snapshots`, ""];
  for (const row of summary.positions) {
    lines.push(...positionLines(row), "");
  }
  lines.push(`Total charge: ${bold(totalCharge.toFixed(6))}`);
  log.box(lines.join("\n"));
}
