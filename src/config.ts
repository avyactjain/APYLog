import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PositionRef = {
  vaultId: number;
  nftId: number;
};

export type TokenYield = {
  tokenAddress: string;
  stakingYield: number;
};

export type AppConfig = {
  rpcUrl: string;
  intervalSeconds: number;
  positions: PositionRef[];
  tokenYields: TokenYield[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parsePosition(value: unknown, index: number): PositionRef {
  if (!isRecord(value)) {
    throw new Error(`config.positions[${index}] must be an object`);
  }

  const { vaultId, nftId } = value;
  if (!isWholeNumber(vaultId) || vaultId < 0) {
    throw new Error(`config.positions[${index}].vaultId must be a whole number`);
  }
  if (!isWholeNumber(nftId) || nftId < 0) {
    throw new Error(`config.positions[${index}].nftId must be a whole number`);
  }

  return { vaultId, nftId };
}

function parseTokenYield(value: unknown, index: number): TokenYield {
  if (!isRecord(value)) {
    throw new Error(`config.tokenYields[${index}] must be an object`);
  }

  const { tokenAddress, stakingYield } = value;
  if (typeof tokenAddress !== "string" || tokenAddress.trim() === "") {
    throw new Error(`config.tokenYields[${index}].tokenAddress must be a token address`);
  }
  if (!isWholeNumber(stakingYield) || stakingYield < 0) {
    throw new Error(`config.tokenYields[${index}].stakingYield must be a whole number`);
  }

  return { tokenAddress: tokenAddress.trim(), stakingYield };
}

function parseConfig(value: unknown): AppConfig {
  if (!isRecord(value)) {
    throw new Error("config.json must be an object");
  }

  const { rpcUrl, intervalSeconds, positions, tokenYields } = value;
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error("config.rpcUrl must be a non-empty string");
  }
  if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
    throw new Error("config.rpcUrl must start with http:// or https://");
  }
  if (!isWholeNumber(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("config.intervalSeconds must be a whole number greater than 0");
  }
  if (!Array.isArray(positions)) {
    throw new Error("config.positions must be a list");
  }
  if (!Array.isArray(tokenYields)) {
    throw new Error("config.tokenYields must be a list");
  }

  return {
    rpcUrl: rpcUrl.trim(),
    intervalSeconds,
    positions: positions.map(parsePosition),
    tokenYields: tokenYields.map(parseTokenYield),
  };
}

export function loadConfig(configPath = join(process.cwd(), "config.json")): AppConfig {
  const raw = readFileSync(configPath, "utf8");
  return parseConfig(JSON.parse(raw) as unknown);
}

export function stakingYieldFor(tokenYields: TokenYield[], tokenAddress: string): number {
  return tokenYields.find((row) => row.tokenAddress === tokenAddress)?.stakingYield ?? 0;
}
