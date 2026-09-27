-- 002_client_numeric_ids.sql
-- Replace uuid client ids with sequential numbers (1, 2, 3, …) ordered by
-- creation date, and repoint Notification.clientId at the new ids.
--
-- Idempotent: the whole block skips when no non-numeric ids remain, so it is
-- safe to re-run. There is no foreign key on "Notification"."clientId"
-- (plain text column), so only value updates are required.
--
-- Run once against the app database:
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql

BEGIN;

DO $$
DECLARE
  _needs_migration boolean;
  _renumbered      bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "Client" WHERE id !~ '^[0-9]+$'
  ) INTO _needs_migration;

  IF NOT _needs_migration THEN
    RAISE NOTICE 'Client ids are already numeric - nothing to do';
    RETURN;
  END IF;

  -- old id -> final numeric id (creation order, ties broken by current id text)
  CREATE TEMP TABLE _client_id_map ON COMMIT DROP AS
    SELECT
      c.id AS old_id,
      (row_number() OVER (ORDER BY c."createdAt" ASC, c.id))::text AS new_id
    FROM "Client" c;

  -- 1) Repoint notifications while the old ids are still valid.
  UPDATE "Notification" n
     SET "clientId" = m.new_id
    FROM _client_id_map m
   WHERE n."clientId" = m.old_id;

  -- 2) Park every client on a unique non-numeric placeholder first.
  --    In a mixed state (some rows already numeric) final numbers could
  --    collide with live ids mid-update; placeholders cannot.
  UPDATE "Client" c
     SET id = 'p_' || m.new_id
    FROM _client_id_map m
   WHERE c.id = m.old_id;

  -- 3) Rename placeholders to the final sequential numbers.
  UPDATE "Client" c
     SET id = m.new_id
    FROM _client_id_map m
   WHERE c.id = 'p_' || m.new_id;

  GET DIAGNOSTICS _renumbered = ROW_COUNT;
  RAISE NOTICE 'renumbered % client ids to sequential numbers', _renumbered;
END $$;

COMMIT;
