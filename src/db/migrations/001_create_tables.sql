-- ── CUSTOMERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                                 VARCHAR(255) UNIQUE NOT NULL,
  first_name                            VARCHAR(100) NOT NULL,
  last_name                             VARCHAR(100) NOT NULL,
  phone                                 VARCHAR(30),
  password_hash                         TEXT,
  google_id                             VARCHAR(255) UNIQUE,
  shopify_customer_id                   VARCHAR(255) UNIQUE,
  tier                                  VARCHAR(20) NOT NULL DEFAULT 'reserve-member'
                                          CHECK (tier IN ('reserve-member','silver','gold','platinum')),
  points_balance                        INTEGER NOT NULL DEFAULT 0,
  annual_spend                          BIGINT NOT NULL DEFAULT 0,
  complimentary_sessions_used_this_year INTEGER NOT NULL DEFAULT 0,
  referral_code                         VARCHAR(20) UNIQUE NOT NULL,
  referred_by                           UUID REFERENCES customers(id) ON DELETE SET NULL,
  last_active_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_verified                        BOOLEAN NOT NULL DEFAULT false,
  email_verification_token              TEXT UNIQUE,
  password_reset_token                  TEXT UNIQUE,
  password_reset_expires                TIMESTAMPTZ,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_email         ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_referral_code ON customers(referral_code);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_id    ON customers(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_tier          ON customers(tier);
CREATE INDEX IF NOT EXISTS idx_customers_last_active   ON customers(last_active_at);

-- ── BOOKINGS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  room                VARCHAR(30) NOT NULL
                        CHECK (room IN ('private-cinema','hi-fi-room','media-room')),
  booking_date        DATE NOT NULL,
  time_slot           VARCHAR(20) NOT NULL,
  guest_count         INTEGER NOT NULL DEFAULT 1,
  payment_type        VARCHAR(25) NOT NULL
                        CHECK (payment_type IN (
                          'cash','points','complimentary-tier',
                          'club-member','admin-grant'
                        )),
  amount_paid         BIGINT NOT NULL DEFAULT 0,
  paystack_reference  VARCHAR(100) UNIQUE,
  refreshment         VARCHAR(25) NOT NULL DEFAULT 'none'
                        CHECK (refreshment IN (
                          'none','curated-snacks',
                          'cocktails-platters','bespoke'
                        )),
  refreshment_amount  BIGINT NOT NULL DEFAULT 0,
  points_used         INTEGER NOT NULL DEFAULT 0,
  status              VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed','rescheduled','cancelled')),
  reschedule_count    INTEGER NOT NULL DEFAULT 0,
  club_id             UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer    ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date        ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_room        ON bookings(room);
CREATE INDEX IF NOT EXISTS idx_bookings_status      ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment     ON bookings(payment_type);

-- ── POINTS TRANSACTIONS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS points_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL
                CHECK (type IN (
                  'earn-purchase','earn-booking',
                  'earn-referral-reserve','earn-referral-product',
                  'redeem-booking','admin-adjust','points-expired'
                )),
  points      INTEGER NOT NULL,
  description TEXT NOT NULL,
  reference_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_customer   ON points_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_points_type       ON points_transactions(type);
CREATE INDEX IF NOT EXISTS idx_points_created    ON points_transactions(created_at);

-- ── TIER HISTORY ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tier_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  previous_tier VARCHAR(20) NOT NULL,
  new_tier      VARCHAR(20) NOT NULL,
  reason        VARCHAR(50) NOT NULL
                  CHECK (reason IN (
                    'spend-threshold-crossed',
                    'annual-reset',
                    'admin-override',
                    'grace-period-expired'
                  )),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tier_history_customer ON tier_history(customer_id);

-- ── CLUBS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  slug VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_club_membership_ids_club_id ON club_membership_ids(club_id);
CREATE INDEX IF NOT EXISTS idx_club_membership_ids_code ON club_membership_ids(membership_code);




-- ── PENDING REFERRAL POINTS ───────────────────────────────────
-- Stores GoAffPro referral points for affiliates
-- who do not yet have a Reserve account
CREATE TABLE IF NOT EXISTS pending_referral_points (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_email VARCHAR(255) NOT NULL,
  points         INTEGER NOT NULL DEFAULT 50,
  source         VARCHAR(30) NOT NULL DEFAULT 'goaffpro',
  applied        BOOLEAN NOT NULL DEFAULT false,
  applied_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_referral_email ON pending_referral_points(affiliate_email);

-- ── REFRESH TOKENS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_customer ON refresh_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token    ON refresh_tokens(token);