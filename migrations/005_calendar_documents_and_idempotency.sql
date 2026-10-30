ALTER TABLE booking_documents ADD COLUMN original_name text NOT NULL DEFAULT 'document';
ALTER TABLE booking_documents ADD COLUMN deleted_at timestamptz;
ALTER TABLE document_audit_events DROP CONSTRAINT document_audit_events_action_check;
ALTER TABLE document_audit_events ADD CONSTRAINT document_audit_events_action_check CHECK (action IN ('upload','download','delete'));
ALTER TABLE bookings ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX bookings_company_idempotency_idx ON bookings(company_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
