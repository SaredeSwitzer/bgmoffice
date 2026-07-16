-- 006 — Instructor confirmation email
-- When a class is set up with an instructor, staff send the instructor a confirmation email
-- (client, day/time, rate, etc.) from a saved template. This tracks when it was sent, and
-- seeds an editable default template into app_settings. Run: node server/db/migrate.js (re-runnable)

ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;
ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS confirmation_sent_to TEXT;

-- Editable template (staff can change the wording in Settings). Placeholders in {curly braces}
-- are filled from the class: {instructor_name} {client_name} {day} {time} {location} {style}
-- {rate}. Seeded only if absent, so re-running never overwrites Sarede's edited copy.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('instructor_confirm_subject',
   'Class confirmation — {client_name} ({day})',
   to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, updated_at) VALUES
  ('instructor_confirm_body',
   E'Hi {instructor_name},\n\nThank you for taking on this class with Bring the Gym to Me. Here are the details:\n\nClient: {client_name}\nDay: {day}\nTime: {time}\nLocation: {location}\nStyle: {style}\nYour rate: {rate} per class\n\nPlease reply to confirm you received this, and let us know if you have any questions.\n\nThank you,\nBring the Gym to Me',
   to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT (key) DO NOTHING;
