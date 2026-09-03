-- ARROH continuum-of-care: referrals, multilingual prescriptions, and voice timeline data.

CREATE TABLE IF NOT EXISTS referrals (
    referral_id UUID PRIMARY KEY, patient_id UUID NOT NULL REFERENCES patients(id), origin_phc_id VARCHAR(128) NOT NULL,
    target_facility_id VARCHAR(128) NOT NULL, target_facility_name VARCHAR(255) NOT NULL, target_facility_type VARCHAR(32) NOT NULL,
    referral_priority VARCHAR(16) NOT NULL, reason_for_referral TEXT NOT NULL, required_capabilities JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'INITIATED', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_referrals_patient_id ON referrals (patient_id);

CREATE TABLE IF NOT EXISTS care_prescriptions (
    prescription_id UUID PRIMARY KEY, patient_id UUID NOT NULL REFERENCES patients(id), doctor_id VARCHAR(128) NOT NULL,
    diagnosis TEXT NOT NULL, medications JSONB NOT NULL, language VARCHAR(32) NOT NULL, audio_prescription_script TEXT NOT NULL,
    follow_up_date TIMESTAMPTZ NOT NULL, follow_up_status VARCHAR(32) NOT NULL DEFAULT 'PENDING', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_care_prescriptions_patient_id ON care_prescriptions (patient_id);

ALTER TABLE triage_logs ADD COLUMN IF NOT EXISTS raw_transcript TEXT;
ALTER TABLE triage_logs ADD COLUMN IF NOT EXISTS assessment JSONB;
