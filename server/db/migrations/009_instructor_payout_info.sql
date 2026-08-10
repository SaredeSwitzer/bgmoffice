-- 009 — Where/how each instructor wants to be paid, so it's on their profile instead of
-- scattered across old texts. Purely a reference field — the app still doesn't move money;
-- staff still pay by hand (Zelle/Venmo/PayPal), this just removes the "what's their handle
-- again?" lookup every week.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE instructors ADD COLUMN IF NOT EXISTS payout_method TEXT;  -- 'Zelle' | 'Venmo' | 'PayPal' | 'Check' | 'Cash' | 'Other'
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS payout_handle TEXT;  -- their @handle / email / phone for that method
