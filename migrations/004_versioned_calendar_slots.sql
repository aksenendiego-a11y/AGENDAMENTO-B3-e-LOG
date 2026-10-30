ALTER TABLE schedule_slots DROP CONSTRAINT IF EXISTS schedule_slots_starts_at_ends_at_key;
CREATE UNIQUE INDEX schedule_slots_generated_unique_idx
  ON schedule_slots(config_id, starts_at, ends_at) WHERE config_id IS NOT NULL;
CREATE UNIQUE INDEX schedule_slots_manual_unique_idx
  ON schedule_slots(starts_at, ends_at) WHERE config_id IS NULL;
