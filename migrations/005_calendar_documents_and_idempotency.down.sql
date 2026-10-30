DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM booking_documents WHERE deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM document_audit_events WHERE action='delete') THEN
    RAISE EXCEPTION 'Rollback blocked: deleted private documents need the new access-control state';
  END IF;
END $$;
DROP INDEX IF EXISTS bookings_company_idempotency_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE document_audit_events DROP CONSTRAINT IF EXISTS document_audit_events_action_check;
ALTER TABLE document_audit_events ADD CONSTRAINT document_audit_events_action_check CHECK (action IN ('upload','download'));
ALTER TABLE booking_documents DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE booking_documents DROP COLUMN IF EXISTS original_name;
