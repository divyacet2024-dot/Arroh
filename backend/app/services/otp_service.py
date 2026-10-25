"""OTP generation, hashing, and verification for patient mobile authentication.

All cryptographic work uses only the Python standard library so no extra
dependencies are required.

Security guarantees:
  - Codes are generated with ``secrets.randbelow`` (CSPRNG).
  - The raw code is hashed immediately after generation; the cleartext never
    leaves this function.
  - Verification uses a constant-time comparison to resist timing attacks.
  - Expiry and attempt-limit checks happen before the hash comparison so that
    an attacker cannot use timing to distinguish "wrong code" from "expired".

Development mode:
  - When ``API_ENV == "development"`` the generated code is returned from
    ``generate_and_hash_otp`` as a second return value so tests and local
    demos can complete the flow without an SMS gateway.
  - This return value MUST NOT be forwarded to the API response in production.
    The caller (``patient_auth.py``) checks ``settings.api_env`` before
    deciding whether to include it in the JSON response body.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from app.core.config import get_settings

# ── Configuration ────────────────────────────────────────────────────────────

_OTP_LENGTH = 6           # digits
_OTP_TTL_SECONDS = 300    # 5 minutes
_MAX_ATTEMPTS = 5         # lock after this many wrong guesses
_RESEND_COOLDOWN_S = 60   # minimum seconds before a new OTP may be requested

_PBKDF2_ALGORITHM = "pbkdf2_sha256"
_PBKDF2_ITERATIONS = 100_000   # lower than password hash — OTP is short-lived

_settings = get_settings()
_secret = _settings.jwt_secret_key.get_secret_value()


# ── Public helpers ────────────────────────────────────────────────────────────

def generate_and_hash_otp(phone_number: str) -> tuple[str, str | None]:
    """Generate a 6-digit OTP, hash it, and return ``(hash, raw_code_if_dev)``.

    In production the second element is ``None`` — callers must not expose it.
    In development it is the raw code so the flow can be tested without SMS.
    """
    raw = "".join(str(secrets.randbelow(10)) for _ in range(_OTP_LENGTH))
    hashed = _hash_otp(raw, phone_number)
    dev_code = raw if _settings.api_env == "development" else None
    return hashed, dev_code


def otp_expiry() -> datetime:
    """Return the UTC expiry timestamp for a freshly issued OTP."""
    return datetime.now(UTC) + timedelta(seconds=_OTP_TTL_SECONDS)


def resend_cooldown_seconds() -> int:
    """Seconds a client must wait before requesting a new OTP."""
    return _RESEND_COOLDOWN_S


def max_attempts() -> int:
    """Maximum failed verification attempts before the record is locked."""
    return _MAX_ATTEMPTS


def verify_otp(raw_code: str, stored_hash: str, phone_number: str, expires_at: datetime, attempts: int) -> tuple[bool, str]:
    """Verify ``raw_code`` against the stored hash.

    Returns ``(ok, reason)`` where ``reason`` is a short machine-readable tag:
      - ``"ok"``         — code is correct and within limits
      - ``"expired"``    — past the TTL
      - ``"locked"``     — too many failed attempts
      - ``"wrong"``      — hash mismatch (attempts incremented by caller)
    """
    now = datetime.now(UTC)

    # Normalise stored expiry to UTC-aware for comparison.
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if now > expires_at:
        return False, "expired"

    if attempts >= _MAX_ATTEMPTS:
        return False, "locked"

    candidate = _hash_otp(raw_code.strip(), phone_number)
    if hmac.compare_digest(candidate, stored_hash):
        return True, "ok"

    return False, "wrong"


def is_resend_too_soon(created_at: datetime) -> bool:
    """Return True if the existing OTP record is too fresh to replace."""
    now = datetime.now(UTC)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return (now - created_at).total_seconds() < _RESEND_COOLDOWN_S


# ── Internal ─────────────────────────────────────────────────────────────────

def _hash_otp(raw: str, phone_number: str) -> str:
    """PBKDF2-SHA256 of the OTP, using the phone number as a per-record salt.

    The phone number salt means that the same 6-digit code produces a different
    hash for every subscriber, preventing rainbow-table precomputation across
    phone numbers.  The global secret key is mixed in as well.
    """
    salt = f"{phone_number}{_secret}".encode("utf-8")
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        raw.encode("utf-8"),
        salt,
        _PBKDF2_ITERATIONS,
    ).hex()
    return f"{_PBKDF2_ALGORITHM}${_PBKDF2_ITERATIONS}${digest}"
