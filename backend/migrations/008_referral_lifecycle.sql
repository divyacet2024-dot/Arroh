-- Referral lifecycle foundation. Production deployments should apply this
-- through the project's future Alembic migration process; development SQLite
-- uses Base.metadata.create_all plus the startup compatibility check.

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS specialty_service VARCHAR(128);
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS local_uuid VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS ix_referrals_local_uuid ON referrals (local_uuid);

CREATE TABLE IF NOT EXISTS referral_transitions (
    id UUID PRIMARY KEY,
    referral_id UUID NOT NULL REFERENCES referrals(referral_id),
    from_status VARCHAR(32) NOT NULL,
    to_status VARCHAR(32) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    reason TEXT,
    notes TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_referral_transitions_referral_occurred
    ON referral_transitions (referral_id, occurred_at);

CREATE TABLE IF NOT EXISTS referral_timeline_events (
    id UUID PRIMARY KEY,
    referral_id UUID NOT NULL REFERENCES referrals(referral_id),
    event_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_referral_timeline_events_referral_occurred
    ON referral_timeline_events (referral_id, occurred_at);