-- File: seeds/init.sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    signup_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    country_code CHAR(2) NOT NULL,
    subscription_tier VARCHAR(50) DEFAULT 'free',
    lifetime_value NUMERIC(10, 2) DEFAULT 0.00
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_country_code ON users(country_code);
CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_users_lifetime_value ON users(lifetime_value);

-- Exports metadata table
CREATE TABLE IF NOT EXISTS exports (
  id UUID PRIMARY KEY,
  status VARCHAR(20) NOT NULL,
  total_rows BIGINT DEFAULT 0,
  processed_rows BIGINT DEFAULT 0,
  columns TEXT,
  delimiter CHAR(1),
  quote_char CHAR(1),
  file_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

-- Seed 10 million rows if table is empty
DO $$
BEGIN
  IF (SELECT count(*) FROM users) = 0 THEN
    RAISE NOTICE 'Seeding users table with 10 million rows. This may take time...';
    INSERT INTO users (name, email, country_code, subscription_tier, lifetime_value)
    SELECT
      'User ' || s as name,
      'user' || s || '@example.com' as email,
      (ARRAY['US','CA','GB','DE','FR','AU','IN','BR','JP','NL'])[ ((s % 10) + 1) ] as country_code,
      (ARRAY['free','basic','premium','enterprise'])[((s % 4) + 1)] as subscription_tier,
      (random()*10000)::numeric(10,2) as lifetime_value
    FROM generate_series(1,10000000) as s;
  END IF;
END$$;
