-- 003_six_stage_pipeline.sql
-- Move the client status column from the old 3-state model (WAITING / WON /
-- LOST) to the 6-stage pipeline:
--
--   NO_RESPONSE  Non-responsive
--   CONTACTED    Contacted
--   QUALIFIED    Qualified
--   QUOTES       Sales to contact & quote
--   WON          Contracted        (unchanged value, relabelled)
--   LOST         Final loss        (unchanged value, relabelled)
--
-- WON and LOST keep their stored values on purpose: every win-rate, CPA and ROI
-- calculation keys off them, so leaving them alone means no history is lost and
-- no dashboard number changes.
--
-- WAITING is the only real remap. It becomes NO_RESPONSE, the first stage —
-- clients that had not yet been worked are exactly the "non-responsive" bucket.
-- If you would rather place them elsewhere, change the target below BEFORE
-- running; the script is idempotent either way.
--
-- Run AFTER 002_client_numeric_ids.sql (both touch "Client"):
--   psql "$DATABASE_URL" -f prisma/sql/002_client_numeric_ids.sql
--   psql "$DATABASE_URL" -f prisma/sql/003_six_stage_pipeline.sql

BEGIN;

DO $$
DECLARE
  _moved bigint;
BEGIN
  UPDATE "Client" SET status = 'NO_RESPONSE' WHERE status = 'WAITING';
  GET DIAGNOSTICS _moved = ROW_COUNT;
  RAISE NOTICE 'Moved % client(s) from WAITING to NO_RESPONSE', _moved;
END $$;

-- Any status outside the pipeline (user-defined custom statuses) is preserved
-- untouched; the UI falls back to a neutral badge for those.
DO $$
DECLARE
  _unknown text;
BEGIN
  SELECT string_agg(DISTINCT status, ', ') INTO _unknown
  FROM "Client"
  WHERE status NOT IN ('NO_RESPONSE','CONTACTED','QUALIFIED','QUOTES','WON','LOST')
    AND status IS NOT NULL;
  IF _unknown IS NOT NULL THEN
    RAISE NOTICE 'Custom statuses preserved as-is: %', _unknown;
  END IF;
END $$;

COMMIT;
