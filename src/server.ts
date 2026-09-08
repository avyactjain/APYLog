import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { OutputSummary } from "./csv.js";
import { parseHistoryRange } from "./history.js";
import type { Store } from "./store.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export type SummaryResponse = {
  snapshots: number;
  positions: OutputSummary["positions"];
  totalCharge: number;
  intervalSeconds: number;
  lastSnapshotAt: string | null;
  nextSnapshotAt: string | null;
};

function publicDir(): string {
  return join(process.cwd(), "public");
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function queryParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value === null || value.trim() === "" ? null : value.trim();
}

function queryInt(url: URL, name: string): number | null {
  const raw = queryParam(url, name);
  if (raw === null) {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function buildSummary(summary: OutputSummary, intervalSeconds: number): SummaryResponse {
  const totalCharge = summary.positions.reduce((sum, row) => sum + row.chargeToDate, 0);
  let lastSnapshotAt: string | null = null;
  for (const row of summary.positions) {
    if (lastSnapshotAt === null || row.lastAt > lastSnapshotAt) {
      lastSnapshotAt = row.lastAt;
    }
  }
  const nextSnapshotAt =
    lastSnapshotAt === null
      ? null
      : new Date(Date.parse(lastSnapshotAt) + intervalSeconds * 1000).toISOString();

  return {
    snapshots: summary.snapshots,
    positions: summary.positions,
    totalCharge,
    intervalSeconds,
    lastSnapshotAt,
    nextSnapshotAt,
  };
}

function safePublicPath(urlPath: string): string | null {
  const root = publicDir();
  const cleaned = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = cleaned === "/" ? "index.html" : cleaned.replace(/^\//, "");
  const full = normalize(join(root, relative));
  if (full !== root && !full.startsWith(root + "/")) {
    return null;
  }
  return full;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const path = safePublicPath(req.url ?? "/");
  if (path === null || !existsSync(path) || !statSync(path).isFile()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const type = MIME[extname(path)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  createReadStream(path).pipe(res);
}

async function resolvePosition(
  store: Store,
  url: URL,
): Promise<{ vaultId: number; nftId: number } | null> {
  let vaultId = queryInt(url, "vaultId");
  let nftId = queryInt(url, "nftId");
  if (vaultId !== null && nftId !== null) {
    return { vaultId, nftId };
  }
  const summary = await store.readOutputSummary();
  const first = summary.positions[0];
  if (first === undefined) {
    return null;
  }
  return { vaultId: first.vaultId, nftId: first.nftId };
}

async function handleHistory(store: Store, url: URL, res: ServerResponse): Promise<void> {
  const range = parseHistoryRange(queryParam(url, "range"));
  const pos = await resolvePosition(store, url);
  if (pos === null) {
    send(res, 200, JSON.stringify({ range, points: [] }), "application/json; charset=utf-8");
    return;
  }
  const history = await store.readHistory(pos.vaultId, pos.nftId, range);
  send(res, 200, JSON.stringify(history), "application/json; charset=utf-8");
}

async function handleCharges(store: Store, url: URL, res: ServerResponse): Promise<void> {
  const range = parseHistoryRange(queryParam(url, "range"));
  const pos = await resolvePosition(store, url);
  if (pos === null) {
    send(res, 200, JSON.stringify({ range, rows: [] }), "application/json; charset=utf-8");
    return;
  }
  const charges = await store.readCharges(pos.vaultId, pos.nftId, range);
  send(res, 200, JSON.stringify(charges), "application/json; charset=utf-8");
}

/** HTTP server: page, summary JSON, history JSON, health. */
export function startServer(intervalSeconds: number, port: number, store: Store): void {
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (method !== "GET" && method !== "HEAD") {
      send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }

    if (url.pathname === "/health") {
      send(res, 200, "ok", "text/plain; charset=utf-8");
      return;
    }

    if (url.pathname === "/api/summary") {
      void store
        .readOutputSummary()
        .then((summary) => {
          send(res, 200, JSON.stringify(buildSummary(summary, intervalSeconds)), "application/json; charset=utf-8");
        })
        .catch(() => {
          send(res, 500, "Could not load summary", "text/plain; charset=utf-8");
        });
      return;
    }

    if (url.pathname === "/api/history") {
      void handleHistory(store, url, res).catch(() => {
        send(res, 500, "Could not load history", "text/plain; charset=utf-8");
      });
      return;
    }

    if (url.pathname === "/api/charges") {
      void handleCharges(store, url, res).catch(() => {
        send(res, 500, "Could not load charges", "text/plain; charset=utf-8");
      });
      return;
    }

    serveStatic(req, res);
  });

  server.listen(port, "0.0.0.0", () => {
    // Caller logs the URL.
  });
}

export function listenPort(): number {
  const raw = process.env.PORT?.trim() ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a whole number greater than 0");
  }
  return port;
}
