-- Clients who have asked us not to text them at all.
--
-- skip_weekly_reminder already existed but only covered the weekly reminder run, so a
-- client who did not want texts still got class confirmations and change alerts. Somebody
-- had resorted to renaming a client "… - DO NOT TEXT" to warn staff off, which is the
-- clearest possible sign the setting people needed did not exist.
--
-- Kept as a separate column rather than renaming the old one: Amber reads this API too.
-- The two are written together from the profile, and every send path checks no_texting.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS no_texting BOOLEAN NOT NULL DEFAULT false;

-- Both clients carrying the old flag were genuine do-not-text cases.
UPDATE clients SET no_texting = true WHERE skip_weekly_reminder = true;
