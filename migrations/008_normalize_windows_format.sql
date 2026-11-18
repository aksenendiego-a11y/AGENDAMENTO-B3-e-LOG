-- Normaliza o formato da coluna windows de {weekday, windows[]} para o formato plano [OperatingWindow]
-- compatível com o schema atual do código (start, end, durationMinutes, capacity)
UPDATE schedule_configs
SET windows = (
  SELECT jsonb_agg(item)
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(windows) = 'array'
        AND jsonb_array_length(windows) > 0
        AND jsonb_typeof(windows->0) = 'object'
        AND (windows->0) ? 'weekday'
      THEN
        -- formato legado: [{weekday, windows: [...]}] -> achata para [OperatingWindow]
        (SELECT jsonb_agg(w) FROM jsonb_array_elements(windows->0->'windows') AS w)
      ELSE windows
    END
  ) AS item
)
WHERE windows IS NOT NULL;