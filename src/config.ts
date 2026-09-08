import { existsSync, readFileSync } from "node:fs";
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
  dbUrl: string | null;
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
    throw new Error("config must be an object");
  }

  const { rpcUrl, intervalSeconds, positions, tokenYields, dbUrl } = value;
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error("config.rpcUrl must be set (usually in config/local.json or config/prod.json)");
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
    dbUrl: parseDbUrl(dbUrl),
  };
}

function parseDbUrl(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("config.dbUrl must be a string");
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (!trimmed.startsWith("postgres://") && !trimmed.startsWith("postgresql://")) {
    throw new Error("config.dbUrl must start with postgres:// or postgresql://");
  }
  return trimmed;
}

/** Later keys replace earlier ones. Nested objects merge; lists replace. */
function merge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (isRecord(prev) && isRecord(value)) {
      out[key] = merge(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${path} must be an object`);
  }
  return parsed;
}

function readJsonIfPresent(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  return readJson(path);
}

/** `staging` or `prod`. `production` maps to `prod`. Empty means no env file. */
function envLayer(): string | null {
  const raw = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (raw === "staging") {
    return "staging";
  }
  if (raw === "prod" || raw === "production") {
    return "prod";
  }
  return null;
}

/** File layers win. If rpcUrl is still empty, use env `RPC_URL` (for deploy). */
function applyRpcUrlEnv(merged: Record<string, unknown>): Record<string, unknown> {
  const current = merged.rpcUrl;
  if (typeof current === "string" && current.trim() !== "") {
    return merged;
  }
  const fromEnv = process.env.RPC_URL?.trim() ?? "";
  if (fromEnv === "") {
    return merged;
  }
  return { ...merged, rpcUrl: fromEnv };
}

/** File layers win. If dbUrl is still empty, use env `DB_URL`. */
function applyDbUrlEnv(merged: Record<string, unknown>): Record<string, unknown> {
  const current = merged.dbUrl;
  if (typeof current === "string" && current.trim() !== "") {
    return merged;
  }
  const fromEnv = process.env.DB_URL?.trim() ?? "";
  if (fromEnv === "") {
    return merged;
  }
  return { ...merged, dbUrl: fromEnv };
}

/**
 * Layers, last wins: default.json → staging.json or prod.json → local.json.
 * Then `RPC_URL` / `DB_URL` if those fields are still missing.
 */
export function loadConfig(configDir = join(process.cwd(), "config")): AppConfig {
  const env = envLayer();
  const merged = applyDbUrlEnv(
    applyRpcUrlEnv(
      merge(
        merge(readJson(join(configDir, "default.json")), env === null ? {} : readJsonIfPresent(join(configDir, `${env}.json`))),
        readJsonIfPresent(join(configDir, "local.json")),
      ),
    ),
  );
  return parseConfig(merged);
}

export function stakingYieldFor(tokenYields: TokenYield[], tokenAddress: string): number {
  return tokenYields.find((row) => row.tokenAddress === tokenAddress)?.stakingYield ?? 0;
}
