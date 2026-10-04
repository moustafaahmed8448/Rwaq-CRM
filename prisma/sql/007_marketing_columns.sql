-- 007_marketing_columns.sql
-- Per-user layout for the marketing metrics table: column widths and visibility.
--
-- Same shape and reasoning as 005_client_columns.sql (sparse JSONB, NULL means
-- "defaults"), but a SEPARATE column from `clientColumns`.
--
-- Separate because the two tables have unrelated column sets. Sharing one blob
-- would mean a marketing column could collide with a clients column of the same
-- key, and resizing one table would rewrite the other table's layout.
--
-- Run AFTER the earlier migrations (all touch the same database):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql
--   psql "$DATABASE_URL" -f prisma/sql/004_campaign_name.sql
--   psql "$DATABASE_URL" -f prisma/sql/005_client_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/006_follow_up_date.sql
--   psql "$DATABASE_URL" -f prisma/sql/007_marketing_columns.sql
--
-- Then regenerate the client so TypeScript sees the new column:
--   npx prisma generate

BEGIN;

ALTER TABLE "AppUser"
  ADD COLUMN IF NOT EXISTS "marketingColumns" JSONB;

COMMIT;