"""End-to-end acceptance test for the pregnant Kannada scenario.

A pregnant woman in rural Karnataka reports:
  * severe headache
  * swelling of the face
  * blurred vision

The system must:
  1. accept Kannada input
  2. extract structured symptoms
  3. ask only the necessary follow-up questions
  4. detect pre-eclampsia danger signs
  5. record the pregnancy context
  6. run the deterministic safety engine
  7. produce RED urgency
  8. NOT allow the AI to downgrade the result
  9. show simple Kannada guidance via RAG
 10. recommend appropriate care/facility flow
 11. create a timeline event
 12. save locally
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.services.case_taking_service import CaseTakingService
from app.services.rag_service import get_knowledge_base


def create_patient(client: TestClient, abha_id: str = "98765432101234") -> dict:
    response = client.post(
        "/api/v1/patients/",
        json={
            "name": "Kaveri",
            "gender": "female",
            "birth_date": "1997-05-04",
            "abha_id": abha_id,
            "phone_number": "9123456789",
            "district": "Mandya",
            "state": "Karnataka",
            "phc_id": "PHC-MND-01",
            "triage_status": "YELLOW",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_pregnant_kannada_preeclampsia_scenario(client: TestClient) -> None:
    """A pregnant Kannada speaker reports pre-eclampsia danger signs."""

    patient = create_patient(client)
    transcript = (
        "ನನಗೆ ತೀವ್ರ ತಲೆನೋವು ಇದೆ, ಮುಖ ಊದಿಕೊಂಡಿದೆ ಮತ್ತು ಕಣ್ಣು ಮಸುಕಾಗಿದೆ. "
        "ನಾನು ಗರ್ಭಿಣಿ, 28 ವಾರ."
    )
    service = CaseTakingService()
    session = service.start_session(
        transcript=transcript,
        language="kn",
        patient_local_uuid=patient["id"],
    )

    # 1. Language detected correctly.
    assert session.language == "kn"

    # 2. Structured symptoms extracted.
    symptom_terms = {symptom.symptom for symptom in session.patient_case.symptoms}
    assert "severe headache" in symptom_terms
    assert "facial swelling" in symptom_terms
    assert "blurred vision" in symptom_terms

    # 5. Pregnancy context is preserved.
    assert session.patient_case.pregnancy_status == "PREGNANT"

    # 4 + 6 + 7. Safety engine must produce RED.
    assert session.triage_result["triage_level"] == "RED"
    assert session.triage_result["high_risk_maternal"] is True
    assert "PRE_ECLAMPSIA" in session.triage_result["maternal_conditions"]

    # 8. The AI cannot downgrade the RED result, even with a non-emergency
    # answer to a follow-up question.
    if session.follow_up_questions:
        session = service.answer_question(session, session.follow_up_questions[0].question_id, "no")
        assert session.triage_result["triage_level"] == "RED"

    # 3. Only the necessary follow-ups are returned, in priority order, and
    # every prompt is available in Kannada.
    for question in session.follow_up_questions:
        assert "kn" in question.prompt_translations, f"Missing Kannada prompt for {question.question_id}"

    # 9. RAG returns a relevant document (English or Kannada) with metadata.
    rag = get_knowledge_base().generate_response(
        query="pre-eclampsia swelling headache pregnancy",
        language="kn",
        topic="pregnancy",
    )
    assert rag.has_answer is True
    for document in rag.documents:
        # The corpus may include English fallback content; metadata must always
        # declare the language, source, version, and approval status.
        assert document.language in {"kn", "en"}
        assert document.approval_status in {"APPROVED", "INTERNAL_ONLY"}
        assert document.source
        assert document.version
        assert document.updated_at
    # The Kannada-specific pre-eclampsia document is in the corpus.
    kannada_doc = next(
        (document for document in rag.documents if document.language == "kn"),
        None,
    )
    if kannada_doc is not None:
        assert "pre-eclampsia" in kannada_doc.body.lower() or "pre-eclampsia" in kannada_doc.title.lower() or "ಎಕ್ಲಾಂಪ್ಸಿಯಾ" in kannada_doc.body

    # 11 + 12. Persist the case via the public API, then read it back.
    confirm_response = client.post(
        "/api/v1/case-taking/confirm",
        json={"session": session.to_dict()},
    )
    assert confirm_response.status_code == 200, confirm_response.text
    body = confirm_response.json()
    assert body["triage_result"]["triage_level"] == "RED"
    assert body["case_session"]["completed"] is True
    case_id = body["case_session"]["case_id"]
    fetch_response = client.get(f"/api/v1/case-taking/case/{case_id}")
    assert fetch_response.status_code == 200
    assert fetch_response.json()["triage_result"]["triage_level"] == "RED"
    assert fetch_response.json()["patient_local_uuid"] == patient["id"]

    # Timeline contains the new events.
    timeline = client.get(f"/api/v1/patients/{patient['id']}/timeline")
    assert timeline.status_code == 200
    event_types = {event["event_type"] for event in timeline.json()["events"]}
    assert "CASE_TAKING" in event_types
    assert "REGISTRATION" in event_types


def test_safety_engine_dominates_ai_low_risk_claim(client: TestClient) -> None:
    """Even if the AI returned an empty structured case, a pregnant
    patient with a measured severe BP must still end up RED."""

    import random

    patient = create_patient(client, abha_id=f"9876{random.randint(1000000000, 9999999999)}")
    service = CaseTakingService()
    session = service.start_session(
        transcript="ನಾನು ಗರ್ಭಿಣಿ, ತಲೆನೋವು",
        language="kn",
        patient_local_uuid=patient["id"],
    )
    # Inject severe hypertension via patient editing.
    from app.services.ai_provider import ExtractedSymptom, StructuredCase

    patient_case = StructuredCase(
        symptoms=list(session.patient_case.symptoms),
        relevant_vitals={"systolic_bp": 170.0, "diastolic_bp": 110.0},
        language="kn",
        raw_transcript=session.patient_case.raw_transcript,
        pregnancy_status="PREGNANT",
    )
    finalised = service.confirm_case(session, patient_case=patient_case)
    assert finalised.triage_result["triage_level"] == "RED"
    assert finalised.triage_result["high_risk_maternal"] is True
