-- 008_user_columns.sql
-- Per-user layout for the users table: column widths and visibility.
--
-- Same shape and reasoning as 005_client_columns.sql / 007_marketing_columns.sql
-- (sparse JSONB, NULL means "defaults"), but a SEPARATE column again.
--
-- Separate because `role` and `username` are users-table keys that the clients
-- and marketing registries do not know, so a shared blob would have those widths
-- stripped by the wrong sanitizer on the way back out.
--
-- Run AFTER the earlier migrations (all touch the same database):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql
--   psql "$DATABASE_URL" -f prisma/sql/004_campaign_name.sql
--   psql "$DATABASE_URL" -f prisma/sql/005_client_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/006_follow_up_date.sql
--   psql "$DATABASE_URL" -f prisma/sql/007_marketing_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/008_user_columns.sql
--
-- Then regenerate the client so TypeScript sees the new column:
--   npx prisma generate

BEGIN;

ALTER TABLE "AppUser"
  ADD COLUMN IF NOT EXISTS "userColumns" JSONB;

COMMIT;