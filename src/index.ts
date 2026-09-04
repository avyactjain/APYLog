import { Client } from "@jup-ag/lend-read";
import { loadConfig, type AppConfig } from "./config.js";
import { printSnapshot, snapshotPosition } from "./snapshot.js";

async function snapshotAll(client: Client, config: AppConfig): Promise<void> {
  for (const ref of config.positions) {
    try {
      const snap = await snapshotPosition(client, ref, config.tokenYields, config.intervalSeconds);
      printSnapshot(snap);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed vault ${String(ref.vaultId)}, NFT ${String(ref.nftId)}: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new Client(config.rpcUrl);
  const delayMs = config.intervalSeconds * 1000;
  let running = false;

  console.log(`Snapshot every ${String(config.intervalSeconds)} seconds`);

  const tick = async (): Promise<void> => {
    if (running) {
      console.error("Previous snapshot still running; skipping this tick");
      return;
    }
    running = true;
    try {
      await snapshotAll(client, config);
    } finally {
      running = false;
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, delayMs);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
