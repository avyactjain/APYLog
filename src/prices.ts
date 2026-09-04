const PRICE_URL = "https://lite-api.jup.ag/price/v3";

export type TokenPrice = {
  usd: number;
  decimals: number;
};

type PriceResponse = Record<
  string,
  {
    usdPrice?: number;
    decimals?: number;
  } | null
>;

export async function usdPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
  const ids = [...new Set(mints.filter((mint) => mint.length > 0))];
  const url = `${PRICE_URL}?ids=${ids.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`USD price lookup failed (${String(res.status)})`);
  }

  const body = (await res.json()) as PriceResponse;
  const out = new Map<string, TokenPrice>();
  for (const mint of ids) {
    const row = body[mint];
    const usd = row?.usdPrice;
    const decimals = row?.decimals;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error(`No USD price for ${mint}`);
    }
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
      throw new Error(`No decimals for ${mint}`);
    }
    out.set(mint, { usd, decimals });
  }
  return out;
}

export function amountUsd(raw: bigint, price: TokenPrice): number {
  return (Number(raw) / 10 ** price.decimals) * price.usd;
}
