ALTER TABLE schedule_configs
ADD COLUMN IF NOT EXISTS rule_type text DEFAULT 'weekly' CHECK (rule_type IN ('weekly', 'range')),
ADD COLUMN IF NOT EXISTS start_date date,
ADD COLUMN IF NOT EXISTS end_date date;

UPDATE schedule_configs SET rule_type = 'weekly' WHERE rule_type IS NULL;
