-- Garante a coluna windows no schedule_configs, compatível com esquemas antigos (weekly_rules)
ALTER TABLE schedule_configs ADD COLUMN IF NOT EXISTS windows jsonb;

-- Migra dados da coluna legada weekly_rules para windows, quando ambas existirem
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_configs' AND column_name='weekly_rules') THEN
    UPDATE schedule_configs SET windows = weekly_rules WHERE windows IS NULL AND weekly_rules IS NOT NULL;
  END IF;
END
$$;

-- Garante que a coluna windows não fique nula em registros existentes
ALTER TABLE schedule_configs ALTER COLUMN windows SET NOT NULL;