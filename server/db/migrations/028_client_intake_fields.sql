-- Two answers the intake form asks for that had nowhere to live on a client, so they were
-- being flattened into free-text notes: who sent them to us, and whether the class is for
-- men or women (which decides who can teach it).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS gender TEXT;
