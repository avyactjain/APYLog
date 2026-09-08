import {
  appendSnapshot as appendCsv,
  readHistory as readCsvHistory,
  readOutputSummary as readCsvSummary,
  type OutputSummary,
  type SnapshotLog,
} from "./csv.js";
import { connectDb, type DbClient } from "./db.js";
import type { HistoryRange, HistorySeries } from "./history.js";
import type { PositionSnapshot } from "./snapshot.js";

export type Store = {
  kind: "postgres" | "csv";
  appendSnapshot(snap: PositionSnapshot, intervalSeconds: number): Promise<SnapshotLog>;
  readOutputSummary(): Promise<OutputSummary>;
  readHistory(vaultId: number, nftId: number, range: HistoryRange): Promise<HistorySeries>;
  close(): Promise<void>;
};

/** Postgres if DB_URL is set, otherwise CSV. */
export async function createStore(dbUrl: string | null): Promise<Store> {
  if (dbUrl === null) {
    return {
      kind: "csv",
      async appendSnapshot(snap, intervalSeconds) {
        return appendCsv(snap, intervalSeconds);
      },
      async readOutputSummary() {
        return readCsvSummary();
      },
      async readHistory(vaultId, nftId, range) {
        return readCsvHistory(vaultId, nftId, range);
      },
      async close() {
        return;
      },
    };
  }

  const db: DbClient = await connectDb(dbUrl);
  return {
    kind: "postgres",
    appendSnapshot: db.appendSnapshot,
    readOutputSummary: db.readOutputSummary,
    readHistory: db.readHistory,
    close: db.close,
  };
}
