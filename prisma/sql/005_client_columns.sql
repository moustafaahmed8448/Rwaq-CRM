-- 005_client_columns.sql
-- Per-user layout for the clients table: column widths and visibility.
--
-- JSONB so one column holds the whole layout and adding a new field later needs
-- no migration. Nullable on purpose: existing users keep the defaults until they
-- save a layout, and a NULL simply means "defaults".
--
-- Shape (sparse — absent keys fall back to the registry defaults):
--   { "project": { "w": 220 }, "location": { "hidden": true } }
--
-- Run AFTER the earlier migrations (all touch the same database):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql
--   psql "$DATABASE_URL" -f prisma/sql/004_campaign_name.sql
--   psql "$DATABASE_URL" -f prisma/sql/005_client_columns.sql

BEGIN;

ALTER TABLE "AppUser"
  ADD COLUMN IF NOT EXISTS "clientColumns" JSONB;

COMMIT;
