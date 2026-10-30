CREATE TABLE schedule_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), timezone text NOT NULL,
  effective_from date NOT NULL, weekly_rules jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (effective_from)
);
CREATE INDEX schedule_configs_effective_idx ON schedule_configs(effective_from DESC);
CREATE TABLE schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_id uuid NOT NULL REFERENCES schedule_configs(id),
  local_date date NOT NULL, blocked boolean NOT NULL DEFAULT false, windows jsonb,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_id, local_date), CHECK (blocked OR windows IS NOT NULL)
);
ALTER TABLE schedule_slots ADD COLUMN config_id uuid REFERENCES schedule_configs(id);
ALTER TABLE schedule_slots ADD COLUMN local_date date;
ALTER TABLE schedule_slots ADD COLUMN timezone text;
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL,
  resource_type text NOT NULL, resource_id text, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC);
ALTER TABLE bookings ADD CONSTRAINT bookings_id_company_unique UNIQUE (id, company_id);
CREATE TABLE booking_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  company_id uuid NOT NULL REFERENCES companies(id), storage_key text NOT NULL UNIQUE,
  media_type text NOT NULL CHECK (media_type IN ('application/pdf','application/xml')),
  byte_size bigint NOT NULL CHECK (byte_size > 0), sha256 char(64) NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (booking_id, company_id) REFERENCES bookings(id, company_id)
);
CREATE INDEX booking_documents_company_idx ON booking_documents(company_id, booking_id);
CREATE TABLE document_audit_events (
  id bigserial PRIMARY KEY, document_id uuid NOT NULL REFERENCES booking_documents(id),
  actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL CHECK (action IN ('upload','download')),
  created_at timestamptz NOT NULL DEFAULT now()
);
