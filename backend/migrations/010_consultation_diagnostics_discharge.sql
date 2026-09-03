-- Step 6 doctor consultation, diagnostics, and discharge records.
-- Development SQLite creates these tables from SQLAlchemy metadata; production
-- deployments should apply this migration through the future migration process.

CREATE TABLE IF NOT EXISTS consultations (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id),
    referral_id UUID REFERENCES referrals(referral_id),
    doctor_id VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'STARTED',
    chief_complaint TEXT,
    history TEXT,
    findings TEXT,
    vitals JSONB NOT NULL DEFAULT '{}'::jsonb,
    assessment TEXT,
    clinical_impression TEXT,
    treatment_plan TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_consultations_patient_started ON consultations (patient_id, started_at);

CREATE TABLE IF NOT EXISTS diagnostic_requests (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) UNIQUE,
    consultation_id UUID NOT NULL REFERENCES consultations(id),
    investigation_name VARCHAR(255) NOT NULL,
    indication TEXT,
    requested_by VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diagnostic_results (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) UNIQUE,
    investigation_id UUID NOT NULL REFERENCES diagnostic_requests(id),
    result_value TEXT NOT NULL,
    units VARCHAR(64),
    reference_range VARCHAR(128),
    performed_at TIMESTAMPTZ NOT NULL,
    verified_by VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discharge_plans (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) UNIQUE,
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations(id),
    doctor_id VARCHAR(128) NOT NULL,
    diagnosis TEXT NOT NULL,
    treatment_instructions TEXT NOT NULL,
    medication_instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
    activity_diet_instructions TEXT,
    warning_signs JSONB NOT NULL DEFAULT '[]'::jsonb,
    emergency_return_instructions TEXT NOT NULL,
    follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
    follow_up_due_at TIMESTAMPTZ,
    referral_instructions TEXT,
    authored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(24) NOT NULL DEFAULT 'SIGNED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultation_timeline_events (
    id UUID PRIMARY KEY,
    consultation_id UUID NOT NULL REFERENCES consultations(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    event_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_id VARCHAR(128),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_consultation_events_patient_occurred ON consultation_timeline_events (patient_id, occurred_at);

ALTER TABLE care_prescriptions ADD COLUMN IF NOT EXISTS consultation_id UUID REFERENCES consultations(id);
