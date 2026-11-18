-- Permite que a coluna end_date seja nula em schedule_configs (compatível com configs antigas)
ALTER TABLE schedule_configs ALTER COLUMN end_date DROP NOT NULL;