import { Client } from "@jup-ag/lend-read";
import { loadConfig, type AppConfig } from "./config.js";
import { appendSnapshot } from "./csv.js";
import { log, printOutputSummary, printSnapshot } from "./log.js";
import { listenPort, startServer } from "./server.js";
import { snapshotPosition } from "./snapshot.js";

async function snapshotAll(client: Client, config: AppConfig): Promise<void> {
  for (const ref of config.positions) {
    try {
      const snap = await snapshotPosition(client, ref, config.tokenYields, config.intervalSeconds);
      const saved = appendSnapshot(snap, config.intervalSeconds);
      printSnapshot(snap, saved.chargeToDate, saved.dma7);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed vault ${String(ref.vaultId)}, NFT ${String(ref.nftId)}: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new Client(config.rpcUrl);
  const delayMs = config.intervalSeconds * 1000;
  const port = listenPort();
  let running = false;
  let stopping = false;

  startServer(config.intervalSeconds, port);
  log.start(`Web UI on http://0.0.0.0:${String(port)}`);
  log.start(`Snapshot every ${String(config.intervalSeconds)} seconds`);

  const tick = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    if (running) {
      log.warn("Previous snapshot still running; skipping this tick");
      return;
    }
    running = true;
    try {
      await snapshotAll(client, config);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, delayMs);

  const stop = (signal: string): void => {
    if (stopping) {
      process.exit(0);
    }
    stopping = true;
    clearInterval(timer);
    log.info(`Stopped (${signal})`);
    printOutputSummary();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    stop("SIGINT");
  });
  process.on("SIGTERM", () => {
    stop("SIGTERM");
  });

  await tick();
}

main().catch((error: unknown) => {
  log.error(error);
  process.exitCode = 1;
});
