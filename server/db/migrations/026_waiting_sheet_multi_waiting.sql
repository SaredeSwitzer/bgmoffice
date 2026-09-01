-- The ball can be with more than one person on a line: sometimes we're waiting on the
-- instructor for one thing and the client for another, and both matter. The flag moves
-- off the row (one person) onto each person (any number of them).
ALTER TABLE waiting_sheet_people ADD COLUMN IF NOT EXISTS waiting BOOLEAN NOT NULL DEFAULT false;

UPDATE waiting_sheet_people p
   SET waiting = true
  FROM waiting_sheet_rows r
 WHERE r.id = p.row_id AND r.waiting_on_id = p.id;
