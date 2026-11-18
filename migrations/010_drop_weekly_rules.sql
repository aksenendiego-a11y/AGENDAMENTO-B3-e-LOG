-- Remove a restrição NOT NULL da coluna legada weekly_rules (caso exista)
ALTER TABLE schedule_configs ALTER COLUMN weekly_rules DROP NOT NULL;

-- Remove a coluna legada weekly_rules, se ainda existir
ALTER TABLE schedule_configs DROP COLUMN IF EXISTS weekly_rules;