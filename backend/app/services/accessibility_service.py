"""Re-format a triage assessment for a patient's communication mode.

The outputs are deliberately short, concrete and non-clinical so an ASHA worker
or a patient with low literacy, hearing impairment, or a speech impairment can
act on them immediately. They are presentation helpers only and never change the
underlying clinical triage decision.
"""

from typing import Any

_LEVEL_TEXT: dict[str, str] = {
    "RED": "Urgent. Emergency help is needed right now.",
    "YELLOW": "Needs attention soon — please assess quickly.",
    "GREEN": "Routine. Low risk right now.",
}


def _shorten(action: str) -> str:
    """Collapse a long clinical recommendation into a readable action chip."""

    action = action.strip().rstrip(".")
    if "," in action:
        action = action.split(",", 1)[0]
    return action if len(action) <= 80 else action[:77] + "..."


def _build_read_aloud_script(level: str, score: int, actions: list[str]) -> str:
    """Compose a short, plain-spoken script for low-literacy voice narration."""

    level_text = _LEVEL_TEXT.get(level, "Please review this patient carefully.")
    parts = [f"Patient priority is {level} with a score of {score} out of 100. {level_text}"]
    if actions:
        parts.append("Here is what to do next.")
        for index, action in enumerate(actions[:3], start=1):
            parts.append(f"Step {index}. {_shorten(action)}.")
    return " ".join(parts)


def format_triage_for_mode(triage_payload: dict[str, Any], mode: str) -> dict[str, Any]:
    """Produce visual captions, a read-aloud script, and an interpreter flag."""

    level = str(triage_payload.get("triage_level", "GREEN")).upper()
    score = int(triage_payload.get("risk_score", 0) or 0)
    actions = [str(action) for action in triage_payload.get("recommended_actions", [])]
    maternal = triage_payload.get("maternal_conditions", [])
    respiratory = bool(triage_payload.get("high_risk_respiratory", False))

    visual_captions: list[str] = [
        f"{level} alert · priority {score}/100",
        _LEVEL_TEXT.get(level, "Please review this patient carefully."),
    ]
    if maternal:
        visual_captions.append("This is a high-risk pregnancy.")
    if respiratory:
        visual_captions.append("Breathing help may be needed.")
    for action in actions[:4]:
        visual_captions.append(_shorten(action))

    simplified_actions = [_shorten(action) for action in actions[:4]] or ["Review patient and confirm next steps."]

    return {
        "communication_mode": mode,
        "sign_interpreter_requested": mode == "deaf",
        "visual_captions": visual_captions,
        "read_aloud_script": _build_read_aloud_script(level, score, actions),
        "simplified_actions": simplified_actions,
    }
