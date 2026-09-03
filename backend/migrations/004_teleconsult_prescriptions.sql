-- ARROH Phase 4: durable FHIR MedicationRequest projection for prescriptions.

CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES patients(id),
    prescriber_id VARCHAR(128) NOT NULL,
    medication_code VARCHAR(100) NOT NULL,
    medication_display VARCHAR(255) NOT NULL,
    dosage_instruction TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    intent VARCHAR(32) NOT NULL DEFAULT 'order',
    authored_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_prescriptions_patient_id ON prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS ix_prescriptions_prescriber_id ON prescriptions (prescriber_id);
