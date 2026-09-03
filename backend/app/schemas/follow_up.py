"""Pydantic contracts for follow-up lifecycle APIs."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

FollowUpStatus = Literal["SCHEDULED", "DUE", "IN_PROGRESS", "COMPLETED", "RESCHEDULED", "MISSED", "CANCELLED"]
ActorRole = Literal["ASHA", "ANM", "DOCTOR", "NURSE", "SYSTEM", "ADMIN"]


class FollowUpCreateSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    follow_up_type: str = Field(min_length=1, max_length=64)
    due_at: datetime
    priority: str = Field(default="ROUTINE", min_length=1, max_length=16)
    high_risk: bool = False
    notes: str | None = Field(default=None, max_length=4000)
    source_reference: str | None = Field(default=None, max_length=255)
    local_uuid: str | None = Field(default=None, max_length=128)


class FollowUpReadSchema(FollowUpCreateSchema):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime
    linked_task_id: uuid.UUID | None = None
    next_allowed_transitions: list[str] = Field(default_factory=list)


class FollowUpTransitionRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_status: FollowUpStatus
    actor_id: str = Field(min_length=1, max_length=128)
    actor_role: ActorRole
    reason: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    idempotency_key: str = Field(min_length=1, max_length=255)


class FollowUpTransitionReadSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    follow_up_id: uuid.UUID
    from_status: str
    to_status: str
    actor_id: str
    actor_role: str
    reason: str | None
    notes: str | None
    occurred_at: datetime
    idempotency_key: str


class FollowUpTransitionResponseSchema(BaseModel):
    follow_up: FollowUpReadSchema
    previous_status: str
    current_status: str
    transition: FollowUpTransitionReadSchema
    next_allowed_transitions: list[str]


class FollowUpDueResponseSchema(BaseModel):
    due: list[FollowUpReadSchema]
    overdue: list[FollowUpReadSchema]
