-- ARROH: append-only clinical observation history for audit and inventory demand signals.

CREATE TABLE IF NOT EXISTS triage_logs (
    id UUID PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES patients(id),
    phc_id VARCHAR(128),
    triage_status triage_status NOT NULL,
    vitals JSONB,
    symptoms JSONB,
    source VARCHAR(32) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_triage_logs_patient_id ON triage_logs (patient_id);
CREATE INDEX IF NOT EXISTS ix_triage_logs_phc_id ON triage_logs (phc_id);
CREATE INDEX IF NOT EXISTS ix_triage_logs_observed_at ON triage_logs (observed_at);
