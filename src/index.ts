import { loadConfig } from "./config.js";

const config = loadConfig();

console.log("APYLog");
console.log(`RPC: ${config.rpcUrl}`);
console.log(`Snapshot interval: ${String(config.intervalMinutes)} minutes`);
console.log(`Positions to watch: ${String(config.positions.length)}`);
for (const position of config.positions) {
  console.log(`- vault ${String(position.vaultId)}, NFT ${String(position.nftId)}`);
}
