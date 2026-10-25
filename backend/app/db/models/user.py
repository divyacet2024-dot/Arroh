"""App user account model for authentication."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UserRole(str, enum.Enum):
    """Authorised role for an ARROH platform account.

    - ``doctor``  : licensed healthcare professional with full clinical tools.
    - ``asha``    : ASHA / ANM field health worker with assisted-intake access.
    - ``admin``   : PHC/system administrator (future).
    - ``patient`` : reserved value; actual patient sessions use the OTP pathway
                    and are stored on the Patient model, not here. This value
                    exists only to allow future unified auth if needed.
    """
    doctor  = "doctor"
    asha    = "asha"
    admin   = "admin"
    patient = "patient"


class User(Base):
    """A clinician / operator account that can sign in to the ARROH dashboard.

    Only a salted PBKDF2 hash of the password is stored — never the plaintext.
    ``email`` is stored lowercased and is the canonical uniqueness key used both
    at registration (reject duplicates) and at sign-in.
    ``role`` defaults to ``doctor`` so existing accounts are unaffected; the
    startup migration adds the column with that default for SQLite deployments.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"),
        nullable=False,
        default=UserRole.doctor,
        server_default=UserRole.doctor.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
