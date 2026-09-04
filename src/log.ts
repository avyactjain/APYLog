import { createConsola } from "consola";
import { readOutputSummary, type PositionSummary } from "./csv.js";
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
  log.log(`  PST USD: ${cyan(formatUsd(snap.token0Usd))}`);
  log.log(`  USDC USD: ${cyan(formatUsd(snap.token1Usd))}`);
  log.log(`  borrowed: ${cyan(formatUsd(snap.borrowed))}`);
  log.log(`  equity: ${cyan(formatUsd(snap.equity))}`);
  log.log(`  supply APY: ${formatPct(snap.supplyApy)}`);
  log.log(`  borrow APY: ${formatPct(snap.borrowApy)}`);
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
  return [
    bold(`vault ${String(row.vaultId)}, NFT ${String(row.nftId)}`),
    `  snapshots: ${String(row.snapshots)}`,
    `  first: ${dim(row.firstAt)}`,
    `  last: ${dim(row.lastAt)}`,
    `  last net APY: ${netApyText(row.lastNetApy)}`,
    `  under 2%: ${String(row.below2pct)}`,
    `  charge: ${bold(row.chargeToDate.toFixed(6))}`,
  ];
}

/** Print a short wrap-up of output.csv. */
export function printOutputSummary(): void {
  const summary = readOutputSummary();
  if (summary.snapshots === 0) {
    log.box("No snapshots in output.csv");
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
