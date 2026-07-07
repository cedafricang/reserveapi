-- Drop old club tables
DROP TABLE IF EXISTS club_members CASCADE;

-- Create new clubs table
CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  slug VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create membership IDs table
CREATE TABLE IF NOT EXISTS club_membership_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  membership_code VARCHAR(100) NOT NULL,
  claimed BOOLEAN NOT NULL DEFAULT false,
  claimed_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(club_id, membership_code)
);

-- Add club membership columns to customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS club_membership_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS club_first_visit_used BOOLEAN NOT NULL DEFAULT false;

-- Add discount columns to bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS discount_percentage INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_club_membership_ids_club_id ON club_membership_ids(club_id);
CREATE INDEX IF NOT EXISTS idx_club_membership_ids_code ON club_membership_ids(membership_code);
CREATE INDEX IF NOT EXISTS idx_customers_club_id ON customers(club_id);