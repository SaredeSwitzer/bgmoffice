-- Most referrals come from another client, and "Referred by Baila Gutman" typed as text
-- can't be clicked, counted, or thanked. When the referrer is someone we already have,
-- point at their record; free text still works for everyone else.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by_client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS clients_referred_by_client_idx ON clients (referred_by_client_id);
