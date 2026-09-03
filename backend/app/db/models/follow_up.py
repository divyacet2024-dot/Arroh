"""Durable follow-up lifecycle, history, and community-task records."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class FollowUp(Base):
    __tablename__ = "follow_ups"
    __table_args__ = (Index("ix_follow_ups_source_reference", "source_reference", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    follow_up_type: Mapped[str] = mapped_column(String(64), nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SCHEDULED", index=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="ROUTINE")
    high_risk: Mapped[bool] = mapped_column(default=False, nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class FollowUpTransition(Base):
    __tablename__ = "follow_up_transitions"
    __table_args__ = (Index("ix_follow_up_transitions_follow_up_occurred", "follow_up_id", "occurred_at"), Index("ix_follow_up_transitions_idempotency", "idempotency_key", unique=True))

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    follow_up_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("follow_ups.id"), nullable=False, index=True)
    from_status: Mapped[str] = mapped_column(String(32), nullable=False)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)


class FollowUpTask(Base):
    __tablename__ = "follow_up_tasks"
    __table_args__ = (Index("ix_follow_up_tasks_follow_up", "follow_up_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    follow_up_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("follow_ups.id"), nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    task_type: Mapped[str] = mapped_column(String(64), nullable=False, default="HOME_VISIT")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="ROUTINE")
    assigned_worker_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class FollowUpTimelineEvent(Base):
    __tablename__ = "follow_up_timeline_events"
    __table_args__ = (Index("ix_follow_up_events_patient_occurred", "patient_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    follow_up_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("follow_ups.id"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("follow_up_tasks.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
