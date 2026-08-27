-- 022 — relabel the bare borough entries as "Anywhere in <borough>".
-- The bare entry means "I'll travel anywhere in this borough", which the label didn't
-- say — and sitting under a heading of the same name it just read as a duplicate.
-- Run with: node server/db/migrate.js   (safe to re-run: the WHERE no longer matches once applied)

UPDATE neighborhoods SET name = 'Anywhere in ' || name
 WHERE name IN ('Brooklyn','Manhattan','Queens','Bronx','Staten Island');

-- Carry the instructors already holding the old value across. Clients are deliberately
-- left alone: a client sits at one address, so "Anywhere in Manhattan" would be wrong
-- there, and the client screens don't read this option list anyway.
UPDATE instructors SET neighborhood = 'Anywhere in ' || neighborhood
 WHERE neighborhood IN ('Brooklyn','Manhattan','Queens','Bronx','Staten Island');
