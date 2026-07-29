-- Mileage Ledger v1 schema
-- Balance, lifetime earned, and lifetime spent are all COMPUTED from
-- activities + transactions below -- never stored as a standalone number,
-- so nothing can drift out of sync.

-- One row per Strava activity that generated a credit.
CREATE TABLE IF NOT EXISTS activities (
  id              BIGSERIAL PRIMARY KEY,
  strava_id       BIGINT UNIQUE NOT NULL,
  activity_type   TEXT NOT NULL,          -- 'Run', 'Ride', 'Swim', 'Hike', etc (raw Strava type)
  distance_miles  NUMERIC(10, 3) NOT NULL,
  rate_per_mile   NUMERIC(10, 4) NOT NULL, -- rate actually applied, stored for history
  multiplier      NUMERIC(6, 3) NOT NULL DEFAULT 1.0,
  credit_amount   NUMERIC(10, 2) NOT NULL, -- distance_miles * rate_per_mile * multiplier
  started_at      TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL DEFAULT 'strava', -- 'strava' | 'manual'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per Plaid transaction that generated a debit.
CREATE TABLE IF NOT EXISTS transactions (
  id                  BIGSERIAL PRIMARY KEY,
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  merchant_name       TEXT,
  amount              NUMERIC(10, 2) NOT NULL, -- positive = money spent (debit)
  plaid_category      TEXT,
  category_override   TEXT,                    -- manual override, null until user sets one
  posted_at           TIMESTAMPTZ NOT NULL,
  pending             BOOLEAN NOT NULL DEFAULT false,
  excluded            BOOLEAN NOT NULL DEFAULT false, -- "flag - shouldn't count" toggle
  source              TEXT NOT NULL DEFAULT 'plaid',  -- 'plaid' | 'manual'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stores Plaid access token(s). Single-user app -> single row is fine,
-- but keyed so it's easy to extend later.
CREATE TABLE IF NOT EXISTS plaid_items (
  id            BIGSERIAL PRIMARY KEY,
  item_id       TEXT UNIQUE NOT NULL,
  access_token  TEXT NOT NULL,
  institution_name TEXT,
  cursor        TEXT, -- /transactions/sync cursor, null = fetch full history
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stores Strava tokens (access + refresh). Single-user -> single row.
CREATE TABLE IF NOT EXISTS strava_tokens (
  id             BIGSERIAL PRIMARY KEY,
  athlete_id     BIGINT UNIQUE NOT NULL,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  expires_at     BIGINT NOT NULL, -- unix timestamp
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities (started_at);
CREATE INDEX IF NOT EXISTS idx_transactions_posted_at ON transactions (posted_at);
