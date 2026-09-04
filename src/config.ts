import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PositionRef = {
  vaultId: number;
  nftId: number;
};

export type AppConfig = {
  rpcUrl: string;
  intervalMinutes: number;
  positions: PositionRef[];
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

function parseConfig(value: unknown): AppConfig {
  if (!isRecord(value)) {
    throw new Error("config.json must be an object");
  }

  const { rpcUrl, intervalMinutes, positions } = value;
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error("config.rpcUrl must be a non-empty string");
  }
  if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
    throw new Error("config.rpcUrl must start with http:// or https://");
  }
  if (!isWholeNumber(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error("config.intervalMinutes must be a whole number greater than 0");
  }
  if (!Array.isArray(positions)) {
    throw new Error("config.positions must be a list");
  }

  return {
    rpcUrl: rpcUrl.trim(),
    intervalMinutes,
    positions: positions.map(parsePosition),
  };
}

export function loadConfig(configPath = join(process.cwd(), "config.json")): AppConfig {
  const raw = readFileSync(configPath, "utf8");
  return parseConfig(JSON.parse(raw) as unknown);
}
