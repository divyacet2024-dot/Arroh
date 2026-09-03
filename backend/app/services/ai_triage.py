"""Explainable, offline-capable clinical prioritization for SIH demonstrations.

This rules engine is intentionally deterministic: it can run at the edge without
internet or a model download, and always shows the factors behind its output.
It supports clinician prioritization; it is not a diagnosis or a replacement for
local emergency protocols.
"""

from typing import Any


def _numeric_vital(vitals: dict[str, Any], *keys: str) -> float | None:
    """Read a numeric vital from common client naming conventions safely."""

    normalized = {str(key).lower().replace("_", " ").replace("-", " "): value for key, value in vitals.items()}
    for key in keys:
        value = normalized.get(key.lower().replace("_", " ").replace("-", " "))
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def _blood_pressure(vitals: dict[str, Any]) -> tuple[float | None, float | None]:
    """Read split BP fields or a common ``120/80`` blood-pressure representation."""

    systolic = _numeric_vital(vitals, "systolic_bp", "systolic", "bp_systolic")
    diastolic = _numeric_vital(vitals, "diastolic_bp", "diastolic", "bp_diastolic")
    if systolic is not None and diastolic is not None:
        return systolic, diastolic
    normalized = {str(key).lower().replace("_", " ").replace("-", " "): value for key, value in vitals.items()}
    value = normalized.get("bp") or normalized.get("blood pressure")
    if isinstance(value, str) and "/" in value:
        try:
            parsed_systolic, parsed_diastolic = (float(part.strip()) for part in value.split("/", maxsplit=1))
            return systolic or parsed_systolic, diastolic or parsed_diastolic
        except ValueError:
            pass
    return systolic, diastolic


def assess_symptom_triage(symptoms: list[str], vitals: dict[str, Any]) -> dict[str, Any]:
    """Prioritize a patient using available observations, with safe missing-data fallbacks.

    The score is capped at 100. Critical findings independently elevate the result
    to RED; incomplete readings never manufacture an emergency score and instead
    request a repeat measurement and clinician review.
    """

    symptom_text = " ".join(item.strip().lower() for item in symptoms)
    score = 0
    actions: list[str] = []
    respiratory_risk = False
    maternal_risk = False
    assessed: dict[str, float] = {}
    missing: list[str] = []

    spo2 = _numeric_vital(vitals, "spo2", "spO2", "oxygen saturation")
    systolic, diastolic = _blood_pressure(vitals)
    heart_rate = _numeric_vital(vitals, "heart_rate", "hr", "pulse")
    temperature = _numeric_vital(vitals, "temperature", "temp", "temperature_c")
    hemoglobin = _numeric_vital(vitals, "hemoglobin", "haemoglobin", "hb", "hgb")

    for label, value in (("SpO2", spo2), ("systolic_bp", systolic), ("diastolic_bp", diastolic), ("heart_rate", heart_rate), ("temperature", temperature)):
        if value is None:
            missing.append(label)
        else:
            assessed[label] = value
    if hemoglobin is not None:
        assessed["hemoglobin"] = hemoglobin

    if spo2 is not None:
        if spo2 < 90:
            score += 55
            respiratory_risk = True
            actions.append("Start emergency oxygen protocol and arrange immediate referral.")
        elif spo2 <= 92:
            score += 35
            respiratory_risk = True
            actions.append("Assess respiratory distress, repeat SpO2, and obtain urgent clinician review.")
        elif spo2 <= 94:
            score += 15
            actions.append("Repeat SpO2 and monitor for respiratory deterioration.")

    if systolic is not None:
        if systolic < 90:
            score += 35
            actions.append("Position patient safely, assess for shock, and urgently escalate.")
        elif systolic >= 180:
            score += 25
            actions.append("Repeat blood pressure manually and request urgent clinician review.")
    if diastolic is not None and diastolic >= 120:
        score += 25
        actions.append("Treat as severe hypertension pending clinician assessment.")
    if heart_rate is not None:
        if heart_rate < 45 or heart_rate > 130:
            score += 25
            actions.append("Monitor pulse closely and arrange urgent clinician assessment.")
        elif heart_rate > 110:
            score += 10
    if temperature is not None:
        if temperature >= 40:
            score += 25
            actions.append("Begin fever safety measures and urgently assess for severe infection.")
        elif temperature >= 39:
            score += 15

    respiratory_terms = ("shortness of breath", "severe dyspnea", "severe breathlessness", "difficulty breathing", "respiratory distress")
    if any(term in symptom_text for term in respiratory_terms):
        score += 40
        respiratory_risk = True
        actions.append("Keep patient upright if tolerated and prioritize emergency respiratory assessment.")
    if "chest pain" in symptom_text:
        score += 35
        actions.append("Obtain urgent clinician assessment for chest pain and avoid exertion.")
    if "high fever" in symptom_text or "altered consciousness" in symptom_text:
        score += 25
        actions.append("Check consciousness and infection danger signs; escalate urgently.")
    # --- Maternal & obstetric high-risk assessment ---------------------------
    # Detects pre-eclampsia, antepartum hemorrhage, and severe anemia in
    # pregnancy. High-risk pregnancy findings are treated as RED priorities
    # because they can deteriorate quickly; this is triage priority, not a
    # diagnosis, and local obstetric protocols always take precedence.
    pregnancy_terms = ("pregnant", "pregnancy", "expecting", "antepartum", "gestation", "in labour", "in labor", "in some months")
    is_pregnant = any(term in symptom_text for term in pregnancy_terms)

    pre_eclampsia = False
    antepartum_hemorrhage = False
    severe_anemia_pregnancy = False
    maternal_conditions: list[str] = []

    # Broad maternal danger signal (e.g. any abnormal bleeding during/after pregnancy).
    broad_maternal_terms = ("abnormal bleeding", "postpartum bleeding", "postbirth bleeding", "post-partum bleeding")
    if any(term in symptom_text for term in broad_maternal_terms):
        score += 45
        maternal_risk = True
        actions.append("Activate maternal emergency pathway, assess blood loss, and arrange immediate obstetric referral.")

    # Antepartum hemorrhage (bleeding after 20 weeks of pregnancy).
    aph_terms = (
        "antepartum hemorrhage", "antepartum haemorrhage", "vaginal bleeding in pregnancy",
        "bleeding during pregnancy", "pregnancy bleeding", "blood loss in pregnancy",
        "placenta previa", "placental abruption", "abruptio placentae",
    )
    if any(term in symptom_text for term in aph_terms):
        antepartum_hemorrhage = True
        maternal_risk = True
        score += 45
        actions.append("Suspect antepartum hemorrhage: keep the patient at pelvic rest, monitor blood loss, and refer urgently to a facility with maternity and blood-bank capability.")

    # Pre-eclampsia / eclampsia.
    pe_terms = ("pre-eclampsia", "preeclampsia", "pre eclampsia")
    pe_features = (
        "severe headache", "visual disturbance", "blurred vision", "flashing lights",
        "epigastric pain", "upper abdominal pain", "swelling of face", "facial swelling",
        "oedema", "edema", "proteinuria",
    )
    if any(term in symptom_text for term in pe_terms):
        pre_eclampsia = True
        maternal_risk = True
        score += 45
        actions.append("Pre-eclampsia identified: arrange urgent obstetric assessment, blood-pressure control, and referral to a magnesium-sulphate-capable obstetric unit.")
        if any(term in symptom_text for term in pe_features):
            score += 15
            actions.append("Pre-eclampsia danger signs present (severe headache, visual disturbance, epigastric pain, facial swelling): treat as severe pre-eclampsia and escalate without delay.")
    elif is_pregnant and ((systolic is not None and systolic >= 140) or (diastolic is not None and diastolic >= 90)):
        pre_eclampsia = True
        maternal_risk = True
        if (systolic is not None and systolic >= 160) or (diastolic is not None and diastolic >= 110):
            score += 50
            actions.append("Severe hypertension in pregnancy: manage as severe pre-eclampsia and escalate urgently to an obstetric unit.")
        else:
            score += 40
            actions.append("Hypertension in pregnancy: assess for pre-eclampsia (headache, visual disturbance, epigastric pain, swelling) and arrange urgent obstetric review.")
        if any(term in symptom_text for term in pe_features):
            actions.append("Danger signs alongside hypertension in pregnancy: request immediate obstetric referral for magnesium-sulphate-capable care.")
    elif is_pregnant and any(term in symptom_text for term in pe_features):
        # A pregnant patient reporting two or more classic pre-eclampsia
        # danger signs (severe headache, visual disturbance, epigastric pain,
        # facial swelling) is a suspected pre-eclampsia case even without a
        # confirmed blood-pressure reading. Treat as RED and request a
        # confirmatory reading at the PHC; do not wait for vitals to be
        # measured before triggering emergency escalation.
        pre_eclampsia = True
        maternal_risk = True
        score += 50
        actions.append("Pregnant patient reports pre-eclampsia danger signs (severe headache / visual disturbance / facial swelling / epigastric pain): treat as suspected pre-eclampsia and arrange urgent obstetric referral.")

    # Severe anemia in pregnancy.
    anemia_signal = is_pregnant or any(term in symptom_text for term in ("severe anemia", "severe anaemia", "pallor", "extreme fatigue", "severe weakness", "severe tiredness"))
    if is_pregnant and hemoglobin is not None and hemoglobin < 7:
        severe_anemia_pregnancy = True
        maternal_risk = True
        score += 35
        actions.append("Very low hemoglobin in pregnancy: treat as severe anemia and refer urgently for blood-transfusion capability and obstetric review.")
    elif is_pregnant and hemoglobin is not None and hemoglobin < 9:
        severe_anemia_pregnancy = True
        maternal_risk = True
        score += 20
        actions.append("Low hemoglobin in pregnancy: initiate iron/folate guidance, counsel on diet, and arrange early obstetric and hemoglobin review.")
    elif is_pregnant and any(term in symptom_text for term in ("severe anemia", "severe anaemia", "pallor", "extreme fatigue", "severe weakness", "severe tiredness")):
        severe_anemia_pregnancy = True
        maternal_risk = True
        score += 25
        actions.append("Symptoms consistent with severe anemia in pregnancy: measure hemoglobin and arrange urgent obstetric review.")
    if anemia_signal and hemoglobin is None and "hemoglobin" not in missing:
        missing.append("hemoglobin")

    if pre_eclampsia:
        maternal_conditions.append("PRE_ECLAMPSIA")
    if antepartum_hemorrhage:
        maternal_conditions.append("ANTEPARTUM_HEMORRHAGE")
    if severe_anemia_pregnancy:
        maternal_conditions.append("SEVERE_ANEMIA_PREGNANCY")

    score = min(score, 100)
    if score >= 50 or respiratory_risk and spo2 is not None and spo2 <= 92 or maternal_risk:
        triage_level = "RED"
    elif score >= 25:
        triage_level = "YELLOW"
    else:
        triage_level = "GREEN"

    if not actions:
        actions.append("Provide routine community care advice and reassess if symptoms worsen.")
    if missing:
        actions.append("Missing readings: repeat available vital measurements and document the result.")
    if triage_level == "RED":
        actions.append("Do not delay local emergency escalation or referral for this software assessment.")

    return {
        "risk_score": score,
        "triage_level": triage_level,
        "recommended_actions": list(dict.fromkeys(actions)),
        "high_risk_respiratory": respiratory_risk,
        "high_risk_maternal": maternal_risk,
        "maternal_conditions": maternal_conditions,
        "assessed_vitals": assessed,
        "missing_vitals": missing,
    }
