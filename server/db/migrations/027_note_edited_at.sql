-- Notes can be edited now (typo, wrong number, "actually she said Tuesday"), and a note
-- that's been changed says so rather than quietly reading as what was written at the time.
ALTER TABLE waiting_sheet_notes ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE waiting_on_notes   ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE reminder_notes     ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE sales_lead_notes   ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE instructor_notes   ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE recruiting_notes   ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE class_notes        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE admin_notes        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
