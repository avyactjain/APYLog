import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUARANTEE, type PositionSnapshot } from "./snapshot.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const HEADER = [
  "timestamp",
  "intervalSeconds",
  "vaultId",
  "nftId",
  "supplied",
  "borrowed",
  "equity",
  "token0Usd",
  "token1Usd",
  "supplyApy",
  "borrowApy",
  "netApy",
  "dma7",
  "below2pct",
  "shortfall",
  "chargeToDate",
  "isLiquidated",
].join(",");

type PastRow = {
  timestampMs: number;
  vaultId: number;
  nftId: number;
  netApy: number;
  shortfall: number;
};

export type SnapshotLog = {
  dma7: number;
  chargeToDate: number;
};

function csvPath(): string {
  return join(process.cwd(), "output.csv");
}

function ensureFile(path: string): void {
  if (!existsSync(path) || readFileSync(path, "utf8").trim() === "") {
    writeFileSync(path, `${HEADER}\n`);
  }
}

function parsePastRows(raw: string): PastRow[] {
  const lines = raw.trim().split("\n").slice(1);
  const rows: PastRow[] = [];
  for (const line of lines) {
    const cols = line.split(",");
    const timestampMs = Date.parse(cols[0] ?? "");
    const vaultId = Number(cols[2]);
    const nftId = Number(cols[3]);
    const netApy = Number(cols[11]);
    const shortfall = Number(cols[14]);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(vaultId) || !Number.isFinite(nftId)) {
      continue;
    }
    if (!Number.isFinite(netApy) || !Number.isFinite(shortfall)) {
      continue;
    }
    rows.push({ timestampMs, vaultId, nftId, netApy, shortfall });
  }
  return rows;
}

function samePosition(row: PastRow, snap: PositionSnapshot): boolean {
  return row.vaultId === snap.vaultId && row.nftId === snap.nftId;
}

/** 7-day mean Net APY for this vault + NFT, including the new snapshot. */
function dma7(past: PastRow[], snap: PositionSnapshot, nowMs: number): number {
  let sum = snap.netApy;
  let count = 1;
  const oldest = nowMs - SEVEN_DAYS_MS;
  for (const row of past) {
    if (samePosition(row, snap) && row.timestampMs >= oldest) {
      sum += row.netApy;
      count += 1;
    }
  }
  return sum / count;
}

/** Sum of this position’s shortfall rows, plus this snapshot. */
function chargeToDate(past: PastRow[], snap: PositionSnapshot): number {
  let total = snap.shortfall;
  for (const row of past) {
    if (samePosition(row, snap)) {
      total += row.shortfall;
    }
  }
  return total;
}

function usd(value: number): string {
  return value.toFixed(6);
}

function apy(value: number): string {
  return value.toFixed(8);
}

/** Append one snapshot. Returns 7-day mean APY and running amount to charge. */
export function appendSnapshot(snap: PositionSnapshot, intervalSeconds: number): SnapshotLog {
  const path = csvPath();
  ensureFile(path);
  const past = parsePastRows(readFileSync(path, "utf8"));
  const now = new Date();
  const log: SnapshotLog = {
    dma7: dma7(past, snap, now.getTime()),
    chargeToDate: chargeToDate(past, snap),
  };
  const row = [
    now.toISOString(),
    String(intervalSeconds),
    String(snap.vaultId),
    String(snap.nftId),
    usd(snap.supplied),
    usd(snap.borrowed),
    usd(snap.equity),
    usd(snap.token0Usd),
    usd(snap.token1Usd),
    apy(snap.supplyApy),
    apy(snap.borrowApy),
    apy(snap.netApy),
    apy(log.dma7),
    snap.netApy < GUARANTEE ? "true" : "false",
    usd(snap.shortfall),
    usd(log.chargeToDate),
    snap.isLiquidated ? "true" : "false",
  ].join(",");
  appendFileSync(path, `${row}\n`);
  return log;
}
