"""Step 6 consultation, diagnostics, discharge, and continuity tests."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4


def _patient(client):
    response = client.post("/api/v1/patients/", json={
        "name": "Consultation Patient", "gender": "female", "birth_date": "1985-02-03",
        "abha_id": f"{uuid4().int % 10**14:014d}", "district": "Mandya", "state": "Karnataka",
        "triage_status": "RED",
    })
    assert response.status_code == 201
    return response.json()


def test_referral_consultation_diagnostics_discharge_follow_up_timeline(client):
    patient = _patient(client)
    referral_response = client.post("/api/v1/referrals/create", json={
        "patient_id": patient["id"], "origin_phc_id": "PHC-01", "target_facility_id": "CHC-01",
        "target_facility_name": "District CHC", "target_facility_type": "CHC", "referral_priority": "RED",
        "reason_for_referral": "Urgent clinical assessment required.", "required_capabilities": ["OBSTETRIC_CARE"],
    })
    referral = referral_response.json()
    for status in ("PATIENT_INFORMED", "SCHEDULED", "TRAVEL_STARTED", "REACHED"):
        response = client.post(f"/api/v1/referrals/{referral['referral_id']}/transition", json={
            "target_status": status, "actor_id": "doctor-1", "actor_role": "DOCTOR", "idempotency_key": str(uuid4()),
        })
        assert response.status_code == 200, response.text

    consultation_response = client.post("/api/v1/consultations", json={
        "patient_id": patient["id"], "referral_id": referral["referral_id"], "doctor_id": "doctor-1",
        "chief_complaint": "Severe headache", "history": "Pregnant patient with visual symptoms",
        "findings": "Facial swelling", "vitals": {"systolic_bp": 170, "diastolic_bp": 110, "triage_level": "RED"},
        "assessment": "Danger signs require urgent care", "clinical_impression": "Suspected pre-eclampsia",
        "treatment_plan": "Observe and treat according to clinician protocol", "local_uuid": f"consult-{uuid4()}",
    })
    assert consultation_response.status_code == 201, consultation_response.text
    consultation = consultation_response.json()
    complete = client.post(f"/api/v1/consultations/{consultation['id']}/complete", json={"doctor_id": "doctor-1"})
    assert complete.status_code == 200
    assert complete.json()["status"] == "COMPLETED"

    diagnostic = client.post("/api/v1/consultations/diagnostics", json={
        "consultation_id": consultation["id"], "investigation_name": "Blood pressure review",
        "indication": "Assess severe hypertension", "requested_by": "doctor-1",
    })
    assert diagnostic.status_code == 201
    result = client.post("/api/v1/consultations/diagnostic-results", json={
        "investigation_id": diagnostic.json()["id"], "result_value": "170/110 mmHg",
        "units": "mmHg", "performed_at": datetime.now(timezone.utc).isoformat(), "verified_by": "doctor-1",
    })
    assert result.status_code == 201

    due_at = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    discharge = client.post("/api/v1/consultations/discharge", json={
        "consultation_id": consultation["id"], "doctor_id": "doctor-1", "diagnosis": "Suspected pre-eclampsia",
        "treatment_instructions": "Continue clinician-directed observation", "medication_instructions": [{"name": "Clinician-prescribed medicine", "dose": "As recorded"}],
        "warning_signs": ["Severe headache", "Blurred vision"], "emergency_return_instructions": "Return immediately for worsening symptoms",
        "follow_up_required": True, "follow_up_due_at": due_at,
    })
    assert discharge.status_code == 201, discharge.text
    plan = discharge.json()
    assert plan["diagnosis"] == "Suspected pre-eclampsia"

    summary = client.get(f"/api/v1/consultations/{consultation['id']}")
    assert summary.status_code == 200
    assert summary.json()["discharge_plan"]["treatment_instructions"] == "Continue clinician-directed observation"
    assert summary.json()["follow_up_id"]

    timeline = client.get(f"/api/v1/patients/{patient['id']}/timeline").json()["events"]
    event_types = {event["event_type"] for event in timeline}
    assert {"CONSULTATION_STARTED", "CONSULTATION_COMPLETED", "DIAGNOSTIC_REQUESTED", "DIAGNOSTIC_RESULT_RECORDED", "DISCHARGE_PLAN_CREATED", "FOLLOW_UP_CREATED"}.issubset(event_types)
    assert any(event["details"].get("reference_id") == plan["id"] for event in timeline if event["event_type"] == "DISCHARGE_PLAN_CREATED")


def test_consultation_invalid_completion_and_missing_discharge_follow_up_date(client):
    patient = _patient(client)
    response = client.post("/api/v1/consultations", json={"patient_id": patient["id"], "doctor_id": "doctor-2"})
    consultation = response.json()
    assert client.post(f"/api/v1/consultations/{consultation['id']}/complete", json={"doctor_id": "doctor-2"}).status_code == 200
    assert client.post(f"/api/v1/consultations/{consultation['id']}/complete", json={"doctor_id": "doctor-2"}).status_code == 409
    bad_discharge = client.post("/api/v1/consultations/discharge", json={
        "consultation_id": consultation["id"], "doctor_id": "doctor-2", "diagnosis": "Assessment",
        "treatment_instructions": "Instructions", "emergency_return_instructions": "Return if worse",
        "follow_up_required": True,
    })
    assert bad_discharge.status_code == 409
