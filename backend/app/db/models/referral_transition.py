"""Durable referral lifecycle transitions and referral timeline events."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ReferralTransition(Base):
    """Immutable record of one accepted referral status transition."""

    __tablename__ = "referral_transitions"
    __table_args__ = (
        Index("ix_referral_transitions_referral_occurred", "referral_id", "occurred_at"),
        Index("ix_referral_transitions_idempotency_key", "idempotency_key", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    referral_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("referrals.referral_id"), nullable=False, index=True)
    from_status: Mapped[str] = mapped_column(String(32), nullable=False)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)

    referral: Mapped["Referral"] = relationship("Referral")


class ReferralTimelineEvent(Base):
    """Durable referral event retained independently of current referral status."""

    __tablename__ = "referral_timeline_events"
    __table_args__ = (Index("ix_referral_timeline_events_referral_occurred", "referral_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    referral_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("referrals.referral_id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    referral: Mapped["Referral"] = relationship("Referral")
