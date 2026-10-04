-- 009_user_profile_fields.sql
-- Profile fields for the users table: photo, phone, job title and notes.
--
-- All nullable TEXT, so an existing row needs no backfill and no column has a
-- default that would have to be invented for users created before this ran.
--
-- `avatar` holds a DOWNSIZED PNG data URL (160px longest edge), not the raw
-- upload: /api/users returns the whole team in one response, and a multi-MB
-- base64 photo per member would make that response unreadable. The client
-- downscales before sending (readAvatarFile in src/lib/avatar.ts).
--
-- Run AFTER the earlier migrations (all touch the same database):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql
--   psql "$DATABASE_URL" -f prisma/sql/004_campaign_name.sql
--   psql "$DATABASE_URL" -f prisma/sql/005_client_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/006_follow_up_date.sql
--   psql "$DATABASE_URL" -f prisma/sql/007_marketing_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/008_user_columns.sql
--   psql "$DATABASE_URL" -f prisma/sql/009_user_profile_fields.sql
--
-- Then regenerate the client so TypeScript sees the new columns:
--   npx prisma generate

BEGIN;

ALTER TABLE "AppUser"
  ADD COLUMN IF NOT EXISTS "avatar"   TEXT,
  ADD COLUMN IF NOT EXISTS "phone"    TEXT,
  ADD COLUMN IF NOT EXISTS "jobTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "notes"    TEXT;

COMMIT;