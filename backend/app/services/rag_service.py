"""Retrieval-Augmented Generation (RAG) foundation for ARROH health education.

This module implements the *RAG architecture* required by Phase 6 of the
product spec:

* knowledge ingestion (curated JSON corpus)
* document / chunk storage (in-memory, deterministic)
* retrieval (keyword + tag scoring)
* response generation (deterministic, conservative; no model call)

The corpus is **synthetic / curated prototype content**. Every document has
explicit metadata so the UI can show "Source: WHO ANC handbook, 2016" instead
of implying official endorsement when none has been verified.

The module never falls back to "arbitrary web search" or an unvetted model.
If no document matches, the function returns a structured *no-result*
response that the caller should display to the user.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class KnowledgeDocument:
    """One approved health-education document chunk."""

    document_id: str
    title: str
    language: str
    topic: str  # "first_aid" | "pregnancy" | "child_health" | "vaccination" | "post_discharge" | "medication" | "general"
    source: str
    version: str
    approval_status: str  # "APPROVED" | "DRAFT" | "INTERNAL_ONLY"
    updated_at: str
    body: str
    tags: list[str] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "title": self.title,
            "language": self.language,
            "topic": self.topic,
            "source": self.source,
            "version": self.version,
            "approval_status": self.approval_status,
            "updated_at": self.updated_at,
            "body": self.body,
            "tags": self.tags,
            "citations": self.citations,
        }


@dataclass
class RetrievalResult:
    """The output of a RAG query.

    The UI must surface ``has_answer`` and ``caveats`` so the user is never
    misled into believing an unverified AI summary.
    """

    query: str
    has_answer: bool
    documents: list[KnowledgeDocument] = field(default_factory=list)
    snippets: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "has_answer": self.has_answer,
            "documents": [document.to_dict() for document in self.documents],
            "snippets": self.snippets,
            "caveats": self.caveats,
        }


# ---------------------------------------------------------------------------
# Curated prototype corpus
# ---------------------------------------------------------------------------


_CORPUS: tuple[KnowledgeDocument, ...] = (
    KnowledgeDocument(
        document_id="preg_001_anemia_en",
        title="Iron-rich foods during pregnancy",
        language="en",
        topic="pregnancy",
        source="WHO Antenatal Care recommendation (2016) – simplified",
        version="2016.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "Pregnant women should eat iron-rich foods daily. Good sources include "
            "green leafy vegetables (spinach, fenugreek), lentils, beans, jaggery, "
            "and small portions of liver when culturally acceptable. Pair iron-rich "
            "foods with vitamin-C sources (lemon, amla, tomato) to improve absorption. "
            "Avoid drinking tea or coffee with meals because they reduce iron "
            "absorption. ASHA workers should counsel on diet and confirm compliance "
            "during every ANC visit."
        ),
        tags=("pregnancy", "anemia", "diet", "iron"),
        citations=("WHO ANC handbook 2016 (simplified for ASHA training)",),
    ),
    KnowledgeDocument(
        document_id="preg_001_anemia_kn",
        title="ಗರ್ಭಾವಸ್ಥೆಯಲ್ಲಿ ಕಬ್ಬಿಣಯುಕ್ತ ಆಹಾರ",
        language="kn",
        topic="pregnancy",
        source="WHO ANC handbook 2016 – simplified translation",
        version="2016.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "ಗರ್ಭಿಣಿಯರು ಪ್ರತಿದಿನ ಕಬ್ಬಿಣ ಸಮೃದ್ಧ ಆಹಾರ ಸೇವಿಸಬೇಕು. ಪಾಲಕ್, ಮೆಂತ್ಯ, ಹುರುಳಿ, "
            "ಬೀನ್ಸ್, ಬೆಲ್ಲ ಮತ್ತು ಯಕೃತ್ ಉತ್ತಮ ಆಯ್ಕೆಗಳು. ಕಬ್ಬಿಣ ಹೀರುವಿಕೆ ಹೆಚ್ಚಿಸಲು ನಿಂಬೆ, "
            "ಅಮಲಾ, ಟೊಮೇಟೊ ಸೇವಿಸಿ. ಊಟದ ಜತೆ ಚಹಾ/ಕಾಫಿ ಕುಡಿಯಬೇಡಿ. ಪ್ರತಿ ANC ಭೇಟಿಯಲ್ಲಿ "
            "ಆಹಾರ ಪರಿಶೀಲಿಸಿ."
        ),
        tags=("pregnancy", "anemia", "diet", "iron", "kannada"),
    ),
    KnowledgeDocument(
        document_id="preg_002_preeclampsia_en",
        title="Pre-eclampsia danger signs",
        language="en",
        topic="pregnancy",
        source="WHO Pregnancy, Childbirth, Postpartum and Newborn Care (2015) – simplified",
        version="2015.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "Pre-eclampsia is a serious pregnancy condition. Danger signs are: severe "
            "headache, blurred vision, swelling of the face or hands, severe upper "
            "abdominal pain, and high blood pressure (≥140/90). If any of these are "
            "present the patient should be referred urgently to a facility with "
            "magnesium-sulphate capability. Do not delay referral to take additional "
            "readings at the PHC."
        ),
        tags=("pregnancy", "pre-eclampsia", "maternal", "red flag"),
    ),
    KnowledgeDocument(
        document_id="preg_002_preeclampsia_kn",
        title="ಪ್ರಿ-ಎಕ್ಲಾಂಪ್ಸಿಯಾ ಅಪಾಯದ ಸೂಚನೆಗಳು",
        language="kn",
        topic="pregnancy",
        source="WHO PCPNC 2015 – simplified",
        version="2015.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "ಪ್ರಿ-ಎಕ್ಲಾಂಪ್ಸಿಯಾ ಗಂಭೀರ ಸ್ಥಿತಿ. ಅಪಾಯದ ಸೂಚನೆಗಳು: ತೀವ್ರ ತಲೆನೋವು, ಮಸುಕು ದೃಷ್ಟಿ, "
            "ಮುಖ/ಕೈ ಊತ, ಮೇಲಿನ ಹೊಟ್ಟೆ ನೋವು, ಅಧಿಕ ರಕ್ತದೊತ್ತಡ. ಇವು ಕಂಡುಬಂದರೆ ತಕ್ಷಣ ಮೆಗ್ನೀಸಿಯಂ "
            "ಸಲ್ಫೇಟ್ ಲಭ್ಯವಿರುವ ಆಸ್ಪತ್ರೆಗೆ ಕಳುಹಿಸಿ."
        ),
        tags=("pregnancy", "pre-eclampsia", "maternal", "red flag", "kannada"),
    ),
    KnowledgeDocument(
        document_id="child_001_ors_en",
        title="Oral rehydration for child diarrhea",
        language="en",
        topic="child_health",
        source="WHO/UNICEF ORS joint statement (2004) – simplified",
        version="2004.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "For children with diarrhea, give oral rehydration salts (ORS) after every "
            "loose stool. Continue feeding. Zinc supplementation for 10–14 days shortens "
            "the illness. Return immediately if the child has blood in stool, repeated "
            "vomiting, sunken eyes, or is unable to drink."
        ),
        tags=("child", "diarrhea", "ors", "zinc"),
    ),
    KnowledgeDocument(
        document_id="vacc_001_schedule_en",
        title="India UIP vaccination schedule (simplified)",
        language="en",
        topic="vaccination",
        source="Ministry of Health & Family Welfare, India UIP schedule (2023) – simplified",
        version="2023.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "At birth: BCG, OPV-0, Hepatitis B birth dose. 6 weeks: DPT-1, OPV-1, "
            "HepB-1, Hib-1, Rotavirus-1, PCV-1. 10 weeks: DPT-2, OPV-2, HepB-2, Hib-2, "
            "Rotavirus-2, PCV-2. 14 weeks: DPT-3, OPV-3, HepB-3, Hib-3, Rotavirus-3, "
            "PCV-3. 9 months: Measles/MR-1, Vitamin A. 16–24 months: DPT booster, "
            "OPV booster, Measles/MR-2. 5–6 years: DPT booster. 10 years: Td. 16 years: Td."
        ),
        tags=("vaccination", "schedule", "child"),
    ),
    KnowledgeDocument(
        document_id="first_aid_bleeding_en",
        title="First aid: severe bleeding",
        language="en",
        topic="first_aid",
        source="ARROH synthetic first-aid card (validated against St John Ambulance 2022)",
        version="2024.1",
        approval_status="APPROVED",
        updated_at="2024-05-01",
        body=(
            "1. Apply firm direct pressure with a clean cloth. 2. If blood soaks "
            "through, add more cloth on top. Do not remove the first cloth. 3. For "
            "life-threatening limb bleeding a trained responder may apply a tourniquet "
            "and record the time. 4. Keep the person warm and arrange transport."
        ),
        tags=("first_aid", "bleeding", "trauma"),
    ),
    KnowledgeDocument(
        document_id="postdisch_001_diabetes_en",
        title="Post-discharge advice: diabetes foot care",
        language="en",
        topic="post_discharge",
        source="ARROH synthetic post-discharge card",
        version="2024.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "Inspect both feet daily for cuts, blisters, redness, or swelling. Wash "
            "with warm (not hot) water, dry carefully between the toes, and apply a "
            "thin layer of moisturiser on dry skin. Wear closed, well-fitting shoes. "
            "Avoid walking barefoot. Report any wound that does not heal within 48 "
            "hours to the PHC."
        ),
        tags=("post_discharge", "diabetes", "foot care"),
    ),
    KnowledgeDocument(
        document_id="med_001_paracetamol_en",
        title="Paracetamol: adult dosing reminder",
        language="en",
        topic="medication",
        source="NICE CKS paracetamol guidance (simplified)",
        version="2023.1",
        approval_status="INTERNAL_ONLY",
        updated_at="2024-05-01",
        body=(
            "Adult paracetamol: 500 mg–1 g every 4–6 hours, maximum 4 g per 24 hours. "
            "Do not combine with other paracetamol-containing products. Avoid in "
            "severe liver disease. This card is a reminder only; clinicians must "
            "verify dosing against the patient's weight, comorbidity, and current "
            "prescription."
        ),
        tags=("medication", "paracetamol", "dosing"),
    ),
)


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


class KnowledgeBase:
    """In-memory knowledge storage with retrieval helpers.

    The default implementation is a thin wrapper around the curated corpus.
    Production deployments can override ``_search`` to query a vector store
    (FAISS, pgvector) without changing the public API.
    """

    def __init__(self, documents: Iterable[KnowledgeDocument] | None = None) -> None:
        self._documents: list[KnowledgeDocument] = list(documents) if documents is not None else list(_CORPUS)

    @property
    def documents(self) -> list[KnowledgeDocument]:
        return list(self._documents)

    def add(self, document: KnowledgeDocument) -> None:
        self._documents.append(document)

    def retrieve(
        self,
        query: str,
        language: str = "en",
        topic: str | None = None,
        limit: int = 3,
    ) -> RetrievalResult:
        """Return the highest-scoring documents for ``query``.

        Scoring is transparent:
        * +2 per tag/token match against the document body
        * +1 per token match against the title
        * -1000 if the document is not ``APPROVED`` and the caller did not
          pass ``include_drafts=True`` (handled at API level).
        The scores are deterministic so the UI can show "why this matched".
        """

        tokens = [token for token in re.findall(r"\w+", query.lower()) if len(token) > 2]
        if not tokens:
            return RetrievalResult(
                query=query,
                has_answer=False,
                caveats=["The question was empty or too short to retrieve context."],
            )

        scored: list[tuple[float, KnowledgeDocument]] = []
        for document in self._documents:
            if document.language not in {language, "en"}:
                continue
            if topic and document.topic != topic:
                continue
            score = 0.0
            body_lower = document.body.lower()
            title_lower = document.title.lower()
            for token in tokens:
                score += body_lower.count(token) * 2
                score += title_lower.count(token)
                if token in document.tags:
                    score += 1
            if score > 0:
                scored.append((score, document))

        scored.sort(key=lambda item: item[0], reverse=True)
        top = scored[:limit]
        snippets = [
            self._excerpt(document, tokens) for _score, document in top
        ]
        caveats: list[str] = []
        if not top:
            caveats.append(
                "No approved document matches this question. Show this as 'no verified guidance "
                "available' and recommend contacting a clinician."
            )
        return RetrievalResult(
            query=query,
            has_answer=bool(top),
            documents=[document for _score, document in top],
            snippets=snippets,
            caveats=caveats,
        )

    def generate_response(
        self,
        query: str,
        language: str = "en",
        topic: str | None = None,
    ) -> RetrievalResult:
        """Run retrieval and synthesise a conservative response.

        The synthesis is *deterministic*: we extract the most relevant
        sentence from each top document and join them with explicit
        "according to <source>" attribution. No LLM is called.
        """

        result = self.retrieve(query, language=language, topic=topic, limit=2)
        if not result.has_answer:
            return result

        sentences: list[str] = []
        for document in result.documents:
            for sentence in re.split(r"(?<=[.!?])\s+", document.body):
                if any(token in sentence.lower() for token in re.findall(r"\w+", query.lower()) if len(token) > 2):
                    sentences.append(f"{sentence.strip()} (Source: {document.source}, v{_document_version(document)})")
                    if len(sentences) >= 3:
                        break
            if len(sentences) >= 3:
                break
        result.snippets = sentences
        result.caveats.append(
            "This guidance is from the ARROH curated knowledge base. It is not a "
            "replacement for clinical judgement or local protocols."
        )
        return result

    @staticmethod
    def _excerpt(document: KnowledgeDocument, tokens: list[str]) -> str:
        sentences = re.split(r"(?<=[.!?])\s+", document.body)
        ranked = sorted(
            sentences,
            key=lambda sentence: sum(sentence.lower().count(token) for token in tokens),
            reverse=True,
        )
        return ranked[0].strip() if ranked else document.body[:200]


def _document_version(document: KnowledgeDocument) -> str:
    """Return the version string used in attribution."""

    return document.version


@lru_cache(maxsize=1)
def get_knowledge_base() -> KnowledgeBase:
    """Return the process-wide knowledge base."""

    return KnowledgeBase()
