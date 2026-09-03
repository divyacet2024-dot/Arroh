-- ARROH Phase 2: forward-only PostgreSQL migration for offline synchronization.
-- Apply through the deployment migration runner before enabling /api/v1/sync.

ALTER TABLE patients ALTER COLUMN abha_id DROP NOT NULL;

ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS offline_client_uuid UUID,
    ADD COLUMN IF NOT EXISTS last_offline_timestamp TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS vitals JSONB,
    ADD COLUMN IF NOT EXISTS symptoms JSONB;

CREATE INDEX IF NOT EXISTS ix_patients_phone_number ON patients (phone_number);
CREATE INDEX IF NOT EXISTS ix_patients_last_offline_timestamp ON patients (last_offline_timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_offline_client_uuid
    ON patients (offline_client_uuid)
    WHERE offline_client_uuid IS NOT NULL;
