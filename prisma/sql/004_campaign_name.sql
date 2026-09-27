-- 004_campaign_name.sql
-- Add the campaign name to MarketingMetric.
--
-- Nullable on purpose: existing rows keep working and are shown as "—" in the
-- UI, so there is nothing to backfill.
--
-- Run AFTER the earlier migrations (all touch the same database):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql
--   psql "$DATABASE_URL" -f prisma/sql/004_campaign_name.sql

BEGIN;

ALTER TABLE "MarketingMetric"
  ADD COLUMN IF NOT EXISTS "name" TEXT;

CREATE INDEX IF NOT EXISTS "MarketingMetric_name_idx" ON "MarketingMetric" ("name");

COMMIT;
