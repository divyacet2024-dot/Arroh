-- Typed offline sync entity storage. Development SQLite creates these via ORM
-- metadata; production migration management should apply this DDL explicitly.

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS local_uuid VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS ix_referrals_local_uuid ON referrals (local_uuid);
ALTER TABLE case_sessions ADD COLUMN IF NOT EXISTS local_uuid VARCHAR(128);

CREATE TABLE IF NOT EXISTS offline_visits (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) NOT NULL UNIQUE,
    patient_local_uuid VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_offline_visits_patient_local_uuid ON offline_visits (patient_local_uuid);

CREATE TABLE IF NOT EXISTS offline_tasks (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) NOT NULL UNIQUE,
    patient_local_uuid VARCHAR(128),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_offline_tasks_patient_local_uuid ON offline_tasks (patient_local_uuid);

CREATE TABLE IF NOT EXISTS offline_follow_ups (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) NOT NULL UNIQUE,
    patient_local_uuid VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_offline_follow_ups_patient_local_uuid ON offline_follow_ups (patient_local_uuid);

CREATE TABLE IF NOT EXISTS offline_sync_errors (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    error TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_offline_sync_errors_local_uuid ON offline_sync_errors (local_uuid);

CREATE TABLE IF NOT EXISTS follow_ups (
    id UUID PRIMARY KEY,
    local_uuid VARCHAR(128) UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id),
    follow_up_type VARCHAR(64) NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    priority VARCHAR(16) NOT NULL DEFAULT 'ROUTINE',
    high_risk BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    source_reference VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_follow_ups_patient_id ON follow_ups (patient_id);
CREATE INDEX IF NOT EXISTS ix_follow_ups_due_at ON follow_ups (due_at);

CREATE TABLE IF NOT EXISTS follow_up_transitions (
    id UUID PRIMARY KEY,
    follow_up_id UUID NOT NULL REFERENCES follow_ups(id),
    from_status VARCHAR(32) NOT NULL,
    to_status VARCHAR(32) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    reason TEXT,
    notes TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_follow_up_transitions_follow_up ON follow_up_transitions (follow_up_id, occurred_at);

CREATE TABLE IF NOT EXISTS follow_up_tasks (
    id UUID PRIMARY KEY,
    follow_up_id UUID NOT NULL UNIQUE REFERENCES follow_ups(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    task_type VARCHAR(64) NOT NULL DEFAULT 'HOME_VISIT',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    priority VARCHAR(16) NOT NULL DEFAULT 'ROUTINE',
    assigned_worker_id VARCHAR(128),
    due_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS follow_up_timeline_events (
    id UUID PRIMARY KEY,
    follow_up_id UUID NOT NULL REFERENCES follow_ups(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    task_id UUID REFERENCES follow_up_tasks(id),
    event_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_follow_up_events_patient_occurred ON follow_up_timeline_events (patient_id, occurred_at);
