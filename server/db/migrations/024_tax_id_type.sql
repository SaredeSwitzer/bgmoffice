-- Some instructors are incorporated and file under an EIN rather than a personal SSN.
-- The number itself keeps living in the existing ssn/ssn_encrypted/ssn_last4 columns
-- (same shape, same encryption, same reveal path) — this column only records which kind
-- of number it is, so the app can label and mask it correctly. 'ssn' is the default
-- because every row that predates this migration was collected as an SSN.
ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS tax_id_type TEXT NOT NULL DEFAULT 'ssn'
  CHECK (tax_id_type IN ('ssn', 'ein'));

ALTER TABLE instructor_contract_signatures
  ADD COLUMN IF NOT EXISTS tax_id_type TEXT NOT NULL DEFAULT 'ssn'
  CHECK (tax_id_type IN ('ssn', 'ein'));
