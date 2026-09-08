import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { LastSnapshotDetails, OutputSummary, PositionSummary, SnapshotLog } from "./csv.js";
import { GUARANTEE, type PositionSnapshot } from "./snapshot.js";
import {
  bucketMs,
  chargeBounds,
  lookbackMs,
  rangeMs,
  withDma7,
  type ChargeSeries,
  type HistoryRange,
  type HistorySeries,
} from "./history.js";

const SEVEN_DAYS_MS = lookbackMs();

export type DbClient = {
  appendSnapshot(snap: PositionSnapshot, intervalSeconds: number): Promise<SnapshotLog>;
  readOutputSummary(): Promise<OutputSummary>;
  readHistory(vaultId: number, nftId: number, range: HistoryRange): Promise<HistorySeries>;
  readCharges(vaultId: number, nftId: number, range: HistoryRange): Promise<ChargeSeries>;
  close(): Promise<void>;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

async function dma7For(pool: pg.Pool, snap: PositionSnapshot, now: Date): Promise<number> {
  const from = new Date(now.getTime() - SEVEN_DAYS_MS);
  const result = await pool.query<{ net_apy: string | number }>(
    `SELECT net_apy FROM snapshots
     WHERE vault_id = $1 AND nft_id = $2 AND timestamp >= $3`,
    [snap.vaultId, snap.nftId, from.toISOString()],
  );
  let sum = snap.netApy;
  let count = 1;
  for (const row of result.rows) {
    sum += num(row.net_apy);
    count += 1;
  }
  return sum / count;
}

async function chargeToDateFor(pool: pg.Pool, snap: PositionSnapshot): Promise<number> {
  const result = await pool.query<{ total: string | number | null }>(
    `SELECT COALESCE(SUM(shortfall), 0) AS total
     FROM snapshots WHERE vault_id = $1 AND nft_id = $2`,
    [snap.vaultId, snap.nftId],
  );
  return num(result.rows[0]?.total) + snap.shortfall;
}

async function insertSnapshot(
  pool: pg.Pool,
  snap: PositionSnapshot,
  intervalSeconds: number,
  now: Date,
  log: SnapshotLog,
): Promise<void> {
  await pool.query(
    `INSERT INTO snapshots (
       timestamp, interval_seconds, vault_id, nft_id,
       supplied, borrowed, equity, token0_usd, token1_usd,
       supply_apy, borrow_apy, net_apy, dma7, below_2pct,
       shortfall, charge_to_date, is_liquidated,
       token0_apy, token1_apy, trading_apy, raw_position
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     )`,
    [
      now.toISOString(),
      intervalSeconds,
      snap.vaultId,
      snap.nftId,
      snap.supplied,
      snap.borrowed,
      snap.equity,
      snap.token0Usd,
      snap.token1Usd,
      snap.supplyApy,
      snap.borrowApy,
      snap.netApy,
      log.dma7,
      snap.netApy < GUARANTEE,
      snap.shortfall,
      log.chargeToDate,
      snap.isLiquidated,
      snap.token0Apy,
      snap.token1Apy,
      snap.tradingApy,
      snap.rawPosition ?? {},
    ],
  );
}

function lastDetails(row: Record<string, unknown>): LastSnapshotDetails {
  return {
    supplied: num(row.supplied),
    borrowed: num(row.borrowed),
    equity: num(row.equity),
    token0Usd: num(row.token0_usd),
    token1Usd: num(row.token1_usd),
    token0Apy: num(row.token0_apy),
    token1Apy: num(row.token1_apy),
    tradingApy: num(row.trading_apy),
    supplyApy: num(row.supply_apy),
    borrowApy: num(row.borrow_apy),
    netApy: num(row.net_apy),
  };
}

async function readOutputSummary(pool: pg.Pool): Promise<OutputSummary> {
  const totals = await pool.query<{ n: string | number }>(`SELECT COUNT(*)::int AS n FROM snapshots`);
  const groups = await pool.query<{
    vault_id: number;
    nft_id: number;
    snapshots: string | number;
    below2pct: string | number;
    first_at: Date | string;
    last_at: Date | string;
  }>(
    `SELECT vault_id, nft_id,
            COUNT(*)::int AS snapshots,
            SUM(CASE WHEN below_2pct THEN 1 ELSE 0 END)::int AS below2pct,
            MIN(timestamp) AS first_at,
            MAX(timestamp) AS last_at
     FROM snapshots
     GROUP BY vault_id, nft_id
     ORDER BY vault_id, nft_id`,
  );
  const latest = await pool.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (vault_id, nft_id)
            vault_id, nft_id, timestamp, supplied, borrowed, equity,
            token0_usd, token1_usd, token0_apy, token1_apy, trading_apy,
            supply_apy, borrow_apy, net_apy, charge_to_date
     FROM snapshots
     ORDER BY vault_id, nft_id, timestamp DESC`,
  );
  const lastByKey = new Map<string, Record<string, unknown>>();
  for (const row of latest.rows) {
    lastByKey.set(`${String(row.vault_id)}:${String(row.nft_id)}`, row);
  }

  const positions: PositionSummary[] = [];
  for (const group of groups.rows) {
    const key = `${String(group.vault_id)}:${String(group.nft_id)}`;
    const last = lastByKey.get(key) ?? {};
    positions.push({
      vaultId: group.vault_id,
      nftId: group.nft_id,
      snapshots: num(group.snapshots),
      below2pct: num(group.below2pct),
      firstAt: iso(group.first_at),
      lastAt: iso(group.last_at),
      lastNetApy: num(last.net_apy),
      chargeToDate: num(last.charge_to_date),
      lastSnapshot: lastDetails(last),
    });
  }

  return {
    snapshots: num(totals.rows[0]?.n),
    positions,
  };
}

async function readHistory(
  pool: pg.Pool,
  vaultId: number,
  nftId: number,
  range: HistoryRange,
): Promise<HistorySeries> {
  const now = Date.now();
  const fromMs = now - rangeMs(range);
  const lookbackFrom = new Date(fromMs - lookbackMs()).toISOString();
  const size = bucketMs(range);
  const result = await pool.query<{
    bucket: Date | string;
    supply_apy: string | number;
    borrow_apy: string | number;
  }>(
    `SELECT to_timestamp(floor(extract(epoch FROM timestamp) / $4) * $4) AS bucket,
            AVG(supply_apy) AS supply_apy,
            AVG(borrow_apy) AS borrow_apy
     FROM snapshots
     WHERE vault_id = $1 AND nft_id = $2 AND timestamp >= $3
     GROUP BY bucket
     ORDER BY bucket`,
    [vaultId, nftId, lookbackFrom, size / 1000],
  );
  const bucketed = result.rows.map((row) => ({
    timestampMs: row.bucket instanceof Date ? row.bucket.getTime() : Date.parse(String(row.bucket)),
    supplyApy: num(row.supply_apy),
    borrowApy: num(row.borrow_apy),
  }));
  return {
    range,
    points: withDma7(bucketed, fromMs, range),
  };
}

async function readCharges(
  pool: pg.Pool,
  vaultId: number,
  nftId: number,
  range: HistoryRange,
): Promise<ChargeSeries> {
  const from = new Date(Date.now() - rangeMs(range)).toISOString();
  const result = await pool.query<{
    timestamp: Date | string;
    interval_seconds: string | number;
    shortfall: string | number;
  }>(
    `SELECT timestamp, interval_seconds, shortfall
     FROM snapshots
     WHERE vault_id = $1 AND nft_id = $2 AND timestamp >= $3
     ORDER BY timestamp`,
    [vaultId, nftId, from],
  );
  return {
    range,
    rows: result.rows.map((row) => {
      const toMs = row.timestamp instanceof Date ? row.timestamp.getTime() : Date.parse(String(row.timestamp));
      const bounds = chargeBounds(toMs, num(row.interval_seconds));
      return {
        from: bounds.from,
        to: bounds.to,
        charge: num(row.shortfall),
      };
    }),
  };
}

export async function connectDb(dbUrl: string): Promise<DbClient> {
  const pool = new pg.Pool({ connectionString: dbUrl });
  const sql = readFileSync(join(process.cwd(), "sql/001_snapshots.sql"), "utf8");
  await pool.query(sql);

  return {
    async appendSnapshot(snap, intervalSeconds) {
      const now = new Date();
      const log: SnapshotLog = {
        dma7: await dma7For(pool, snap, now),
        chargeToDate: await chargeToDateFor(pool, snap),
      };
      await insertSnapshot(pool, snap, intervalSeconds, now, log);
      return log;
    },
    readOutputSummary: () => readOutputSummary(pool),
    readHistory: (vaultId, nftId, range) => readHistory(pool, vaultId, nftId, range),
    readCharges: (vaultId, nftId, range) => readCharges(pool, vaultId, nftId, range),
    close: () => pool.end(),
  };
}
