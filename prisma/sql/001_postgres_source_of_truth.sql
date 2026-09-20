-- Rwaq CRM — upgrade Postgres to be the single source of truth.
--
-- Run this once against the database (Neon / Supabase SQL editor, or `psql`).
-- It is idempotent: running it twice is safe.
--
-- After running this, run:  npx prisma db push     (confirms the schema matches)
--                       then npx prisma db seed    (imports the legacy JSON data)
--
-- Requirements: PostgreSQL 12+ (gen_random_uuid is not used; Prisma supplies ids).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Widen enum columns to plain text.
--    Needed so user-defined channels (e.g. FORSA) and custom statuses (e.g. NEW)
--    can be stored. enum -> text is a lossless widening cast.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Client" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "status" TYPE text USING "status"::text;
UPDATE "Client" SET "status" = 'WAITING' WHERE "status" IS NULL;
ALTER TABLE "Client" ALTER COLUMN "status" SET DEFAULT 'WAITING';
ALTER TABLE "Client" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "Client" ALTER COLUMN "acquisitionChannel" TYPE text USING "acquisitionChannel"::text;
ALTER TABLE "Client" ALTER COLUMN "acquisitionChannel" SET NOT NULL;

ALTER TABLE "MarketingMetric" ALTER COLUMN "channel" TYPE text USING "channel"::text;
ALTER TABLE "MarketingMetric" ALTER COLUMN "channel" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Archive support + activity log + notes on Client.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "notes"       text;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "archived"    boolean NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "archivedAt"   timestamp(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "activityLog" jsonb;

CREATE INDEX IF NOT EXISTS "Client_archived_idx" ON "Client" ("archived");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Marketing metrics: clicks, notes, and a text primary key.
--    Metric ids in this app look like 'm2' / 'm-1789688514891', so the id column
--    cannot stay uuid. uuid -> text is lossless.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "MarketingMetric" ALTER COLUMN "id" TYPE text USING "id"::text;
ALTER TABLE "MarketingMetric" ADD COLUMN IF NOT EXISTS "clicks" integer NOT NULL DEFAULT 0;
ALTER TABLE "MarketingMetric" ADD COLUMN IF NOT EXISTS "notes"  text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Application users (replaces data/rwaq-users.json).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AppUser" (
    "id"        uuid        NOT NULL,
    "username"  text        NOT NULL,
    "name"      text        NOT NULL,
    "email"     text,
    "role"      text        NOT NULL DEFAULT 'Sales',
    "hash"      text        NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL,
    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_username_key" ON "AppUser" ("username");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Notifications (replaces data/rwaq-notifications.json).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Notification" (
    "id"         uuid         NOT NULL,
    "recipient"  text         NOT NULL,
    "type"       text         NOT NULL,
    "message"    text         NOT NULL,
    "clientId"   text,
    "clientName" text,
    "read"       boolean      NOT NULL DEFAULT false,
    "createdAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_recipient_read_idx" ON "Notification" ("recipient", "read");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx"      ON "Notification" ("createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Settings key/value store (replaces rwaq-channels.json,
--    rwaq-custom-statuses.json, rwaq-locations.json).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Setting" (
    "key"       text         NOT NULL,
    "value"     jsonb        NOT NULL,
    "updatedAt" timestamp(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

COMMIT;
