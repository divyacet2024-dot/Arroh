-- ARROH complete platform: optional demographic field used by voice-assisted intake.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS village VARCHAR(120);
CREATE INDEX IF NOT EXISTS ix_patients_village ON patients (village);
