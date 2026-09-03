"""Safe decoder for compact emergency payloads sent over standard SMS."""

import base64
import binascii
import gzip
import json
import zlib
from typing import Any

from app.db.models.patient import TriageStatus


def _decode_transport(payload: str) -> bytes:
    """Decode URL-safe base64 first, then strict hexadecimal as a fallback."""

    compact = payload.strip()
    try:
        padded = compact + "=" * (-len(compact) % 4)
        return base64.b64decode(padded, altchars=b"-_", validate=True)
    except (binascii.Error, ValueError):
        try:
            return bytes.fromhex(compact)
        except ValueError as exc:
            raise ValueError("SMS payload must be valid base64 or hexadecimal") from exc


def decode_sms_payload(compressed_payload: str) -> dict[str, Any]:
    """Decode a zero-internet emergency record into fields ready for persistence.

    ARROH SMS clients send UTF-8 JSON compressed with zlib (preferred) or gzip and
    encoded as URL-safe base64 or hex. For interoperability with basic feature
    phones, an uncompressed pipe form is also accepted:
    ``ABHA|PHONE|SYMPTOM|SPO2|HR|BP|TRIAGE``.
    """

    raw = _decode_transport(compressed_payload)
    for decompressor in (zlib.decompress, gzip.decompress):
        try:
            raw = decompressor(raw)
            break
        except (OSError, zlib.error):
            continue
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        try:
            abha_id, phone_number, symptom_code, spo2, heart_rate, blood_pressure, triage = raw.decode("utf-8").split("|")
            decoded = {
                "abha_id": abha_id or None,
                "phone_number": phone_number or None,
                "primary_symptom_code": symptom_code,
                "spo2": spo2,
                "heart_rate": heart_rate,
                "blood_pressure": blood_pressure,
                "triage_status": triage,
            }
        except (UnicodeDecodeError, ValueError) as exc:
            raise ValueError("SMS payload is not a recognized emergency record") from exc

    triage = str(decoded.get("triage_status", "")).upper()
    if triage not in {item.value for item in TriageStatus}:
        raise ValueError("SMS payload contains an invalid triage status")
    if not decoded.get("abha_id") and not decoded.get("phone_number"):
        raise ValueError("SMS payload requires an ABHA ID or phone number")

    return {
        "abha_id": decoded.get("abha_id"),
        "phone_number": decoded.get("phone_number"),
        "primary_symptom_code": str(decoded.get("primary_symptom_code", "UNKNOWN")),
        "vitals": {
            "spo2": decoded.get("spo2"),
            "heart_rate": decoded.get("heart_rate"),
            "temperature": decoded.get("temperature", decoded.get("temp")),
            "blood_pressure": decoded.get("blood_pressure"),
        },
        "triage_status": triage,
    }
