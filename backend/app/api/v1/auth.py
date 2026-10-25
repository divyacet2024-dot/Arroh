"""User registration, sign-in, and session validation endpoints."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.user import User
from app.db.session import get_db_session
from app.schemas.auth import AuthResponse, AuthUserRead, LoginRequest, RegisterRequest
from app.services.auth_service import create_access_token, hash_password, parse_user_id, verify_password

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Documented as a string so the OpenAPI schema reflects the actual header name.
_authorization_header = Header(default=None, alias="Authorization")


def _read_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid bearer token")
    return authorization.split(" ", 1)[1].strip()


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED, summary="Register a new user")
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    """Create a clinician account, rejecting an email that is already registered."""

    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")

    user = User(name=payload.name, email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:  # backstop for a concurrent duplicate registration
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists") from exc
    await db.refresh(user)

    return AuthResponse(user=AuthUserRead.model_validate(user), token=create_access_token(user.id))


@router.post("/login", response_model=AuthResponse, summary="Sign in an existing user")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    """Authenticate credentials, returning a token on success."""

    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        # Same message for unknown-email and wrong-password to avoid account enumeration.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    return AuthResponse(user=AuthUserRead.model_validate(user), token=create_access_token(user.id))


@router.get("/me", response_model=AuthUserRead, summary="Validate the current session")
async def me(authorization: str | None = _authorization_header, db: AsyncSession = Depends(get_db_session)) -> User:
    """Return the authenticated user for a valid bearer token."""

    token = _read_bearer_token(authorization)
    user_id: uuid.UUID | None = parse_user_id(token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account no longer exists")
    return user
