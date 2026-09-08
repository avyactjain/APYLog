export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type HistoryRange = "1d" | "1w" | "1m" | "1y";

export type HistoryPoint = {
  timestamp: string;
  supplyApy: number;
  borrowApy: number;
  supplyApyDma7: number;
  borrowApyDma7: number;
};

export type HistorySeries = {
  range: HistoryRange;
  points: HistoryPoint[];
};

export type ChargeRow = {
  from: string;
  to: string;
  charge: number;
};

export type ChargeSeries = {
  range: HistoryRange;
  rows: ChargeRow[];
};

type RawPoint = {
  timestampMs: number;
  supplyApy: number;
  borrowApy: number;
};

const RANGE_MS: Record<HistoryRange, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS: Record<HistoryRange, number> = {
  "1d": 5 * 60 * 1000,
  "1w": 60 * 60 * 1000,
  "1m": 6 * 60 * 60 * 1000,
  "1y": 24 * 60 * 60 * 1000,
};

export function parseHistoryRange(value: string | null): HistoryRange {
  if (value === "1d" || value === "1w" || value === "1m" || value === "1y") {
    return value;
  }
  return "1w";
}

export function rangeMs(range: HistoryRange): number {
  return RANGE_MS[range];
}

export function bucketMs(range: HistoryRange): number {
  return BUCKET_MS[range];
}

export function lookbackMs(): number {
  return SEVEN_DAYS_MS;
}

/** Interval covered by one snapshot: [timestamp − interval, timestamp]. */
export function chargeBounds(toMs: number, intervalSeconds: number): { from: string; to: string } {
  const seconds = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 0;
  return {
    from: new Date(toMs - seconds * 1000).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

/** Group points into time buckets; each bucket is the mean APY. */
export function bucketPoints(points: RawPoint[], range: HistoryRange): RawPoint[] {
  const size = BUCKET_MS[range];
  const groups = new Map<number, { supply: number; borrow: number; count: number }>();
  for (const point of points) {
    const key = Math.floor(point.timestampMs / size) * size;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { supply: point.supplyApy, borrow: point.borrowApy, count: 1 });
    } else {
      existing.supply += point.supplyApy;
      existing.borrow += point.borrowApy;
      existing.count += 1;
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestampMs, agg]) => ({
      timestampMs,
      supplyApy: agg.supply / agg.count,
      borrowApy: agg.borrow / agg.count,
    }));
}

/** 7-day wall-clock mean of a series, then drop points before `fromMs`. */
export function withDma7(points: RawPoint[], fromMs: number, range: HistoryRange): HistoryPoint[] {
  const cutoff = Math.floor(fromMs / bucketMs(range)) * bucketMs(range);
  const out: HistoryPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) {
      continue;
    }
    const windowStart = point.timestampMs - SEVEN_DAYS_MS;
    let supplySum = 0;
    let borrowSum = 0;
    let count = 0;
    for (let j = 0; j <= i; j += 1) {
      const earlier = points[j];
      if (earlier === undefined || earlier.timestampMs < windowStart) {
        continue;
      }
      supplySum += earlier.supplyApy;
      borrowSum += earlier.borrowApy;
      count += 1;
    }
    if (point.timestampMs < cutoff) {
      continue;
    }
    out.push({
      timestamp: new Date(point.timestampMs).toISOString(),
      supplyApy: point.supplyApy,
      borrowApy: point.borrowApy,
      supplyApyDma7: count === 0 ? point.supplyApy : supplySum / count,
      borrowApyDma7: count === 0 ? point.borrowApy : borrowSum / count,
    });
  }
  return out;
}
