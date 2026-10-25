"""Authentication primitives: salted PBKDF2 password hashing and bearer tokens.

Uses only the standard library (``hashlib``, ``hmac``, ``secrets``) so the demo
backend needs no extra auth dependency. Production should replace the HMAC token
with a real JWT/OpenID flow, but the hashing and the constant-time comparisons
here are safe defaults for a prototype.
"""

import hashlib
import hmac
import time
import uuid

from app.core.config import get_settings

_PBKDF2_ALGORITHM = "pbkdf2_sha256"
_PBKDF2_ITERATIONS = 210_000

_secret = get_settings().jwt_secret_key.get_secret_value()


def hash_password(password: str) -> str:
    """Return a self-describing ``alg$iterations$salt$hash`` password string."""

    salt = uuid.uuid4().hex
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    ).hex()
    return f"{_PBKDF2_ALGORITHM}${_PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time check of a password against its stored PBKDF2 hash."""

    try:
        _algorithm, iterations_str, salt, digest = encoded.split("$")
        if _algorithm != _PBKDF2_ALGORITHM:
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations_str)
        ).hex()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, TypeError):
        return False


def _sign(payload: str) -> str:
    return hmac.new(_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_access_token(user_id: uuid.UUID) -> str:
    """Return an HMAC-signed, stateless token carrying the user id + issue time."""

    payload = f"{user_id.hex}.{int(time.time())}"
    return f"{payload}.{_sign(payload)}"


def parse_user_id(token: str) -> uuid.UUID | None:
    """Validate a token's signature and return its user id, or ``None`` if invalid."""

    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(parts[2], _sign(payload)):
        return None
    try:
        int(parts[1])
        return uuid.UUID(hex=parts[0])
    except ValueError:
        return None
