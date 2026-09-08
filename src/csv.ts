import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUARANTEE, type PositionSnapshot } from "./snapshot.js";
import {
  bucketPoints,
  chargeBounds,
  lookbackMs,
  rangeMs,
  withDma7,
  type ChargeSeries,
  type HistoryRange,
  type HistorySeries,
} from "./history.js";

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
  "token0Apy",
  "token1Apy",
  "tradingApy",
].join(",");

export type LastSnapshotDetails = {
  supplied: number;
  borrowed: number;
  equity: number;
  token0Usd: number;
  token1Usd: number;
  token0Apy: number;
  token1Apy: number;
  tradingApy: number;
  supplyApy: number;
  borrowApy: number;
  netApy: number;
};

type CsvRow = {
  timestamp: string;
  timestampMs: number;
  intervalSeconds: number;
  vaultId: number;
  nftId: number;
  netApy: number;
  shortfall: number;
  chargeToDate: number;
  below2pct: boolean;
  last: LastSnapshotDetails;
};

export type SnapshotLog = {
  dma7: number;
  chargeToDate: number;
};

export type PositionSummary = {
  vaultId: number;
  nftId: number;
  snapshots: number;
  below2pct: number;
  firstAt: string;
  lastAt: string;
  lastNetApy: number;
  chargeToDate: number;
  lastSnapshot: LastSnapshotDetails;
};

export type OutputSummary = {
  snapshots: number;
  positions: PositionSummary[];
};

function csvPath(): string {
  return join(process.cwd(), "output.csv");
}

function num(cols: string[], index: number, fallback = 0): number {
  const value = Number(cols[index]);
  return Number.isFinite(value) ? value : fallback;
}

function parseRows(raw: string): CsvRow[] {
  const lines = raw.trim().split("\n").slice(1);
  const rows: CsvRow[] = [];
  for (const line of lines) {
    const cols = line.split(",");
    const timestamp = cols[0] ?? "";
    const timestampMs = Date.parse(timestamp);
    const intervalSeconds = Number(cols[1]);
    const vaultId = Number(cols[2]);
    const nftId = Number(cols[3]);
    const netApy = Number(cols[11]);
    const shortfall = Number(cols[14]);
    const billed = Number(cols[15]);
    const below2pct = (cols[13] ?? "") === "true";
    if (!Number.isFinite(timestampMs) || !Number.isFinite(vaultId) || !Number.isFinite(nftId)) {
      continue;
    }
    if (!Number.isFinite(netApy) || !Number.isFinite(shortfall) || !Number.isFinite(billed)) {
      continue;
    }
    rows.push({
      timestamp,
      timestampMs,
      intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 0,
      vaultId,
      nftId,
      netApy,
      shortfall,
      chargeToDate: billed,
      below2pct,
      last: {
        supplied: num(cols, 4),
        borrowed: num(cols, 5),
        equity: num(cols, 6),
        token0Usd: num(cols, 7),
        token1Usd: num(cols, 8),
        supplyApy: num(cols, 9),
        borrowApy: num(cols, 10),
        netApy,
        token0Apy: num(cols, 17),
        token1Apy: num(cols, 18),
        tradingApy: num(cols, 19),
      },
    });
  }
  return rows;
}

function loadRows(): CsvRow[] {
  const path = csvPath();
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, "utf8");
  if (raw.trim() === "") {
    return [];
  }
  return parseRows(raw);
}

function samePosition(row: CsvRow, snap: PositionSnapshot): boolean {
  return row.vaultId === snap.vaultId && row.nftId === snap.nftId;
}

/** 7-day mean Net APY for this vault + NFT, including the new snapshot. */
function dma7(past: CsvRow[], snap: PositionSnapshot, nowMs: number): number {
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
function runningCharge(past: CsvRow[], snap: PositionSnapshot): number {
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

function ensureFile(path: string): void {
  if (!existsSync(path) || readFileSync(path, "utf8").trim() === "") {
    writeFileSync(path, `${HEADER}\n`);
  }
}

/** Append one snapshot. Returns 7-day mean APY and running amount to charge. */
export function appendSnapshot(snap: PositionSnapshot, intervalSeconds: number): SnapshotLog {
  const path = csvPath();
  ensureFile(path);
  const past = loadRows();
  const now = new Date();
  const log: SnapshotLog = {
    dma7: dma7(past, snap, now.getTime()),
    chargeToDate: runningCharge(past, snap),
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
    apy(snap.token0Apy),
    apy(snap.token1Apy),
    apy(snap.tradingApy),
  ].join(",");
  appendFileSync(path, `${row}\n`);
  return log;
}

/** One line per vault + NFT: last Net APY, times under 2%, amount to charge, last snapshot amounts/yields. */
export function readOutputSummary(): OutputSummary {
  const rows = loadRows();
  const byPosition = new Map<string, PositionSummary>();
  for (const row of rows) {
    const key = `${String(row.vaultId)}:${String(row.nftId)}`;
    const existing = byPosition.get(key);
    if (existing === undefined) {
      byPosition.set(key, {
        vaultId: row.vaultId,
        nftId: row.nftId,
        snapshots: 1,
        below2pct: row.below2pct ? 1 : 0,
        firstAt: row.timestamp,
        lastAt: row.timestamp,
        lastNetApy: row.netApy,
        chargeToDate: row.chargeToDate,
        lastSnapshot: row.last,
      });
      continue;
    }
    existing.snapshots += 1;
    if (row.below2pct) {
      existing.below2pct += 1;
    }
    existing.lastAt = row.timestamp;
    existing.lastNetApy = row.netApy;
    existing.chargeToDate = row.chargeToDate;
    existing.lastSnapshot = row.last;
  }
  return {
    snapshots: rows.length,
    positions: [...byPosition.values()].sort((a, b) => a.vaultId - b.vaultId || a.nftId - b.nftId),
  };
}

/** History for one vault + NFT in a capped time window. */
export function readHistory(vaultId: number, nftId: number, range: HistoryRange): HistorySeries {
  const now = Date.now();
  const fromMs = now - rangeMs(range);
  const lookbackFrom = fromMs - lookbackMs();
  const raw: Array<{ timestampMs: number; supplyApy: number; borrowApy: number }> = [];
  for (const row of loadRows()) {
    if (row.vaultId !== vaultId || row.nftId !== nftId || row.timestampMs < lookbackFrom) {
      continue;
    }
    raw.push({
      timestampMs: row.timestampMs,
      supplyApy: row.last.supplyApy,
      borrowApy: row.last.borrowApy,
    });
  }
  return {
    range,
    points: withDma7(bucketPoints(raw, range), fromMs, range),
  };
}

/** One charge row per snapshot in a capped time window. Oldest first. */
export function readCharges(vaultId: number, nftId: number, range: HistoryRange): ChargeSeries {
  const fromMs = Date.now() - rangeMs(range);
  const rows: ChargeSeries["rows"] = [];
  for (const row of loadRows()) {
    if (row.vaultId !== vaultId || row.nftId !== nftId || row.timestampMs < fromMs) {
      continue;
    }
    const bounds = chargeBounds(row.timestampMs, row.intervalSeconds);
    rows.push({
      from: bounds.from,
      to: bounds.to,
      charge: row.shortfall,
    });
  }
  return { range, rows };
}
