const VAULT_URL = "https://api.solana.fluid.io/v2/main/borrowing/vaults";
const RATE_SCALE = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pull supplyRate.dex.trading out of the Fluid vault JSON. */
function tradingRaw(value: unknown): string | number | null {
  if (!isRecord(value) || !isRecord(value.supplyRate) || !isRecord(value.supplyRate.dex)) {
    return null;
  }
  const trading = value.supplyRate.dex.trading;
  if (typeof trading === "string" || typeof trading === "number") {
    return trading;
  }
  return null;
}

/** Yearly trading yield for this vault (6 → 0.0006). 0 if the feed is down. */
export async function tradingApr(vaultId: number): Promise<number> {
  try {
    const res = await fetch(`${VAULT_URL}/${String(vaultId)}`);
    if (!res.ok) {
      return 0;
    }
    const raw = tradingRaw(await res.json());
    if (raw === null) {
      return 0;
    }
    const apr = Number(raw) / RATE_SCALE;
    return Number.isFinite(apr) ? apr : 0;
  } catch {
    return 0;
  }
}
