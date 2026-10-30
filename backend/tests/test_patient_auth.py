"""Focused coverage for patient OTP authentication and multilingual replies."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import patient_auth
from app.services import auth_service
from app.services import otp_service


def enable_test_otp_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    """Expose the development-only OTP only inside these isolated tests."""
    monkeypatch.setattr(patient_auth._settings, "api_env", "development")
    monkeypatch.setattr(otp_service._settings, "api_env", "development")


def test_patient_auth_routes_are_registered(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/patient-auth/request-otp" in paths
    assert "/api/v1/patient-auth/verify-otp" in paths
    assert "/api/v1/patient-auth/me" in paths


@pytest.mark.parametrize(
    ("headers", "detail"),
    [
        ({}, "Missing bearer token"),
        ({"Authorization": "Bearer invalid-token"}, "Invalid or expired token"),
    ],
)
def test_patient_me_rejects_missing_and_invalid_tokens(
    client: TestClient, headers: dict[str, str], detail: str
) -> None:
    response = client.get("/api/v1/patient-auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == detail


def test_patient_me_rejects_unknown_patient_id(client: TestClient) -> None:
    token = auth_service.create_access_token(uuid.uuid4())
    response = client.get(
        "/api/v1/patient-auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Patient account not found"


def test_patient_owned_endpoint_rejects_missing_token(client: TestClient) -> None:
    response = client.get("/api/v1/patient-auth/prescriptions")
    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_patient_phone_validation_rejects_invalid_number(client: TestClient) -> None:
    response = client.post(
        "/api/v1/patient-auth/request-otp",
        json={"phone_number": "12345"},
    )
    assert response.status_code == 422


def test_otp_service_rejects_expired_and_locked_codes() -> None:
    expired = otp_service.verify_otp(
        "123456",
        "not-a-hash",
        "+919876543210",
        datetime.now(UTC) - timedelta(seconds=1),
        0,
    )
    locked = otp_service.verify_otp(
        "123456",
        "not-a-hash",
        "+919876543210",
        datetime.now(UTC) + timedelta(minutes=5),
        otp_service.max_attempts(),
    )
    assert expired == (False, "expired")
    assert locked == (False, "locked")


def test_patient_otp_login_and_me_return_the_same_identity(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_test_otp_delivery(monkeypatch)
    otp_response = client.post(
        "/api/v1/patient-auth/request-otp",
        json={"phone_number": "9876543210"},
    )
    assert otp_response.status_code == 200
    otp = otp_response.json()["dev_otp"]
    assert otp

    login = client.post(
        "/api/v1/patient-auth/verify-otp",
        json={"phone_number": "9876543210", "otp_code": otp},
    )
    assert login.status_code == 200
    token = login.json()["token"]
    user = login.json()["user"]

    reused = client.post(
        "/api/v1/patient-auth/verify-otp",
        json={"phone_number": "9876543210", "otp_code": otp},
    )
    assert reused.status_code == 401
    assert reused.json()["detail"]["code"] == "otp_already_used"

    me = client.get(
        "/api/v1/patient-auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200
    assert me.json() == user


def test_wrong_patient_otp_attempts_are_persisted_and_locked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_test_otp_delivery(monkeypatch)
    requested = client.post(
        "/api/v1/patient-auth/request-otp",
        json={"phone_number": "9876543211"},
    )
    assert requested.status_code == 200
    correct_code = requested.json()["dev_otp"]
    wrong_code = "000000" if correct_code != "000000" else "000001"

    for _ in range(5):
        response = client.post(
            "/api/v1/patient-auth/verify-otp",
            json={"phone_number": "9876543211", "otp_code": wrong_code},
        )
        assert response.status_code == 401

    locked = client.post(
        "/api/v1/patient-auth/verify-otp",
        json={"phone_number": "9876543211", "otp_code": wrong_code},
    )
    assert locked.status_code == 401
    assert locked.json()["detail"]["code"] == "otp_locked"


@pytest.mark.parametrize(
    ("language", "expected_language", "expected_text"),
    [
        ("en", "en", "I have understood"),
        ("kn", "kn", "ನೀವು"),
        ("hi-IN", "hi", "आपने"),
        ("te", "te", "మీరు"),
        ("ta", "ta", "நீங்கள்"),
        ("ml", "ml", "നിങ്ങൾ"),
        ("mr", "mr", "तुम्ही"),
        ("bn", "bn", "আপনি"),
        ("gu", "gu", "તમે"),
    ],
)
def test_voice_reply_preserves_language_and_unicode(
    client: TestClient, language: str, expected_language: str, expected_text: str
) -> None:
    response = client.post(
        "/api/v1/voice/parse-and-triage",
        json={"transcript": "fever", "language": language},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reply_language"] == expected_language
    assert expected_text in body["patient_reply"]


def test_patient_prescriptions_are_isolated_between_accounts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_test_otp_delivery(monkeypatch)

    # Patient A
    a_otp = client.post("/api/v1/patient-auth/request-otp", json={"phone_number": "9876543290"})
    assert a_otp.status_code == 200
    a_token = client.post(
        "/api/v1/patient-auth/verify-otp",
        json={"phone_number": "9876543290", "otp_code": a_otp.json()["dev_otp"]},
    ).json()["token"]
    a_id = client.get("/api/v1/patient-auth/me", headers={"Authorization": f"Bearer {a_token}"}).json()["id"]

    # Patient B
    b_otp = client.post("/api/v1/patient-auth/request-otp", json={"phone_number": "9876543291"})
    assert b_otp.status_code == 200
    b_token = client.post(
        "/api/v1/patient-auth/verify-otp",
        json={"phone_number": "9876543291", "otp_code": b_otp.json()["dev_otp"]},
    ).json()["token"]

    # Create a prescription for Patient A via the staff endpoint.
    rx = client.post(
        "/api/v1/prescriptions/create",
        json={
            "patient_id": a_id,
            "doctor_id": "DR-ISO",
            "diagnosis": "Isolation test",
            "medications": [
                {"name": "Paracetamol", "dosage": "500mg", "frequency": "ONCE_DAILY", "duration_days": 3, "visual_identifier": "White tablet"}
            ],
            "language": "english",
            "follow_up_in_days": 3,
        },
    )
    assert rx.status_code == 201

    # Patient A sees their own prescription.
    a_list = client.get("/api/v1/patient-auth/prescriptions", headers={"Authorization": f"Bearer {a_token}"})
    assert a_list.status_code == 200
    assert len(a_list.json()) == 1

    # Patient B cannot see Patient A's prescription.
    b_list = client.get("/api/v1/patient-auth/prescriptions", headers={"Authorization": f"Bearer {b_token}"})
    assert b_list.status_code == 200
    assert b_list.json() == []
