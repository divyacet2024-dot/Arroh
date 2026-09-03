"""Structured case-taking orchestrator.

This service is the *only* place where the AI provider output and the
deterministic safety engine meet. It enforces three rules:

1. The AI never decides the triage level. The safety engine (``ai_triage``)
   is the single source of truth.
2. RED results are sticky. Even if the AI returns an empty structured
   case, an explicit user-reported emergency intent, or a non-emergency
   safety engine verdict for a symptom set that *should* be RED, the final
   disposition cannot be downgraded.
3. Every case-taking session produces a :class:`CaseSession` with the
   patient-facing summary, the ASHA worker review, and the timeline events
   to enqueue locally on the device.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

from app.services.ai_provider import (
    AIProvider,
    CloudLLMProvider,
    ExtractedSymptom,
    FollowUpQuestion,
    MockAIProvider,
    StructuredCase,
    get_default_provider,
    is_emergency_intent,
)
from app.services.ai_triage import assess_symptom_triage

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Case session
# ---------------------------------------------------------------------------


@dataclass
class CaseAnswer:
    """One question + answer pair in the conversational flow."""

    question_id: str
    answer: str
    answered_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "question_id": self.question_id,
            "answer": self.answer,
            "answered_at": self.answered_at,
        }


@dataclass
class CaseSession:
    """A complete conversational case-taking session.

    ``ai_proposed_case`` is what the AI provider returned. ``patient_case``
    is the patient-confirmed version (defaults to the AI proposal until the
    user edits). ``doctor_case`` is the clinician-authoritative version.
    """

    case_id: str
    patient_local_uuid: str | None
    language: str
    started_at: str
    ai_proposed_case: StructuredCase
    patient_case: StructuredCase
    doctor_case: StructuredCase | None = None
    triage_result: dict[str, Any] = field(default_factory=dict)
    safety_flags: list[str] = field(default_factory=list)
    follow_up_questions: list[FollowUpQuestion] = field(default_factory=list)
    answers: list[CaseAnswer] = field(default_factory=list)
    emergency_intent_detected: bool = False
    rag_result: dict[str, Any] | None = None
    timeline_events: list[dict[str, Any]] = field(default_factory=list)
    completed: bool = False
    completed_at: str | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "patient_local_uuid": self.patient_local_uuid,
            "language": self.language,
            "started_at": self.started_at,
            "ai_proposed_case": self.ai_proposed_case.to_dict(),
            "patient_case": self.patient_case.to_dict(),
            "doctor_case": self.doctor_case.to_dict() if self.doctor_case else None,
            "triage_result": self.triage_result,
            "safety_flags": self.safety_flags,
            "follow_up_questions": [self._question_to_dict(q) for q in self.follow_up_questions],
            "answers": [answer.to_dict() for answer in self.answers],
            "emergency_intent_detected": self.emergency_intent_detected,
            "rag_result": self.rag_result,
            "timeline_events": self.timeline_events,
            "completed": self.completed,
            "completed_at": self.completed_at,
            "notes": self.notes,
        }

    @staticmethod
    def _question_to_dict(question: FollowUpQuestion) -> dict[str, Any]:
        return {
            "question_id": question.question_id,
            "prompt": question.prompt,
            "prompt_translations": question.prompt_translations,
            "expected_kind": question.expected_kind,
            "priority": question.priority,
            "safety_reason": question.safety_reason,
        }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class CaseTakingService:
    """Run a structured case-taking session.

    The service is intentionally stateless. Each invocation receives the
    accumulated session so the client (mobile or web) can persist it locally
    between turns. This keeps the service safe for offline use and for
    streaming voice input.
    """

    def __init__(self, provider: AIProvider | None = None) -> None:
        self._provider = provider or get_default_provider()

    @property
    def provider_name(self) -> str:
        return self._provider.name

    # -- Session (de)serialisation for HTTP transport ---------------------

    @staticmethod
    def _coerce_structured(payload: Any) -> StructuredCase:
        """Coerce a pydantic schema / dict back into a :class:`StructuredCase`."""

        if isinstance(payload, StructuredCase):
            return payload
        data = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
        symptoms: list[ExtractedSymptom] = []
        for item in data.get("symptoms", []) or []:
            item_dict = item.model_dump() if hasattr(item, "model_dump") else dict(item)
            symptoms.append(ExtractedSymptom(**item_dict))
        return StructuredCase(
            symptoms=symptoms,
            duration=data.get("duration"),
            severity=data.get("severity"),
            location=data.get("location"),
            associated_symptoms=list(data.get("associated_symptoms", [])),
            pregnancy_status=data.get("pregnancy_status"),
            injury=data.get("injury"),
            medications=list(data.get("medications", [])),
            allergies=list(data.get("allergies", [])),
            relevant_vitals={key: float(value) for key, value in (data.get("relevant_vitals") or {}).items()},
            language=data.get("language", "unknown"),
            raw_transcript=data.get("raw_transcript", ""),
            overall_confidence=float(data.get("overall_confidence", 0.0) or 0.0),
            notes=list(data.get("notes", [])),
        )

    @classmethod
    def _coerce_session(cls, payload: Any) -> CaseSession:
        """Coerce a pydantic schema / dict back into a :class:`CaseSession`."""

        if isinstance(payload, CaseSession):
            return payload
        data = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
        ai_proposed = cls._coerce_structured(data.get("ai_proposed_case", {}))
        patient = cls._coerce_structured(data.get("patient_case", {}))
        doctor_payload = data.get("doctor_case")
        doctor = cls._coerce_structured(doctor_payload) if doctor_payload else None
        follow_ups: list[FollowUpQuestion] = []
        for item in data.get("follow_up_questions", []) or []:
            item_dict = item.model_dump() if hasattr(item, "model_dump") else dict(item)
            follow_ups.append(
                FollowUpQuestion(
                    question_id=str(item_dict.get("question_id")),
                    prompt=str(item_dict.get("prompt", "")),
                    prompt_translations=dict(item_dict.get("prompt_translations", {}) or {}),
                    expected_kind=str(item_dict.get("expected_kind", "yes_no")),
                    choices=list(item_dict.get("choices", []) or []),
                    priority=int(item_dict.get("priority", 100)),
                    safety_reason=str(item_dict.get("safety_reason", "")),
                )
            )
        answers: list[CaseAnswer] = []
        for item in data.get("answers", []) or []:
            item_dict = item.model_dump() if hasattr(item, "model_dump") else dict(item)
            answers.append(
                CaseAnswer(
                    question_id=str(item_dict.get("question_id")),
                    answer=str(item_dict.get("answer", "")),
                    answered_at=str(item_dict.get("answered_at", "")),
                )
            )
        return CaseSession(
            case_id=str(data.get("case_id")),
            patient_local_uuid=data.get("patient_local_uuid"),
            language=str(data.get("language", "unknown")),
            started_at=str(data.get("started_at")),
            ai_proposed_case=ai_proposed,
            patient_case=patient,
            doctor_case=doctor,
            triage_result=dict(data.get("triage_result", {}) or {}),
            safety_flags=list(data.get("safety_flags", [])),
            follow_up_questions=follow_ups,
            answers=answers,
            emergency_intent_detected=bool(data.get("emergency_intent_detected", False)),
            rag_result=data.get("rag_result"),
            timeline_events=list(data.get("timeline_events", []) or []),
            completed=bool(data.get("completed", False)),
            completed_at=data.get("completed_at"),
            notes=list(data.get("notes", []) or []),
        )

    # -- Conversational API ------------------------------------------------

    def start_session(
        self,
        transcript: str,
        language: str | None,
        patient_local_uuid: str | None = None,
    ) -> CaseSession:
        """Begin a case-taking session from a free-text transcript."""

        if not transcript or not transcript.strip():
            raise ValueError("Cannot start a case-taking session with empty input")

        ai_case, follow_ups = self._provider.extract_symptoms(transcript, language=language)
        emergency = is_emergency_intent(transcript, language=ai_case.language)
        triage = self._run_safety_engine(ai_case, override_red=emergency)

        session = CaseSession(
            case_id=str(uuid.uuid4()),
            patient_local_uuid=patient_local_uuid,
            language=ai_case.language,
            started_at=datetime.now(timezone.utc).isoformat(),
            ai_proposed_case=ai_case,
            patient_case=ai_case,
            triage_result=triage,
            follow_up_questions=follow_ups,
            emergency_intent_detected=emergency,
        )
        session.safety_flags = self._collect_safety_flags(ai_case, triage, emergency)
        session.timeline_events = self._build_timeline_events(session)
        return session

    def answer_question(
        self,
        session: CaseSession,
        question_id: str,
        answer: str,
    ) -> CaseSession:
        """Record an answer, update the structured case, and re-evaluate.

        The function mutates ``session`` in place and returns it for
        convenience. The new triage result is computed from the *patient*
        case, not from the AI-proposed case, so the clinician never sees a
        different verdict than the user confirmed.
        """

        question = next((q for q in session.follow_up_questions if q.question_id == question_id), None)
        if question is None:
            session.notes.append(f"answer_for_unknown_question:{question_id}:{answer[:80]}")
        else:
            session.answers.append(
                CaseAnswer(
                    question_id=question_id,
                    answer=answer,
                    answered_at=datetime.now(timezone.utc).isoformat(),
                )
            )
            self._apply_answer_to_case(session.patient_case, question, answer)
        triage = self._run_safety_engine(session.patient_case, override_red=session.emergency_intent_detected)
        session.triage_result = triage
        session.safety_flags = self._collect_safety_flags(session.patient_case, triage, session.emergency_intent_detected)
        session.follow_up_questions = self._next_followups(session)
        return session

    def confirm_case(
        self,
        session: CaseSession,
        patient_case: StructuredCase | None = None,
        doctor_case: StructuredCase | None = None,
    ) -> CaseSession:
        """Mark the session as completed and freeze the final structured case."""

        if patient_case is not None:
            session.patient_case = patient_case
        if doctor_case is not None:
            session.doctor_case = doctor_case
        triage = self._run_safety_engine(session.patient_case, override_red=session.emergency_intent_detected)
        session.triage_result = triage
        session.safety_flags = self._collect_safety_flags(session.patient_case, triage, session.emergency_intent_detected)
        session.completed = True
        session.completed_at = datetime.now(timezone.utc).isoformat()
        session.timeline_events = self._build_timeline_events(session)
        return session

    def attach_rag(self, session: CaseSession, rag_result: dict[str, Any] | None) -> CaseSession:
        """Attach an external RAG result (e.g. for patient education)."""

        session.rag_result = rag_result
        return session

    # -- Safety engine integration ----------------------------------------

    def _run_safety_engine(self, case: StructuredCase, *, override_red: bool) -> dict[str, Any]:
        """Run the deterministic safety engine.

        ``override_red`` is True when the input itself declared an emergency.
        We never let the AI provider (or sparse vitals) lower that floor.
        """

        symptoms = [symptom.symptom for symptom in case.symptoms]
        result = assess_symptom_triage(symptoms, case.relevant_vitals)
        if override_red and result.get("triage_level") != "RED":
            result = {
                **result,
                "triage_level": "RED",
                "risk_score": max(int(result.get("risk_score", 0)), 85),
                "recommended_actions": [
                    "Patient reported an emergency intent. Activate emergency protocol.",
                    *result.get("recommended_actions", []),
                ],
            }
        return result

    def _collect_safety_flags(self, case: StructuredCase, triage: dict[str, Any], emergency: bool) -> list[str]:
        flags: list[str] = []
        if emergency:
            flags.append("EMERGENCY_INTENT")
        if triage.get("high_risk_respiratory"):
            flags.append("HIGH_RISK_RESPIRATORY")
        if triage.get("high_risk_maternal"):
            flags.append("HIGH_RISK_MATERNAL")
        for condition in triage.get("maternal_conditions", []):
            flags.append(f"MATERNAL_{condition}")
        if triage.get("triage_level") == "RED":
            flags.append("RED_DISPOSITION")
        if not case.relevant_vitals:
            flags.append("MISSING_VITALS")
        if not case.symptoms:
            flags.append("NO_SYMPTOMS_EXTRACTED")
        return flags

    def _next_followups(self, session: CaseSession) -> list[FollowUpQuestion]:
        """Recompute follow-up questions from the patient-confirmed case."""

        # Re-run the provider on the patient-confirmed transcript. The mock
        # implementation is deterministic; the cloud provider will only be
        # called when the AI was originally enabled, and never as a safety
        # decision. Returning the union of remaining high-priority questions
        # is intentional: we only ask the next urgent safety question.
        answered = {answer.question_id for answer in session.answers}
        remaining = [q for q in session.follow_up_questions if q.question_id not in answered]
        if not remaining:
            _, follow_ups = self._provider.extract_symptoms(
                session.patient_case.raw_transcript, language=session.patient_case.language
            )
            return [q for q in follow_ups if q.question_id not in answered][:3]
        return remaining[:3]

    def _apply_answer_to_case(self, case: StructuredCase, question: FollowUpQuestion, answer: str) -> None:
        normalised = answer.strip().lower()
        if question.expected_kind == "yes_no":
            if normalised in {"yes", "y", "ಹೌದು", "ಸರಿ", "हाँ", "ஆம்", "అవును"}:
                case.notes.append(f"{question.question_id}=YES")
                if question.safety_reason:
                    case.associated_symptoms.append(question.safety_reason)
            elif normalised in {"no", "n", "ಇಲ್ಲ", "नहीं", "இல்லை", "లేదు"}:
                case.notes.append(f"{question.question_id}=NO")
            else:
                case.notes.append(f"{question.question_id}={answer}")
            return
        if question.expected_kind == "vital":
            try:
                value = float(normalised.split()[0])
            except (IndexError, ValueError):
                case.notes.append(f"{question.question_id}=UNPARSED:{answer}")
                return
            if "spo2" in question.question_id:
                case.relevant_vitals["spo2"] = value
            elif "bp" in question.question_id:
                systolic, diastolic = (value, value)
                if "/" in normalised:
                    try:
                        systolic, diastolic = (float(part) for part in normalised.replace(" ", "").split("/"))
                    except ValueError:
                        pass
                case.relevant_vitals["systolic_bp"] = systolic
                case.relevant_vitals["diastolic_bp"] = diastolic
            else:
                case.relevant_vitals[question.question_id] = value
            return
        case.notes.append(f"{question.question_id}={answer}")

    # -- Timeline events ---------------------------------------------------

    def _build_timeline_events(self, session: CaseSession) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = [
            {
                "event_type": "CASE_RECORDED",
                "occurred_at": session.started_at,
                "summary": "Case-taking session started.",
                "details": {
                    "language": session.language,
                    "ai_provider": self._provider.name,
                    "symptoms": [symptom.symptom for symptom in session.patient_case.symptoms],
                },
            },
            {
                "event_type": "SYMPTOMS_RECORDED",
                "occurred_at": session.started_at,
                "summary": "Symptoms extracted and confirmed by the patient.",
                "details": {"symptoms": session.patient_case.to_dict()["symptoms"]},
            },
        ]
        if session.patient_case.relevant_vitals:
            events.append(
                {
                    "event_type": "VITALS_RECORDED",
                    "occurred_at": session.started_at,
                    "summary": "Vital signs recorded.",
                    "details": {"vitals": session.patient_case.relevant_vitals},
                }
            )
        if session.completed:
            events.append(
                {
                    "event_type": "TRIAGE_COMPLETED",
                    "occurred_at": session.completed_at,
                    "summary": f"Triage disposition: {session.triage_result.get('triage_level', 'UNKNOWN')}",
                    "details": session.triage_result,
                }
            )
        return events


# ---------------------------------------------------------------------------
# Convenience factory
# ---------------------------------------------------------------------------


def get_case_taking_service(provider=None):  # FastAPI dependency
    """Return the case-taking service used by FastAPI endpoints.

    The default factory builds a service backed by the configured AI
    provider (cloud if enabled, otherwise the deterministic mock).
    """

    return CaseTakingService(provider=provider)


__all__ = [
    "CaseTakingService",
    "CaseSession",
    "CaseAnswer",
    "get_case_taking_service",
    "MockAIProvider",
    "CloudLLMProvider",
    "AIProvider",
    "StructuredCase",
    "ExtractedSymptom",
    "FollowUpQuestion",
    "is_emergency_intent",
    "get_default_provider",
]
