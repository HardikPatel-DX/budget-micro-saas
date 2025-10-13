# Database migrations

Migrations go in `db/migrations/` as SQL files. Each file should be idempotent when possible (use `IF NOT EXISTS`) and include a short header explaining the purpose and date.

Example: `20251013_add_created_at_payee_mapping.sql`
This migration:
- Adds `created_at timestamptz DEFAULT now()` to `public.payee_mapping` (if missing)
- Creates index `idx_payee_mapping_created_at` (if missing)
- Was applied manually in Supabase and the migration file has been added to the repo.

Deployment guidance:
- Prefer running migrations via CI/deploy pipeline (Supabase CLI, a migration tool, or `psql`) so production/staging and repo are always in sync.
- If a migration has already been applied manually, keep the migration file in the repo (idempotent) and mark it in the PR description that it was applied.
- When reviewing migrations, check for `IF NOT EXISTS` and that indexes are non-blocking or using `CONCURRENTLY` where appropriate (and supported by your migration runner).

Reviewer checklist:
- [ ] Migration file present in `db/migrations/`
- [ ] Migration is idempotent / safe to run
- [ ] CI or deployment pipeline will run migrations on merge
