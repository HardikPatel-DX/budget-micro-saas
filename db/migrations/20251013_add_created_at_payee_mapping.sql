-- 2025-10-13: add created_at + index for payee_mapping
BEGIN;

-- add created_at if missing
ALTER TABLE IF EXISTS public.payee_mapping
ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- create index (non-concurrent, safe for most migration systems)
CREATE INDEX IF NOT EXISTS idx_payee_mapping_created_at
ON public.payee_mapping (created_at);

COMMIT;
