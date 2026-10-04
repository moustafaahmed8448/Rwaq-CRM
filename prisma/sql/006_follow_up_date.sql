-- 006_follow_up_date.sql
-- When each client should next be chased.
--
-- Nullable on purpose: existing rows have no agreed follow-up, and NULL is the
-- only value that can say "not set" — "" would read as a date the user had
-- deliberately cleared to the epoch.
--
-- Kept separate from `operationToTake`, which stays free text describing WHAT to
-- do ("Send updated brochure"). This column is only WHEN.
--
-- IF NOT EXISTS + the index guard make this safe to re-run.
--
-- Run AFTER the earlier migrations (all touch the same database):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql
--   psql "$DATABASE_URL" -f prisma/sql/004_campaign_name.sql
--   psql "$DATABASE_URL" -f prisma/sql/005_client_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/006_follow_up_date.sql
--
-- Then regenerate the client so TypeScript sees the new column:
--   npx prisma generate

BEGIN;

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "nextFollowUpAt" TIMESTAMP(3);

-- Serves the "due / overdue" query, which filters on the date alone and sorts by
-- it. Without this the dashboard card scans the whole book.
CREATE INDEX IF NOT EXISTS "Client_nextFollowUpAt_idx"
  ON "Client"("nextFollowUpAt");

COMMIT;