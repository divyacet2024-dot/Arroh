"""One-time password persistence model for mobile-number patient authentication.

Design decisions:
  - OTP is stored as a salted PBKDF2 hash (same algorithm as passwords) so a
    database breach cannot reveal valid codes.
  - ``expires_at`` is a real UTC timestamp; the service layer rejects anything
    past it without relying on database-level TTL, which is not portable across
    SQLite and PostgreSQL.
  - ``attempts`` is incremented server-side on every wrong guess. The service
    layer locks the record after a configurable ceiling (default 5). This
    prevents brute-force guessing without leaking timing information.
  - One record per phone number: a new ``request_otp`` call replaces the
    previous row so stale codes cannot accumulate.
  - ``verified_at`` is set only once, when the correct OTP is presented. The
    API uses this to issue a patient session token.

Security invariants:
  - The raw OTP is NEVER stored.
  - The raw OTP is NEVER logged.
  - The raw OTP is NEVER returned to the frontend.
  - In production (``API_ENV != "development"``) it must be delivered only via
    SMS/voice, never via the API response body.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class OtpRecord(Base):
    """Persisted OTP state for one mobile-number authentication attempt."""

    __tablename__ = "otp_records"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # E.164-normalised mobile number (e.g. "+919876543210"). Indexed for
    # fast lookup on every verify call.
    phone_number: Mapped[str] = mapped_column(
        String(20), nullable=False, unique=True, index=True
    )
    # PBKDF2-SHA256 hash of the raw OTP (same format as password hashes).
    otp_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    # Hard UTC expiry enforced in application code.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Number of failed verification attempts since the last request.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Row creation time — useful for auditing and resend-cooldown checks.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Null until the correct OTP is presented; set exactly once.
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
