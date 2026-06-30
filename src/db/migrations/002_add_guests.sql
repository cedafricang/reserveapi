CREATE TABLE IF NOT EXISTS booking_guests (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  rsvp_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  rsvp_token VARCHAR(64) NOT NULL UNIQUE,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_booking_guests_booking_id ON booking_guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_rsvp_token ON booking_guests(rsvp_token);