-- 021 — group neighborhoods under a borough/area heading, so the picker reads as
-- "BROOKLYN: Crown Heights, Williamsburg…" instead of one long alphabetical run.
-- The bare borough entries ("Brooklyn", "Manhattan") stay selectable under their own
-- heading — that's how an instructor says "anywhere in the borough" — and existing
-- instructor records already hold those exact strings, so renaming them would orphan data.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS region TEXT;

UPDATE neighborhoods SET region = 'Brooklyn' WHERE name IN
  ('Brooklyn','Bed-Stuy','Borough Park','Clinton Hill','Crown Heights','East Flatbush','Flatbush','Park Slope','Williamsburg');
UPDATE neighborhoods SET region = 'Manhattan' WHERE name IN
  ('Manhattan','Harlem','Midtown East','Upper East Side','Upper West Side');
UPDATE neighborhoods SET region = 'Queens' WHERE name = 'Queens';
UPDATE neighborhoods SET region = 'Bronx' WHERE name = 'Bronx';
UPDATE neighborhoods SET region = 'Staten Island' WHERE name = 'Staten Island';
UPDATE neighborhoods SET region = 'Westchester & Upstate' WHERE name IN
  ('New Rochelle','Monroe','Harriman','Fallsburg','White Lake / Catskills');
UPDATE neighborhoods SET region = 'Long Island' WHERE name = 'Roslyn Heights';
UPDATE neighborhoods SET region = 'Other' WHERE region IS NULL;
