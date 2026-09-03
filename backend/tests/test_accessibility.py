"""Unit tests for the Accessible Triage Layer endpoints and preference store."""

import uuid

from fastapi.testclient import TestClient


def _create_patient(client: TestClient, abha_id: str = "52345678901234") -> dict:
    response = client.post(
        "/api/v1/patients/",
        json={
            "name": "Accessible Demo",
            "gender": "female",
            "birth_date": "1992-02-02",
            "abha_id": abha_id,
            "phone_number": "9876543211",
            "district": "Dakshina Kannada",
            "state": "Karnataka",
            "phc_id": "PHC-LOCAL",
            "triage_status": "YELLOW",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


_TRIAGE_PAYLOAD = {
    "risk_score": 85,
    "triage_level": "RED",
    "recommended_actions": [
        "Suspect antepartum hemorrhage: keep the patient at pelvic rest, monitor blood loss, and refer urgently to a facility with maternity and blood-bank capability.",
        "Activate maternal emergency pathway, assess blood loss.",
    ],
    "high_risk_respiratory": False,
    "high_risk_maternal": True,
    "maternal_conditions": ["ANTEPARTUM_HEMORRHAGE"],
    "assessed_vitals": {"heart_rate": 120.0},
    "missing_vitals": ["temperature"],
}


def test_format_triage_request_sign_interpreter_for_deaf(client: TestClient) -> None:
    patient = _create_patient(client)
    response = client.post(
        "/api/v1/accessibility/format-triage",
        json={"patient_id": patient["id"], "communication_mode": "deaf", "triage_payload": _TRIAGE_PAYLOAD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["communication_mode"] == "deaf"
    assert body["sign_interpreter_requested"] is True
    assert body["visual_captions"]
    assert any("RED alert" in caption for caption in body["visual_captions"])
    assert body["read_aloud_script"]  # deaf users still receive a voice fallback


def test_format_triage_low_literacy_yields_read_aloud_script(client: TestClient) -> None:
    patient = _create_patient(client, abha_id="62345678901234")
    response = client.post(
        "/api/v1/accessibility/format-triage",
        json={"patient_id": patient["id"], "communication_mode": "low_literacy", "triage_payload": _TRIAGE_PAYLOAD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["communication_mode"] == "low_literacy"
    assert body["sign_interpreter_requested"] is False
    assert body["read_aloud_script"]
    assert "Step 1" in body["read_aloud_script"]
    assert body["simplified_actions"]


def test_format_triage_speech_impaired_uses_simplified_actions(client: TestClient) -> None:
    patient = _create_patient(client, abha_id="72345678901234")
    response = client.post(
        "/api/v1/accessibility/format-triage",
        json={"patient_id": patient["id"], "communication_mode": "speech_impaired", "triage_payload": _TRIAGE_PAYLOAD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["communication_mode"] == "speech_impaired"
    assert body["sign_interpreter_requested"] is False
    assert body["simplified_actions"]
    assert body["visual_captions"]


def test_format_triage_rejects_unknown_mode(client: TestClient) -> None:
    patient = _create_patient(client, abha_id="82345678901234")
    response = client.post(
        "/api/v1/accessibility/format-triage",
        json={"patient_id": patient["id"], "communication_mode": "braille", "triage_payload": _TRIAGE_PAYLOAD},
    )
    assert response.status_code == 422


def test_format_triage_persists_preference_for_next_visit(client: TestClient) -> None:
    patient = _create_patient(client, abha_id="92345678901234")
    assert client.post(
        "/api/v1/accessibility/format-triage",
        json={"patient_id": patient["id"], "communication_mode": "deaf", "triage_payload": _TRIAGE_PAYLOAD},
    ).status_code == 200
    stored = client.get(f"/api/v1/accessibility/preferences/{patient['id']}")
    assert stored.status_code == 200
    assert stored.json()["communication_mode"] == "deaf"
    assert stored.json()["patient_id"] == patient["id"]


def test_save_and_get_preference_upsert(client: TestClient) -> None:
    patient = _create_patient(client, abha_id="13345678901234")
    first = client.post("/api/v1/accessibility/preferences", json={"patient_id": patient["id"], "communication_mode": "low_literacy"})
    assert first.status_code == 201
    assert first.json()["communication_mode"] == "low_literacy"
    # Upsert to deaf.
    second = client.post("/api/v1/accessibility/preferences", json={"patient_id": patient["id"], "communication_mode": "deaf"})
    assert second.status_code == 201
    stored = client.get(f"/api/v1/accessibility/preferences/{patient['id']}")
    assert stored.status_code == 200
    assert stored.json()["communication_mode"] == "deaf"


def test_get_preference_missing_returns_404(client: TestClient) -> None:
    missing = client.get(f"/api/v1/accessibility/preferences/{uuid.uuid4()}")
    assert missing.status_code == 404
