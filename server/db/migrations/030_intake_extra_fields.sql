-- Answers the intake asks for that the records had nowhere to keep.
--
-- On the client, because they stay true between classes and the next instructor needs
-- them: what they want out of it, anything about their health, and what equipment they
-- already own (so nobody turns up expecting mats that aren't there).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS goals TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS health_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS equipment TEXT;

-- On the entry, because they're about staffing this particular class: what time of day
-- suits them beyond the day itself, and what we're paying whoever takes it.
ALTER TABLE recruiting_entries ADD COLUMN IF NOT EXISTS time_preference TEXT;
ALTER TABLE recruiting_entries ADD COLUMN IF NOT EXISTS instructor_rate TEXT;
