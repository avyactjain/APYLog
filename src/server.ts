import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { readOutputSummary } from "./csv.js";

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
  positions: ReturnType<typeof readOutputSummary>["positions"];
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

function buildSummary(intervalSeconds: number): SummaryResponse {
  const summary = readOutputSummary();
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

/** HTTP server: page, summary JSON, health. */
export function startServer(intervalSeconds: number, port: number): void {
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";

    if (method !== "GET" && method !== "HEAD") {
      send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }

    if (path === "/health") {
      send(res, 200, "ok", "text/plain; charset=utf-8");
      return;
    }

    if (path === "/api/summary") {
      send(res, 200, JSON.stringify(buildSummary(intervalSeconds)), "application/json; charset=utf-8");
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
