"""Request and response schemas for the ARROH auth endpoints."""

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Loose, dependency-free email shape check (avoids pulling in email-validator).
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class RegisterRequest(BaseModel):
    """Payload to create a new clinician account."""

    name: str = Field(min_length=1, max_length=255, description="Clinician display name")
    email: str = Field(min_length=3, max_length=255, description="Login email (stored lowercased)")
    password: str = Field(min_length=8, max_length=128, description="Account password (min 8 characters)")
    role: Literal["doctor", "asha", "admin"] = Field(
        default="doctor",
        description="Role granted to this account. Defaults to 'doctor'.",
    )

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Name cannot be blank")
        return normalized

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Email must be a string")
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("Email is required")
        if not re.match(_EMAIL_PATTERN, normalized):
            raise ValueError("Enter a valid email address")
        return normalized


class LoginRequest(BaseModel):
    """Credential payload for existing-account sign-in."""

    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower() if isinstance(value, str) else value


class AuthUserRead(BaseModel):
    """The safe, non-secret subset of a user returned to the client."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: str = "doctor"
    created_at: datetime


class AuthResponse(BaseModel):
    """Successful register/login response: the user plus a bearer token."""

    user: AuthUserRead
    token: str
    token_type: str = "bearer"
