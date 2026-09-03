-- ARROH Phase 3: retain the PHC which submitted a synced patient observation.
-- This enables facility-specific inventory demand forecasting from sync logs.

ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS current_phc_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS ix_patients_current_phc_id ON patients (current_phc_id);
