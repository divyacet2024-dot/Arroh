"""Explainable demand-signal forecasting for PHC essential supplies.

For the SIH demonstration, each PHC begins with a configurable baseline stock
profile. Recent synced observations adjust daily consumption by syndrome; a real
deployment replaces the baseline provider with the state logistics system.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PHCInventoryItem:
    """Baseline stock data required for a simple, auditable replenishment forecast."""

    medicine_name: str
    current_stock_level: float
    daily_consumption_rate: float
    reorder_threshold: float
    signal_terms: tuple[str, ...]


BASELINE_INVENTORY: tuple[PHCInventoryItem, ...] = (
    PHCInventoryItem("Medical Oxygen Cylinders", 12, 0.4, 4, ("dyspnea", "breathlessness", "shortness of breath", "respiratory", "pneumonia", "asthma")),
    PHCInventoryItem("Snake Antivenom", 20, 0.1, 5, ("snakebite", "snake bite")),
    PHCInventoryItem("Insulin", 50, 0.6, 14, ("diabetes", "hyperglycemia", "high blood sugar")),
    PHCInventoryItem("Maternal Care Kits", 100, 0.7, 21, ("pregnancy", "antenatal", "maternal", "postpartum")),
)


def _log_matches(log: dict[str, Any], terms: tuple[str, ...]) -> bool:
    """Match syndrome signals from sync log symptoms without assuming all fields exist."""

    symptoms = log.get("symptoms", [])
    if not isinstance(symptoms, list):
        symptoms = [symptoms]
    text = " ".join(str(item).lower() for item in symptoms)
    return any(term in text for term in terms)


def predict_phc_stockouts(phc_id: str, active_patient_logs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Forecast critical stock depletion for one PHC from current triage demand signals.

    Each matching triage observation increases the relevant daily consumption rate.
    The method intentionally handles sparse or partially synchronized logs by
    falling back to conservative baseline consumption rather than failing.
    """

    forecasts: list[dict[str, Any]] = []
    for item in BASELINE_INVENTORY:
        matching_logs = sum(_log_matches(log, item.signal_terms) for log in active_patient_logs)
        red_cases = sum(
            _log_matches(log, item.signal_terms) and str(log.get("triage_status", "")).upper() == "RED"
            for log in active_patient_logs
        )
        demand_multiplier = 1 + min(matching_logs * 0.35 + red_cases * 0.5, 5.0)
        daily_rate = round(item.daily_consumption_rate * demand_multiplier, 2)
        days = round(item.current_stock_level / daily_rate, 1)
        if days <= 3 or item.current_stock_level <= item.reorder_threshold or red_cases >= 4:
            forecast_status = "CRITICAL_STOCKOUT_RISK"
        elif days <= 7 or item.current_stock_level <= item.reorder_threshold * 2 or red_cases >= 2 or matching_logs >= 5:
            forecast_status = "STABLE"
        else:
            forecast_status = "ADEQUATE"
        signal = f"{matching_logs} matching case(s), including {red_cases} RED triage case(s)"
        forecasts.append(
            {
                "medicine_name": item.medicine_name,
                "current_stock_level": item.current_stock_level,
                "estimated_daily_consumption": daily_rate,
                "reorder_threshold": item.reorder_threshold,
                "estimated_days_until_stockout": days,
                "status": forecast_status,
                "demand_signal": signal,
            }
        )
    return forecasts
