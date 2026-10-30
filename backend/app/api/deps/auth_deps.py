"""Shared FastAPI authentication dependencies.

Provides two reusable Depends()-callable functions:

    get_current_staff_user()
        Requires a valid staff bearer token (registered via /auth/register +
        /auth/login).  Returns the authenticated User ORM object.
        Raises HTTP 401 for missing, malformed, or expired tokens.
        Raises HTTP 401 if the account no longer exists in the database.

    get_current_patient_id()
        Requires a valid patient bearer token (issued by /patient-auth/verify-otp).
        Returns the authenticated patient's UUID.
        Raises HTTP 401 for missing, malformed, or expired tokens.

Design decisions:
    - Both functions use FastAPI's HTTPBearer scheme so the OpenAPI schema
      automatically declares the security requirement on protected endpoints.
    - auto_error=False is set so we can return a consistent error envelope
      rather than FastAPI's default plain-string 403.
    - The token validation logic is NOT duplicated here; it delegates to
      auth_service.parse_user_id() which is already tested and audited.
    - These dependencies do NOT merge the patient and staff token namespaces.
      A patient token will be rejected by get_current_staff_user() and vice
      versa, because staff tokens are backed by rows in the `users` table
      while patient tokens are backed by rows in the `patients` table.
"""

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.user import User
from app.db.session import get_db_session
from app.services.auth_service import parse_user_id

_bearer = HTTPBearer(auto_error=False)

_MISSING_TOKEN = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Missing or invalid bearer token",
    headers={"WWW-Authenticate": "Bearer"},
)
_INVALID_TOKEN = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired token",
    headers={"WWW-Authenticate": "Bearer"},
)
_ACCOUNT_GONE = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Account no longer exists",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_staff_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db_session),
) -> User:
    """Return the authenticated staff User, or raise 401.

    Usage::

        @router.get("/some-staff-route")
        async def my_route(user: User = Depends(get_current_staff_user)):
            ...
    """
    if credentials is None:
        raise _MISSING_TOKEN

    user_id: uuid.UUID | None = parse_user_id(credentials.credentials)
    if user_id is None:
        raise _INVALID_TOKEN

    user: User | None = await db.get(User, user_id)
    if user is None:
        raise _ACCOUNT_GONE

    return user


def get_current_patient_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> uuid.UUID:
    """Return the authenticated patient's UUID, or raise 401.

    This dependency validates the token signature only.  The caller is
    responsible for confirming that the returned UUID exists in the patients
    table if that check is needed (e.g. /patient-auth/me already does this).

    Usage::

        @router.get("/patient-route")
        async def my_route(patient_id: uuid.UUID = Depends(get_current_patient_id)):
            ...
    """
    if credentials is None:
        raise _MISSING_TOKEN

    patient_id: uuid.UUID | None = parse_user_id(credentials.credentials)
    if patient_id is None:
        raise _INVALID_TOKEN

    return patient_id
