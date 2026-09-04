import { Client } from "@jup-ag/lend-read";
import { loadConfig } from "./config.js";
import { printSnapshot, snapshotPosition } from "./snapshot.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new Client(config.rpcUrl);

  console.log(`Snapshot interval: ${String(config.intervalMinutes)} minutes`);

  for (const ref of config.positions) {
    try {
      const snap = await snapshotPosition(
        client,
        ref,
        config.tokenYields,
        config.intervalMinutes,
      );
      printSnapshot(snap);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed vault ${String(ref.vaultId)}, NFT ${String(ref.nftId)}: ${message}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
