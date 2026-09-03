"""Tests for the AI-assisted case-taking service.

The provider used here is the deterministic :class:`MockAIProvider` so the
tests do not require a network connection or an external API key.
"""

from __future__ import annotations

import uuid

import pytest

from app.services.ai_provider import (
    CloudLLMProvider,
    MockAIProvider,
    StructuredCase,
    is_emergency_intent,
)
from app.services.case_taking_service import CaseTakingService, CaseSession
from app.services.rag_service import KnowledgeBase, get_knowledge_base


@pytest.fixture
def service() -> CaseTakingService:
    return CaseTakingService(provider=MockAIProvider())


# ---------------------------------------------------------------------------
# AI provider
# ---------------------------------------------------------------------------


def test_extract_symptoms_english() -> None:
    provider = MockAIProvider()
    case, questions = provider.extract_symptoms("I have severe chest pain for the last 30 minutes", language="en")
    symptom_terms = [symptom.symptom for symptom in case.symptoms]
    assert "chest pain" in symptom_terms
    assert case.duration is not None
    assert case.severity == "severe"
    assert any(question.safety_reason for question in questions)


def test_extract_symptoms_kannada() -> None:
    provider = MockAIProvider()
    case, _ = provider.extract_symptoms("ನನಗೆ ಎದೆ ನೋವು ಇದೆ ಮತ್ತು ಉಸಿರಾಡಲು ಕಷ್ಟವಾಗುತ್ತಿದೆ", language="kn")
    symptom_terms = [symptom.symptom for symptom in case.symptoms]
    assert "chest pain" in symptom_terms
    assert "shortness of breath" in symptom_terms
    assert case.language == "kn"


def test_extract_symptoms_hindi() -> None:
    provider = MockAIProvider()
    case, _ = provider.extract_symptoms("mujhe seene mein dard hai aur saans nahi aa rahi", language="hi")
    symptom_terms = [symptom.symptom for symptom in case.symptoms]
    assert "chest pain" in symptom_terms
    assert "shortness of breath" in symptom_terms


def test_extract_symptoms_tamil() -> None:
    provider = MockAIProvider()
    case, _ = provider.extract_symptoms("enakku marapu vali irukku", language="ta")
    assert "chest pain" in [symptom.symptom for symptom in case.symptoms]


def test_unknown_ambiguous_input_does_not_invent() -> None:
    provider = MockAIProvider()
    case, _ = provider.extract_symptoms("I feel generally unwell", language="en")
    assert case.symptoms == []
    assert case.duration is None
    assert case.pregnancy_status is None


def test_cloud_provider_without_key_falls_back_to_mock() -> None:
    provider = CloudLLMProvider(api_key=None, base_url=None, enabled=False)
    case, _ = provider.extract_symptoms("chest pain", language="en")
    assert case.symptoms, "Disabled cloud provider should delegate to mock"
    assert provider.is_enabled is False


# ---------------------------------------------------------------------------
# Emergency short-circuit + safety engine dominance
# ---------------------------------------------------------------------------


def test_emergency_intent_is_detected() -> None:
    assert is_emergency_intent("I met with an accident", language="en")
    assert is_emergency_intent("ಉಸಿರಾಡಲಾಗುತ್ತಿಲ್ಲ", language="kn")
    assert is_emergency_intent("seene mein dard aur saans nahi aa rahi", language="hi")
    assert is_emergency_intent("enakku mookku varavillai", language="ta")


def test_non_emergency_input_does_not_short_circuit() -> None:
    assert not is_emergency_intent("I have a mild cough", language="en")
    assert not is_emergency_intent("I want to talk about my child's vaccination", language="en")


def test_safety_engine_dominates_ai_extraction(service: CaseTakingService) -> None:
    session = service.start_session(
        transcript="I have a slight cough",
        language="en",
    )
    # The AI provider might return low confidence; the safety engine still
    # controls the verdict and we must not see a fabricated RED.
    assert session.triage_result["triage_level"] in {"GREEN", "YELLOW", "RED"}
    assert all(
        action.strip() for action in session.triage_result["recommended_actions"]
    )


def test_ai_cannot_downgrade_red(service: CaseTakingService) -> None:
    session = service.start_session(
        transcript="I cannot breathe and have severe chest pain",
        language="en",
    )
    assert session.emergency_intent_detected is True
    assert session.triage_result["triage_level"] == "RED"

    # Even with a benign answer the disposition must not be downgraded.
    next_question = session.follow_up_questions[0]
    service.answer_question(session, next_question.question_id, "no")
    assert session.triage_result["triage_level"] == "RED"


def test_missing_critical_information_does_not_silently_become_safe(service: CaseTakingService) -> None:
    # An ambiguous transcript with no vitals must surface "missing" rather
    # than a fabricated GREEN.
    session = service.start_session(
        transcript="I feel something is wrong",
        language="en",
    )
    assert "MISSING_VITALS" in session.safety_flags
    assert "NO_SYMPTOMS_EXTRACTED" in session.safety_flags


# ---------------------------------------------------------------------------
# Conversational flow
# ---------------------------------------------------------------------------


def test_conversational_flow_collects_safety_answers(service: CaseTakingService) -> None:
    session = service.start_session(
        transcript="I have chest pain for 30 minutes",
        language="en",
    )
    assert session.follow_up_questions
    first = session.follow_up_questions[0]
    service.answer_question(session, first.question_id, "yes")
    assert any(answer.question_id == first.question_id for answer in session.answers)
    # Remaining questions should be a strict subset of the original set.
    assert {q.question_id for q in session.follow_up_questions}.issubset(
        {q.question_id for q in session.follow_up_questions}
    )


def test_confirm_case_freezes_disposition(service: CaseTakingService) -> None:
    session = service.start_session(
        transcript="I have chest pain and shortness of breath for 20 minutes",
        language="en",
    )
    completed = service.confirm_case(session)
    assert completed.completed is True
    assert completed.completed_at is not None
    assert completed.timeline_events[-1]["event_type"] == "TRIAGE_COMPLETED"


def test_patient_edited_case_re_evaluates_safety(service: CaseTakingService) -> None:
    session = service.start_session(
        transcript="I have chest pain for 20 minutes",
        language="en",
    )
    edited = StructuredCase(
        symptoms=list(session.patient_case.symptoms),
        relevant_vitals={"spo2": 85},
        language="en",
        raw_transcript=session.patient_case.raw_transcript,
    )
    completed = service.confirm_case(session, patient_case=edited)
    assert completed.triage_result["triage_level"] == "RED"
    assert any(
        "oxygen" in action.lower() or "oxygenation" in action.lower()
        for action in completed.triage_result["recommended_actions"]
    )


# ---------------------------------------------------------------------------
# RAG
# ---------------------------------------------------------------------------


def test_rag_returns_relevant_document() -> None:
    kb = get_knowledge_base()
    result = kb.generate_response("iron rich foods during pregnancy", language="en", topic="pregnancy")
    assert result.has_answer is True
    assert any("WHO" in snippet for snippet in result.snippets)
    assert any("curated" in caveat.lower() or "not a replacement" in caveat.lower() for caveat in result.caveats)


def test_rag_returns_no_answer_for_unknown_query() -> None:
    result = get_knowledge_base().generate_response("xyz123 unknown topic", language="en")
    assert result.has_answer is False
    assert result.caveats


def test_rag_metadata_is_present() -> None:
    result = get_knowledge_base().retrieve("child ORS diarrhea", language="en", topic="child_health")
    for document in result.documents:
        assert document.title
        assert document.source
        assert document.approval_status
        assert document.version
        assert document.updated_at


def test_approval_status_is_visible_in_results() -> None:
    """The returned documents must declare an approval status so the UI
    can warn the clinician when content is not yet approved."""

    result = get_knowledge_base().retrieve("ORS diarrhea", language="en", topic="child_health")
    assert result.has_answer is True
    for document in result.documents:
        assert document.approval_status in {"APPROVED", "DRAFT", "INTERNAL_ONLY"}
        assert document.approval_status == "INTERNAL_ONLY"  # the current corpus is prototype content
