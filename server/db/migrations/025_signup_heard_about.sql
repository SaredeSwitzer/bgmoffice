-- Where instructor sign-ups actually come from. Asked on the public /join form so
-- recruiting effort can be pointed at whatever is really working, rather than guessed at.
-- Free text on purpose: the form offers common answers as buttons but lets people type
-- their own, and the useful answers are usually the unexpected ones.
ALTER TABLE instructor_signups
  ADD COLUMN IF NOT EXISTS heard_about_us TEXT;
