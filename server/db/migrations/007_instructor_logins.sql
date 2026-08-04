-- 007_instructor_logins.sql
--
-- Instructor logins, step 1: let a user account point at an instructor record and
-- allow role = 'instructor'. Additive only — no existing row is read or modified,
-- and admin/staff behaviour is unchanged (instructor_id stays NULL for them).
--
-- Re-runnable, like every other file here: migrate.js replays all of them each run.
--
-- NOTE: this migration only makes instructor accounts *possible*. It deliberately
-- creates none. Nothing may hand out an instructor login until the deny-by-default
-- guard is in place — today every route is a blanket requireAuth, so an instructor
-- account without that guard can read and write all client, pay and billing data.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS instructor_id BIGINT
  REFERENCES public.instructors(id) ON DELETE SET NULL;

-- One account per instructor. Partial, because admin/staff rows are all NULL here
-- and a plain UNIQUE would still allow only one NULL on some engines.
CREATE UNIQUE INDEX IF NOT EXISTS users_instructor_id_uniq
  ON public.users (instructor_id) WHERE instructor_id IS NOT NULL;

-- role was CHECK (role IN ('admin','staff')). Drop-then-add so a re-run is clean.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'staff'::text, 'instructor'::text]));

-- An instructor-role account with no linked instructor must never resolve to
-- "all sessions". The API is required to reject it; this is the matching DB-side
-- guarantee so the pair can't drift apart.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_instructor_link_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_instructor_link_check
  CHECK (role <> 'instructor' OR instructor_id IS NOT NULL);
