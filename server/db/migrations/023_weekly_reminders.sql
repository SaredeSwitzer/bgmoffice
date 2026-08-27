-- 023 — support for weekly reminder texts moving out of Amber's Google Voice automation
-- and into the app (server/routes/sms.js weekly-reminders).
--
-- Amber's gen_reminders_bgmoffice.mjs carried a hardcoded SKIP_CLIENTS list and a
-- PHONE_OVERRIDE map. Both were workarounds for wrong data rather than real rules, so the
-- skip list becomes a column staff can toggle, and the phone corrections are applied to
-- the records themselves (two clients had no phone at all; HaMaspik had two numbers
-- concatenated into one field).
-- Run with: node server/db/migrate.js   (safe to re-run)

ALTER TABLE clients ADD COLUMN IF NOT EXISTS skip_weekly_reminder BOOLEAN NOT NULL DEFAULT false;

UPDATE clients SET skip_weekly_reminder = true
 WHERE lower(name) IN ('montessori school of ny','connections (formerly borough park senior center)');

UPDATE clients SET phone = '929-969-6178'
 WHERE lower(name) = 'hamaspik - charny schonfeld' AND regexp_replace(COALESCE(phone,''),'\D','','g') <> '9299696178';
UPDATE clients SET phone = '727-776-2999', contact_person_name = COALESCE(contact_person_name,'Chaya Mushka Hodokov')
 WHERE lower(name) = 'friendship circle upper east side' AND COALESCE(phone,'') = '';
UPDATE clients SET phone = '914-362-0028', contact_person_name = COALESCE(contact_person_name,'Muka Pewzner')
 WHERE lower(name) = 'friendship circle of central new jersey - manalapan' AND COALESCE(phone,'') = '';
