-- 006 — Instructor confirmation email
-- When a class is set up with an instructor, staff send the instructor a confirmation email
-- (client, day/time, rate, etc.) from a saved template. This tracks when it was sent, and
-- seeds an editable default template into app_settings. Run: node server/db/migrate.js (re-runnable)

ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;
ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS confirmation_sent_to TEXT;

-- Editable template (staff can change the wording in Settings). Placeholders in {curly braces}
-- are filled from the class: {instructor_name} {client_name} {day} {time} {location} {style}
-- {rate}. Seeded only if absent, so re-running never overwrites Sarede's edited copy.
-- This mirrors Sarede's REAL "Class Confirmation - to INSTRUCTOR" template (from her Google Doc),
-- with Shiftboard references replaced by "our system (BGM Office)". Fields the app doesn't store
-- (participant count/age, address) are left blank for staff to fill when reviewing before send.
-- Dollar-quoted ($body$) so apostrophes/newlines need no escaping.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('instructor_confirm_subject',
   'Class Confirmation - {style} - {client_name}',
   to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, updated_at) VALUES
  ('instructor_confirm_body',
   $body$Hi {instructor_name},

{client_name} is looking forward to having you teach this class. Here is all the info you need for this class. Please let me know if you have any questions.

You can also see this class any time in our system (BGM Office). Please let us know asap if you notice anything here that doesn't match what you expected.

The info for the class:

Day/Time: {day} at {time}

Style of Class: {style}

Number of Participants:
Age of Participants:

Any other info/requirements:

Neighborhood: {location}
Address:

Rate: {rate}

Please check google maps to make sure you know how to get to the location of your class and how much time it will take you to get there, and plan on arriving a few minutes early, especially if this is a newer/unfamiliar location for you.

IMPORTANT NOTE: If the client asks you for your phone number for whatever reason (i.e. in case they will be running late next time or anything else), do not give it to them but rather tell them that they should call or text (347)915-5496 for anything they need or any questions that they have.

ANOTHER IMPORTANT NOTE: Please check your schedule in our system (BGM Office) regularly to keep track of the classes you have with us. If you ever notice a discrepancy between what you see there and what you think your schedule is, please contact us ASAP to clarify via text at (347)915-5496.

We will be in touch with you after this class to see how it went, both from your and the client's end.

Please note, this email serves as a confirmation that you are set to teach this class. If you need to cancel for whatever reason, you must provide at least 24 hour notice, otherwise you will be obligated to give a free makeup class, as per your instructor contract.

How You Get Paid:

Payments are sent via Zelle, Chase Quick Pay every Tuesday for the previous week's classes (our pay weeks run Sunday - Saturday) so long as both the Time Cards/Clocks and $ requests are sent in by Friday of the previous week.

Please send a money request via Zelle, Venmo or Paypal on Sundays for all classes you taught the previous week. Only send one request for all classes, not individual requests for each class.

For Zelle: Please send $ to admin@bringthegymtome.com
For Venmo: Please send $ request to @bringthegymtome
For Paypal: Please send $ request to info@bringthegymtome.com

Additionally, if you have any fitness instructor friends who are looking for more work, please send them our way. We are constantly looking to expand our network of instructors and have many opportunities available.

Good luck with the class!$body$,
   to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT (key) DO NOTHING;
