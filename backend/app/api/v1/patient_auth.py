"""Patient authentication via mobile number + OTP.

Flow:
  POST /patient-auth/request-otp  → generate + hash OTP, return dev_otp in development
  POST /patient-auth/verify-otp   → verify OTP, upsert patient row, return bearer token
  GET  /patient-auth/me           → validate bearer token, return patient identity

Security invariants:
  - OTP never stored in plaintext.
  - OTP never returned to client in production.
  - Failed attempts counted server-side; hard ceiling enforced.
  - Sensitive fields stripped before response serialisation.
"""

import re
import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models.otp import OtpRecord
from app.db.models.patient import Patient, TriageStatus
from app.db.session import get_db_session
from app.services.auth_service import create_access_token, parse_user_id
from app.services.otp_service import (
    generate_and_hash_otp,
    is_resend_too_soon,
    max_attempts,
    otp_expiry,
    resend_cooldown_seconds,
    verify_otp,
)
from pydantic import BaseModel, Field, field_validator

router = APIRouter(prefix="/patient-auth", tags=["Patient Authentication"])
_bearer_scheme = HTTPBearer(auto_error=False)
_settings = get_settings()

# ── Phone normalisation ──────────────────────────────────────────────────────

_MOBILE_RE = re.compile(r"^(?:\+91)?[6-9]\d{9}$")


def _normalise_phone(raw: str) -> str:
    cleaned = re.sub(r"[\s\-()]", "", raw.strip())
    if cleaned.startswith("+91"):
        return cleaned
    if cleaned.startswith("91") and len(cleaned) == 12:
        return "+" + cleaned
    return "+91" + cleaned


def _validate_phone(value: str) -> str:
    normalised = _normalise_phone(value)
    if not _MOBILE_RE.match(normalised):
        raise ValueError("Enter a valid 10-digit Indian mobile number.")
    return normalised


# ── Pydantic models ──────────────────────────────────────────────────────────

class OtpRequestBody(BaseModel):
    phone_number: str = Field(description="10-digit Indian mobile number")

    @field_validator("phone_number", mode="before")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _validate_phone(value)


class OtpVerifyBody(BaseModel):
    phone_number: str
    otp_code: str = Field(min_length=6, max_length=6)

    @field_validator("phone_number", mode="before")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _validate_phone(value)

    @field_validator("otp_code", mode="before")
    @classmethod
    def validate_code(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned.isdigit() or len(cleaned) != 6:
            raise ValueError("OTP must be exactly 6 digits.")
        return cleaned


class OtpRequestResponse(BaseModel):
    message: str
    resend_after_seconds: int
    dev_otp: str | None = None   # only present in development


class PatientTokenUser(BaseModel):
    id: str
    phone_number: str
    name: str | None
    role: str = "patient"


class PatientAuthResponse(BaseModel):
    token: str
    token_type: str = "bearer"
    user: PatientTokenUser


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/request-otp", response_model=OtpRequestResponse, status_code=200,
             summary="Request OTP for patient mobile login")
async def request_otp(
    payload: OtpRequestBody,
    db: AsyncSession = Depends(get_db_session),
) -> OtpRequestResponse:
    if _settings.api_env != "development":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "otp_delivery_unavailable",
                "message": "OTP delivery is not configured. Please contact the service administrator.",
            },
        )

    phone = payload.phone_number

    existing: OtpRecord | None = await db.scalar(
        select(OtpRecord).where(OtpRecord.phone_number == phone)
    )
    if existing is not None and is_resend_too_soon(existing.created_at):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "resend_too_soon",
                "message": "ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯ ಕಾಯಿರಿ.",
                "resend_after_seconds": resend_cooldown_seconds(),
            },
        )

    otp_hash, dev_code = generate_and_hash_otp(phone)
    expiry = otp_expiry()
    now = datetime.now(UTC)

    if existing is not None:
        existing.otp_hash    = otp_hash
        existing.expires_at  = expiry
        existing.attempts    = 0
        existing.verified_at = None
        existing.created_at  = now
    else:
        db.add(OtpRecord(phone_number=phone, otp_hash=otp_hash, expires_at=expiry))

    # TODO (production): deliver OTP via SMS gateway here.
    # dev_code is None in production — never forward it.

    return OtpRequestResponse(
        message="Development OTP generated. No SMS was sent.",
        resend_after_seconds=resend_cooldown_seconds(),
        dev_otp=dev_code,
    )


@router.post("/verify-otp", response_model=PatientAuthResponse, status_code=200,
             summary="Verify OTP and issue patient session token")
async def verify_otp_endpoint(
    payload: OtpVerifyBody,
    db: AsyncSession = Depends(get_db_session),
) -> PatientAuthResponse:
    phone = payload.phone_number

    record: OtpRecord | None = await db.scalar(
        select(OtpRecord).where(OtpRecord.phone_number == phone)
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "no_otp_requested", "message": "ಮೊದಲು OTP ಕಳಿಸಿ."},
        )
    if record.verified_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "otp_already_used", "message": "ಈ OTP ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ. ಹೊಸ OTP ತರಿಸಿ."},
        )

    ok, reason = verify_otp(
        raw_code=payload.otp_code,
        stored_hash=record.otp_hash,
        phone_number=phone,
        expires_at=record.expires_at,
        attempts=record.attempts,
    )

    if not ok:
        if reason == "wrong":
            record.attempts += 1
            # The request session rolls back when this endpoint raises. Persist
            # the failed-attempt counter before returning the authentication error.
            await db.commit()
        _ERRORS = {
            "expired": {"code": "otp_expired",
                        "message": "OTP ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸ OTP ತರಿಸಿ."},
            "locked":  {"code": "otp_locked",
                        "message": f"ತಪ್ಪು OTP {max_attempts()} ಬಾರಿ. ಹೊಸ OTP ತರಿಸಿ."},
            "wrong":   {"code": "otp_wrong",
                        "message": f"OTP ತಪ್ಪಾಗಿದೆ. {max_attempts() - record.attempts} ಪ್ರಯತ್ನ ಉಳಿದಿದೆ."},
        }
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_ERRORS.get(reason, {"code": reason, "message": "OTP ದೋಷ."}),
        )

    record.verified_at = datetime.now(UTC)

    # Upsert a minimal patient row for this phone number.
    patient: Patient | None = await db.scalar(
        select(Patient).where(Patient.phone_number == phone)
    )
    if patient is None:
        patient = Patient(
            id=uuid.uuid4(),
            name="",
            gender="unknown",
            birth_date=date(1900, 1, 1),   # FIX: use date object, not string
            district="Unknown",
            state="Karnataka",
            triage_status=TriageStatus.GREEN,
            phone_number=phone,
            is_synced_offline=False,
        )
        db.add(patient)
        await db.flush()
        await db.refresh(patient)

    token = create_access_token(patient.id)

    return PatientAuthResponse(
        token=token,
        user=PatientTokenUser(
            id=str(patient.id),
            phone_number=phone,
            name=patient.name or None,
            role="patient",
        ),
    )


@router.get("/me", response_model=PatientTokenUser,
            summary="Validate patient token and return identity")
async def patient_me(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> PatientTokenUser:
    patient_id = _require_patient(credentials)
    patient = await db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Patient account not found")
    return PatientTokenUser(
        id=str(patient.id),
        phone_number=patient.phone_number or "",
        name=patient.name or None,
        role="patient",
    )


# ── Patient-facing read endpoints ────────────────────────────────────────────
# These allow an authenticated patient to read their own records.
# Authorization: the bearer token identifies the patient; they can only
# read records where patient_id matches their own UUID.

def _require_patient(credentials: HTTPAuthorizationCredentials | None) -> uuid.UUID:
    """Extract and validate patient UUID from a bearer token. Raises 401 on failure."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    patient_id = parse_user_id(credentials.credentials)
    if patient_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return patient_id


@router.get("/prescriptions", summary="List prescriptions for the authenticated patient")
async def get_patient_prescriptions(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Return all care prescriptions for the authenticated patient (newest first)."""
    from app.db.models.care_prescription import CarePrescription
    patient_id = _require_patient(credentials)
    rows = (await db.scalars(
        select(CarePrescription)
        .where(CarePrescription.patient_id == patient_id)
        .order_by(CarePrescription.created_at.desc())
    )).all()
    return [
        {
            "prescription_id": str(r.prescription_id),
            "diagnosis": r.diagnosis,
            "medications": r.medications,
            "language": r.language,
            "audio_prescription_script": r.audio_prescription_script,
            "follow_up_date": r.follow_up_date.isoformat() if r.follow_up_date else None,
            "follow_up_status": r.follow_up_status,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/consultations", summary="List consultations for the authenticated patient")
async def get_patient_consultations(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Return consultation summaries the patient may read (no raw clinical notes leaked)."""
    from app.db.models.consultation import Consultation, DischargePlan
    patient_id = _require_patient(credentials)
    rows = (await db.scalars(
        select(Consultation)
        .where(Consultation.patient_id == patient_id)
        .order_by(Consultation.started_at.desc())
    )).all()

    results = []
    for c in rows:
        plan = await db.scalar(
            select(DischargePlan).where(DischargePlan.consultation_id == c.id)
        )
        results.append({
            "consultation_id": str(c.id),
            "status": c.status,
            "chief_complaint": c.chief_complaint,
            # Only expose the discharge plan (patient-safe summary), not raw findings/assessment.
            "discharge_summary": {
                "diagnosis": plan.diagnosis if plan else None,
                "treatment_instructions": plan.treatment_instructions if plan else None,
                "medication_instructions": plan.medication_instructions if plan else [],
                "warning_signs": plan.warning_signs if plan else [],
                "follow_up_required": plan.follow_up_required if plan else False,
                "follow_up_due_at": plan.follow_up_due_at.isoformat() if plan and plan.follow_up_due_at else None,
            } if plan else None,
            "started_at": c.started_at.isoformat(),
            "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        })
    return results


@router.get("/appointments", summary="List upcoming appointments (visits) for the authenticated patient")
async def get_patient_appointments(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Return the patient's visit/appointment records (newest first, limit 20)."""
    from app.db.models.visit import Visit
    patient_id = _require_patient(credentials)
    rows = (await db.scalars(
        select(Visit)
        .where(Visit.patient_id == patient_id)
        .order_by(Visit.started_at.desc())
        .limit(20)
    )).all()
    return [
        {
            "visit_id": str(v.id),
            "visit_type": v.visit_type,
            "started_at": v.started_at.isoformat(),
            "completed_at": v.completed_at.isoformat() if v.completed_at else None,
            "outcome": v.outcome,
            "phc_id": v.phc_id,
            "next_visit_date": v.next_visit_date.isoformat() if v.next_visit_date else None,
        }
        for v in rows
    ]


@router.get("/follow-ups", summary="List follow-ups for the authenticated patient")
async def get_patient_follow_ups(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Return the patient's follow-up records."""
    from app.db.models.follow_up import FollowUp
    patient_id = _require_patient(credentials)
    rows = (await db.scalars(
        select(FollowUp)
        .where(FollowUp.patient_id == patient_id)
        .order_by(FollowUp.due_at.asc())
        .limit(20)
    )).all()
    return [
        {
            "follow_up_id": str(f.id),
            "follow_up_type": f.follow_up_type,
            "due_at": f.due_at.isoformat(),
            "status": f.status,
            "priority": f.priority,
            "notes": f.notes,
        }
        for f in rows
    ]
