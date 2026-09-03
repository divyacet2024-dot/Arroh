"""End-to-end verification of ARROH's public API surface and maternal triage."""

import uuid

from fastapi.testclient import TestClient


def create_patient(client: TestClient, abha_id: str = "12345678901234") -> dict:
    """Register a patient and return the persisted record."""
    response = client.post(
        "/api/v1/patients/",
        json={
            "name": "Demo Patient",
            "gender": "female",
            "birth_date": "1990-01-01",
            "abha_id": abha_id,
            "phone_number": "9876543210",
            "district": "Dakshina Kannada",
            "state": "Karnataka",
            "phc_id": "PHC-LOCAL",
            "triage_status": "YELLOW",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_default_symptoms_are_green(client: TestClient) -> None:
    response = client.post(
        "/api/v1/triage/assess",
        json={"symptoms": ["mild fever", "cough"], "vitals": {"spo2": 97, "heart_rate": 80, "temperature": 38.2}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["triage_level"] == "GREEN"
    assert body["high_risk_maternal"] is False
    assert body["maternal_conditions"] == []


def test_triage_detects_pre_eclampsia_when_pregnant_and_hypertensive(client: TestClient) -> None:
    response = client.post(
        "/api/v1/triage/assess",
        json={"symptoms": ["pregnant", "severe headache"], "vitals": {"systolic_bp": 165, "diastolic_bp": 105}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["triage_level"] == "RED"
    assert body["high_risk_maternal"] is True
    assert "PRE_ECLAMPSIA" in body["maternal_conditions"]


def test_triage_detects_antepartum_hemorrhage(client: TestClient) -> None:
    response = client.post(
        "/api/v1/triage/assess",
        json={"symptoms": ["pregnant", "vaginal bleeding in pregnancy"], "vitals": {"heart_rate": 120}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["high_risk_maternal"] is True
    assert "ANTEPARTUM_HEMORRHAGE" in body["maternal_conditions"]


def test_triage_detects_severe_anemia_in_pregnancy(client: TestClient) -> None:
    response = client.post(
        "/api/v1/triage/assess",
        json={"symptoms": ["pregnant", "pallor"], "vitals": {"hemoglobin": 6.4}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["high_risk_maternal"] is True
    assert "SEVERE_ANEMIA_PREGNANCY" in body["maternal_conditions"]
    assert body["assessed_vitals"]["hemoglobin"] == 6.4


def test_voice_parse_and_triage_maternal(client: TestClient) -> None:
    response = client.post(
        "/api/v1/voice/parse-and-triage",
        json={
            "transcript": "A pregnant woman with pre-eclampsia, severe headache, blood pressure 160 over 105, hemoglobin 6.4",
            "language": "en",
        },
    )
    assert response.status_code == 200
    body = response.json()
    extracted = body["extracted_clinical_data"]
    assert "pregnancy" in extracted["symptoms"]
    assert "pre-eclampsia" in extracted["symptoms"]
    assert extracted["vitals"]["bp"] == "160/105"
    assessment = body["triage_assessment"]
    assert assessment["triage_level"] == "RED"
    assert "PRE_ECLAMPSIA" in assessment["maternal_conditions"]


def test_voice_parse_persists_triage_log_with_abha(client: TestClient) -> None:
    patient = create_patient(client, abha_id="12345678901234")
    response = client.post(
        "/api/v1/voice/parse-and-triage",
        json={
            "transcript": "pregnant, extreme fatigue, hemoglobin 6.4",
            "language": "en",
            "abha_id": patient["abha_id"],
        },
    )
    assert response.status_code == 200
    assert response.json()["triage_assessment"]["high_risk_maternal"] is True


def test_voice_agent_emergency_session_trauma(client: TestClient) -> None:
    response = client.post(
        "/api/v1/voice-agent/emergency-session",
        json={
            "spoken_emergency_text": "severe road accident, head injury, heavy bleeding, spo2 82, heart rate 125",
            "language": "en",
            "current_phc_id": "PHC-LOCAL",
            "ambulance_eta_minutes": 30,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "EMERGENCY_SESSION_ACTIVE"
    assert body["triage_result"]["triage_level"] == "RED"
    assert body["rag_first_aid"]["instructions"]
    assert body["recommended_facility"] is not None


def test_referrals_recommend_maternal_capability(client: TestClient) -> None:
    patient = create_patient(client, abha_id="22345678901234")
    response = client.post(
        "/api/v1/referrals/recommend",
        json={
            "patient_id": patient["id"],
            "triage_level": "RED",
            "required_capabilities": ["OBSTETRIC_CARE", "BLOOD_BANK"],
            "vitals": {"spo2": 96},
            "high_risk_respiratory": False,
            "origin_phc_id": "PHC-LOCAL",
        },
    )
    assert response.status_code == 200
    recommendations = response.json()["recommendations"]
    assert recommendations
    any_maternal = any(
        "OBSTETRIC_CARE" in facility["capabilities"] or "MATERNAL_CARE" in facility["capabilities"]
        for facility in recommendations
    )
    assert any_maternal
    assert recommendations[0]["distance_km"] <= recommendations[-1]["distance_km"]


def test_referrals_create(client: TestClient) -> None:
    patient = create_patient(client, abha_id="32345678901234")
    response = client.post(
        "/api/v1/referrals/create",
        json={
            "patient_id": patient["id"],
            "origin_phc_id": "PHC-LOCAL",
            "target_facility_id": "CHC-BEL-01",
            "target_facility_name": "CHC Belthangady",
            "target_facility_type": "CHC",
            "referral_priority": "RED",
            "reason_for_referral": "High-risk pregnancy requiring obstetric review.",
            "required_capabilities": ["OBSTETRIC_CARE", "BLOOD_BANK"],
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["referral_priority"] == "RED"
    assert "referral_id" in body
    assert uuid.UUID(body["referral_id"])


def test_prescriptions_create(client: TestClient) -> None:
    patient = create_patient(client, abha_id="42345678901234")
    response = client.post(
        "/api/v1/prescriptions/create",
        json={
            "patient_id": patient["id"],
            "doctor_id": "DR-001",
            "diagnosis": "Iron deficiency anemia in pregnancy",
            "medications": [
                {
                    "name": "Ferrous Sulphate",
                    "dosage": "1 tablet daily",
                    "frequency": "ONCE_DAILY",
                    "duration_days": 30,
                    "visual_identifier": "It is a small red tablet",
                }
            ],
            "language": "english",
            "follow_up_in_days": 7,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["follow_up_status"] == "PENDING"
    assert uuid.UUID(body["prescription_id"])
