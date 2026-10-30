ALTER TABLE bookings ALTER COLUMN weight DROP NOT NULL;
ALTER TABLE bookings ALTER COLUMN weight_unit DROP NOT NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_weight_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_weight_check CHECK (weight IS NULL OR weight > 0);
