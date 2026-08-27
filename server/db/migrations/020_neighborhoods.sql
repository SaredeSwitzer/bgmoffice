-- 020 — canonical neighborhood list, same shape/purpose as class_styles: a shared option
-- list that any picker across the app can read, and that grows itself when someone (e.g.
-- a New York instructor on the public /join sign-up page) types one that isn't there yet.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS neighborhoods (
  id   BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

ALTER TABLE neighborhoods ENABLE ROW LEVEL SECURITY;

-- Seed with the clean, legitimate-looking NY-area neighborhoods already in use across
-- clients/instructors (hand-picked — the raw distinct values include stray full street
-- addresses and out-of-state entries not worth carrying into a canonical list).
INSERT INTO neighborhoods (name) VALUES
  ('Manhattan'), ('Brooklyn'), ('Bronx'), ('Queens'), ('Staten Island'),
  ('Upper East Side'), ('Upper West Side'), ('Midtown East'), ('Harlem'),
  ('Williamsburg'), ('Crown Heights'), ('Borough Park'), ('East Flatbush'),
  ('Bed-Stuy'), ('Clinton Hill'), ('Park Slope'), ('Flatbush'),
  ('New Rochelle'), ('Monroe'), ('Harriman'), ('Roslyn Heights'),
  ('Fallsburg'), ('White Lake / Catskills')
ON CONFLICT (name) DO NOTHING;
