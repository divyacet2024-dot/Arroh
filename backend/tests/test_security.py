"""Phase 4 security regression tests for MEDORA.

Scope:
  A. Staff authentication — valid tokens accepted, invalid/missing rejected.
  B. Patient authentication — tokens accepted, invalid/missing rejected.
  C. Unauthenticated access to protected endpoints returns 401.
  D. Patient isolation — Patient B cannot read Patient A's records.
  E. Cross-token rejection — patient token rejected on staff endpoints and
     vice versa (the two token namespaces must remain separate).
  F. Timeline endpoint now requires staff auth (newly protected in task 5).
  G. Public endpoints remain accessible without any token.
  H. Mobile sync endpoint still accepts unauthenticated bulk-sync (documented
     design decision; test asserts the current behaviour as a regression guard).

Tests that depend on OTP delivery use monkeypatching to switch api_env to
"development" only within the test body, following the same pattern already
established in test_patient_auth.py.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import patient_auth as _patient_auth_module
from app.services import auth_service
from app.services import otp_service as _otp_service_module


# ── Helpers ───────────────────────────────────────────────────────────────────

def _enable_otp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_patient_auth_module._settings, "api_env", "development")
    monkeypatch.setattr(_otp_service_module._settings, "api_env", "development")


def _unique_phone() -> str:
    """E.164-style Indian mobile number unique within this process."""
    suffix = str(uuid.uuid4().int)[-9:]
    return f"9{suffix}"


def _register_staff(client: TestClient) -> dict:
    """Register a fresh staff account and return the response body (includes token)."""
    email = f"staff-{uuid.uuid4()}@test.local"
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "Test Doctor", "email": email, "password": "SecurePass123!"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _patient_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> tuple[str, str]:
    """Register a patient via OTP and return (token, patient_id)."""
    _enable_otp(monkeypatch)
    phone = _unique_phone()
    otp_resp = client.post("/api/v1/patient-auth/request-otp", json={"phone_number": phone})
    assert otp_resp.status_code == 200, otp_resp.text
    verify = client.post(
        "/api/v1/patient-auth/verify-otp",
        json={"phone_number": phone, "otp_code": otp_resp.json()["dev_otp"]},
    )
    assert verify.status_code == 200, verify.text
    return verify.json()["token"], verify.json()["user"]["id"]


# ── A. Staff authentication ───────────────────────────────────────────────────

class TestStaffAuthentication:
    def test_valid_staff_token_accepted_on_auth_me(self, client: TestClient) -> None:
        body = _register_staff(client)
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {body['token']}"},
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == body["user"]["id"]

    def test_missing_token_rejected_on_auth_me(self, client: TestClient) -> None:
        resp = client.get("/api/v1/auth/me")
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Missing or invalid bearer token"

    def test_malformed_token_rejected_on_auth_me(self, client: TestClient) -> None:
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer not.a.valid.token"},
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid or expired token"

    def test_random_uuid_token_rejected_on_auth_me(self, client: TestClient) -> None:
        """A correctly structured token for a non-existent user must be rejected."""
        token = auth_service.create_access_token(uuid.uuid4())
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Account no longer exists"

    def test_wrong_password_rejected(self, client: TestClient) -> None:
        email = f"staff-{uuid.uuid4()}@test.local"
        client.post(
            "/api/v1/auth/register",
            json={"name": "Dr Wrong", "email": email, "password": "CorrectPassword1!"},
        )
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "WrongPassword99!"},
        )
        assert resp.status_code == 401

    def test_duplicate_email_registration_rejected(self, client: TestClient) -> None:
        email = f"dup-{uuid.uuid4()}@test.local"
        client.post(
            "/api/v1/auth/register",
            json={"name": "Dr A", "email": email, "password": "Pass1234!"},
        )
        second = client.post(
            "/api/v1/auth/register",
            json={"name": "Dr B", "email": email, "password": "Pass5678!"},
        )
        assert second.status_code == 409


# ── B. Patient authentication ─────────────────────────────────────────────────

class TestPatientAuthentication:
    def test_valid_patient_token_accepted_on_patient_me(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        token, patient_id = _patient_token(client, monkeypatch)
        resp = client.get(
            "/api/v1/patient-auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == patient_id
        assert resp.json()["role"] == "patient"

    def test_missing_token_rejected_on_patient_me(self, client: TestClient) -> None:
        resp = client.get("/api/v1/patient-auth/me")
        assert resp.status_code == 401

    def test_malformed_token_rejected_on_patient_me(self, client: TestClient) -> None:
        resp = client.get(
            "/api/v1/patient-auth/me",
            headers={"Authorization": "Bearer garbage.token.here"},
        )
        assert resp.status_code == 401


# ── C. Unauthenticated access to protected endpoints ─────────────────────────

class TestUnauthenticatedAccessRejected:
    """Every endpoint listed here must return 401 when called without a token."""

    @pytest.mark.parametrize("path", [
        "/api/v1/auth/me",
        "/api/v1/patient-auth/me",
        "/api/v1/patient-auth/prescriptions",
        "/api/v1/patient-auth/consultations",
        "/api/v1/patient-auth/appointments",
        "/api/v1/patient-auth/follow-ups",
    ])
    def test_get_endpoint_requires_token(self, client: TestClient, path: str) -> None:
        resp = client.get(path)
        assert resp.status_code == 401, (
            f"Expected 401 for unauthenticated GET {path}, got {resp.status_code}: {resp.text}"
        )

    def test_timeline_endpoint_requires_staff_token(self, client: TestClient) -> None:
        """GET /patients/{id}/timeline was previously unauthenticated — now fixed."""
        fake_patient_id = uuid.uuid4()
        resp = client.get(f"/api/v1/patients/{fake_patient_id}/timeline")
        assert resp.status_code == 401, (
            f"Timeline must require staff auth, got {resp.status_code}: {resp.text}"
        )

    def test_timeline_rejects_missing_bearer(self, client: TestClient) -> None:
        resp = client.get(
            f"/api/v1/patients/{uuid.uuid4()}/timeline",
            headers={},
        )
        assert resp.status_code == 401

    def test_timeline_rejects_invalid_token(self, client: TestClient) -> None:
        resp = client.get(
            f"/api/v1/patients/{uuid.uuid4()}/timeline",
            headers={"Authorization": "Bearer invalid.token"},
        )
        assert resp.status_code == 401


# ── D. Patient isolation ──────────────────────────────────────────────────────

class TestPatientIsolation:
    """Patient B must never be able to read or enumerate Patient A's records."""

    def test_patient_b_cannot_read_patient_a_prescriptions(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        token_a, id_a = _patient_token(client, monkeypatch)
        token_b, _    = _patient_token(client, monkeypatch)

        # Write a prescription for Patient A via the unauthenticated staff endpoint.
        rx = client.post(
            "/api/v1/prescriptions/create",
            json={
                "patient_id": id_a,
                "doctor_id": "DR-SEC-TEST",
                "diagnosis": "Security isolation test",
                "medications": [{
                    "name": "Amoxicillin",
                    "dosage": "250 mg",
                    "frequency": "THRICE_DAILY",
                    "duration_days": 5,
                    "visual_identifier": "Pink capsule",
                }],
                "language": "english",
                "follow_up_in_days": 5,
            },
        )
        assert rx.status_code == 201

        # Patient A can read it.
        a_list = client.get(
            "/api/v1/patient-auth/prescriptions",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert a_list.status_code == 200
        assert len(a_list.json()) >= 1

        # Patient B must NOT see Patient A's prescription.
        b_list = client.get(
            "/api/v1/patient-auth/prescriptions",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert b_list.status_code == 200
        assert b_list.json() == [], (
            "Patient B's prescription list must be empty — "
            "Patient A's prescriptions must not leak."
        )

    def test_patient_b_cannot_read_patient_a_consultations(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        token_a, _ = _patient_token(client, monkeypatch)
        token_b, _ = _patient_token(client, monkeypatch)

        # Patient B's consultation list must be empty regardless of Patient A's data.
        b_list = client.get(
            "/api/v1/patient-auth/consultations",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert b_list.status_code == 200
        assert b_list.json() == []

    def test_patient_b_cannot_read_patient_a_appointments(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        token_a, _ = _patient_token(client, monkeypatch)
        token_b, _ = _patient_token(client, monkeypatch)

        b_list = client.get(
            "/api/v1/patient-auth/appointments",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert b_list.status_code == 200
        assert b_list.json() == []

    def test_patient_b_cannot_read_patient_a_follow_ups(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        token_a, _ = _patient_token(client, monkeypatch)
        token_b, _ = _patient_token(client, monkeypatch)

        b_list = client.get(
            "/api/v1/patient-auth/follow-ups",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert b_list.status_code == 200
        assert b_list.json() == []


# ── E. Cross-token namespace separation ───────────────────────────────────────

class TestTokenNamespaceSeparation:
    """A patient token must be rejected on staff endpoints and vice versa."""

    def test_patient_token_rejected_on_staff_me(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A token issued for a patient (backed by patients table) must be
        rejected by /auth/me which looks up the users table."""
        patient_token, _ = _patient_token(client, monkeypatch)
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {patient_token}"},
        )
        # The patient's UUID does not exist in the users table → 401.
        assert resp.status_code == 401

    def test_patient_token_rejected_on_timeline(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Timeline requires staff auth; patient token must not bypass it."""
        patient_token, _ = _patient_token(client, monkeypatch)
        resp = client.get(
            f"/api/v1/patients/{uuid.uuid4()}/timeline",
            headers={"Authorization": f"Bearer {patient_token}"},
        )
        # Patient UUID not in users table → 401.
        assert resp.status_code == 401

    def test_staff_token_accepted_on_timeline(self, client: TestClient) -> None:
        """A valid staff token must be accepted by the timeline endpoint
        (returning 404 for a non-existent patient, not 401)."""
        staff = _register_staff(client)
        resp = client.get(
            f"/api/v1/patients/{uuid.uuid4()}/timeline",
            headers={"Authorization": f"Bearer {staff['token']}"},
        )
        # Staff is authenticated → the route runs → patient not found → 404.
        assert resp.status_code == 404, (
            f"Expected 404 (patient not found) for authenticated staff request, "
            f"got {resp.status_code}: {resp.text}"
        )


# ── F. Public endpoints remain accessible ────────────────────────────────────

class TestPublicEndpointsRemainAccessible:
    """These endpoints are intentionally public.  Regression guard."""

    def test_health_endpoint_is_public(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_triage_assess_is_public(self, client: TestClient) -> None:
        """Triage assessment is a stateless rules engine — no patient data returned."""
        resp = client.post(
            "/api/v1/triage/assess",
            json={"symptoms": ["fever"], "vitals": {"spo2": 96}},
        )
        assert resp.status_code == 200
        assert resp.json()["triage_level"] in ("RED", "YELLOW", "GREEN")

    def test_voice_parse_and_triage_is_public(self, client: TestClient) -> None:
        """Voice intake works without auth (no ABHA ID supplied → no patient data written)."""
        resp = client.post(
            "/api/v1/voice/parse-and-triage",
            json={"transcript": "headache for two days", "language": "en"},
        )
        assert resp.status_code == 200
        assert "patient_reply" in resp.json()

    def test_otp_request_is_public_in_dev(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Requesting an OTP requires no prior authentication."""
        _enable_otp(monkeypatch)
        resp = client.post(
            "/api/v1/patient-auth/request-otp",
            json={"phone_number": _unique_phone()},
        )
        assert resp.status_code == 200


# ── G. Mobile sync — documented unauthenticated design decision ───────────────

class TestMobileSyncAuthBehaviour:
    """The bulk-sync endpoint is intentionally unauthenticated in the current
    release.  These tests assert and document the current behaviour so that
    any accidental change is caught immediately.

    NOTE: This is an acknowledged security risk (see Phase 5 report).
    The endpoint accepts records from any caller and writes patient data.
    A future migration should add worker-token authentication.
    """

    def test_bulk_sync_accepts_request_without_token(self, client: TestClient) -> None:
        """Regression guard: bulk sync currently works without authentication.
        If this test starts failing it means auth was added — update this test
        and the Phase 5 report accordingly.
        """
        payload = {
            "worker_id": "ASHA-TEST-WORKER",
            "phc_id": "PHC-TEST-01",
            "sync_timestamp": "2024-01-01T00:00:00Z",
            "records": [],
        }
        resp = client.post("/api/v1/sync/bulk", json=payload)
        # Empty records → synced_count 0 — accepted without authentication.
        assert resp.status_code == 200, (
            "bulk_sync is intentionally unauthenticated. "
            "If this changes, update the security report and add worker auth."
        )
        body = resp.json()
        assert body["synced_count"] == 0

    def test_sms_fallback_accepts_request_without_token(self, client: TestClient) -> None:
        """Regression guard for the SMS fallback endpoint."""
        # Invalid payload → 422 (validation error), not 401 (auth error).
        # This proves auth is not enforced — the route processes the request body.
        resp = client.post(
            "/api/v1/sync/sms-fallback",
            json={"compressed_payload": "INVALID"},
        )
        # 422 means auth passed, validation failed — confirms no auth gate.
        assert resp.status_code in (422, 400), (
            "sms-fallback is intentionally unauthenticated. "
            "A 401 here would mean auth was added — update the security report."
        )
