CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('admin','company')),
  company_id uuid REFERENCES companies(id), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'admin' AND company_id IS NULL) OR (role = 'company' AND company_id IS NOT NULL)),
  UNIQUE (id, company_id)
);
CREATE TABLE schedule_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at), capacity integer NOT NULL CHECK (capacity > 0),
  blocked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (starts_at, ends_at)
);
CREATE TABLE trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  plate text NOT NULL, vehicle_type text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plate), UNIQUE (id, company_id)
);
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL, phone text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), protocol text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES companies(id), slot_id uuid NOT NULL REFERENCES schedule_slots(id),
  truck_id uuid NOT NULL, driver_id uuid NOT NULL, weight numeric(14,3) NOT NULL CHECK (weight > 0),
  weight_unit text NOT NULL CHECK (weight_unit IN ('kg','t')), invoice_number text NOT NULL,
  invoice_series text, invoice_key text, notes text, status text NOT NULL CHECK (status IN ('confirmed','cancelled')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (truck_id, company_id) REFERENCES trucks(id, company_id),
  FOREIGN KEY (driver_id, company_id) REFERENCES drivers(id, company_id),
  FOREIGN KEY (created_by, company_id) REFERENCES users(id, company_id)
);
CREATE INDEX bookings_slot_status_idx ON bookings(slot_id, status);
CREATE INDEX bookings_company_created_idx ON bookings(company_id, created_at DESC);
CREATE TABLE booking_history (
  id bigserial PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id),
  actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
