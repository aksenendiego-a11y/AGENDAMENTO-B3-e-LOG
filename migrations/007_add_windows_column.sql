-- Adiciona a coluna windows no schema atual (compatível com versões anteriores que usavam weekly_rules)
ALTER TABLE schedule_configs ADD COLUMN IF NOT EXISTS windows jsonb;

-- Migra dados da coluna legada weekly_rules para a nova coluna windows, quando houver
UPDATE schedule_configs SET windows = weekly_rules WHERE windows IS NULL AND weekly_rules IS NOT NULL;

-- Garante que a coluna windows não fique nula em registros existentes
ALTER TABLE schedule_configs ALTER COLUMN windows SET NOT NULL;