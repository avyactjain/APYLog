CREATE TABLE IF NOT EXISTS snapshots (
  id bigserial PRIMARY KEY,
  timestamp timestamptz NOT NULL,
  interval_seconds integer NOT NULL,
  vault_id integer NOT NULL,
  nft_id integer NOT NULL,
  supplied double precision NOT NULL,
  borrowed double precision NOT NULL,
  equity double precision NOT NULL,
  token0_usd double precision NOT NULL,
  token1_usd double precision NOT NULL,
  supply_apy double precision NOT NULL,
  borrow_apy double precision NOT NULL,
  net_apy double precision NOT NULL,
  dma7 double precision NOT NULL,
  below_2pct boolean NOT NULL,
  shortfall double precision NOT NULL,
  charge_to_date double precision NOT NULL,
  is_liquidated boolean NOT NULL,
  token0_apy double precision NOT NULL,
  token1_apy double precision NOT NULL,
  trading_apy double precision NOT NULL,
  raw_position jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS snapshots_vault_nft_time_idx
  ON snapshots (vault_id, nft_id, timestamp DESC);
