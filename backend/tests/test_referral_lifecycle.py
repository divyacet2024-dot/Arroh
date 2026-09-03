"""Public API coverage for the referral lifecycle foundation."""

from datetime import datetime
from uuid import uuid4
from uuid import UUID


def _create_referral(client):
    patient = client.post(
        "/api/v1/patients/",
        json={
            "name": "Lakshmi",
            "gender": "female",
            "birth_date": "1990-01-01",
            "abha_id": f"{uuid4().int % 10**14:014d}",
            "district": "Mandya",
            "state": "Karnataka",
            "phc_id": "PHC-MND-01",
        },
    ).json()
    response = client.post(
        "/api/v1/referrals/create",
        json={
            "patient_id": patient["id"],
            "origin_phc_id": "PHC-MND-01",
            "target_facility_id": "CHC-MND-01",
            "target_facility_name": "Mandya CHC",
            "target_facility_type": "CHC",
            "referral_priority": "RED",
            "reason_for_referral": "Urgent obstetric review required.",
            "required_capabilities": ["OBSTETRIC_CARE"],
        },
    )
    assert response.status_code == 201, response.text
    referral = response.json()
    assert referral["status"] == "CREATED"
    UUID(referral["referral_id"])
    return referral


def _transition(client, referral_id, target_status, key, reason="Clinical handoff", notes="Recorded by worker"):
    return client.post(
        f"/api/v1/referrals/{referral_id}/transition",
        json={
            "target_status": target_status,
            "actor_id": "asha-17",
            "actor_role": "ASHA",
            "reason": reason,
            "notes": notes,
            "idempotency_key": key,
        },
    )


def test_complete_referral_lifecycle_history_timeline_and_idempotency(client):
    referral = _create_referral(client)
    referral_id = referral["referral_id"]
    states = [
        "PATIENT_INFORMED", "SCHEDULED", "TRAVEL_STARTED", "REACHED",
        "CONSULTATION_COMPLETED", "DIAGNOSTIC_COMPLETED", "TREATMENT_STARTED",
        "FOLLOW_UP_REQUIRED", "COMPLETED",
    ]

    for index, state in enumerate(states):
        response = _transition(client, referral_id, state, f"referral-{referral_id}-{index}")
        assert response.status_code == 200, response.text
        assert response.json()["current_status"] == state

    duplicate = _transition(client, referral_id, states[0], f"referral-{referral_id}-0")
    assert duplicate.status_code == 200
    assert duplicate.json()["current_status"] == "COMPLETED"
    assert duplicate.json()["next_allowed_transitions"] == []

    history_response = client.get(f"/api/v1/referrals/{referral_id}/history")
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 9
    assert [item["to_status"] for item in history] == states
    assert all(item["actor_id"] == "asha-17" and item["actor_role"] == "ASHA" for item in history)
    assert history[0]["reason"] == "Clinical handoff"
    assert history[0]["notes"] == "Recorded by worker"

    timeline = client.get(f"/api/v1/patients/{referral["patient_id"]}/timeline")
    assert timeline.status_code == 200
    events = timeline.json()["events"]
    referral_events = [event for event in events if event["event_type"].startswith("REFERRAL_")]
    assert [event["event_type"] for event in referral_events] == ["REFERRAL_CREATED", *[f"REFERRAL_{state}" for state in states]]
    assert all(event["details"]["referral_id"] == referral_id for event in referral_events)
    assert all(event["details"]["actor_id"] for event in referral_events)
    occurred = [datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00")) for event in events]
    assert occurred == sorted(occurred)


def test_illegal_and_terminal_referral_transitions_are_rejected(client):
    referral = _create_referral(client)
    referral_id = referral["referral_id"]
    for target_status in ("COMPLETED", "SCHEDULED"):
        response = _transition(client, referral_id, target_status, f"invalid-{target_status}")
        assert response.status_code == 409

    _transition(client, referral_id, "PATIENT_INFORMED", "cancel-path-1")
    cancelled = _transition(client, referral_id, "CANCELLED", "cancel-path-2")
    assert cancelled.status_code == 200
    terminal_attempt = _transition(client, referral_id, "SCHEDULED", "cancel-path-3")
    assert terminal_attempt.status_code == 409


def test_missing_or_malformed_transition_is_rejected(client):
    missing = client.post(
        "/api/v1/referrals/00000000-0000-0000-0000-000000000000/transition",
        json={"target_status": "SCHEDULED", "actor_id": "a", "actor_role": "ASHA", "idempotency_key": "missing"},
    )
    assert missing.status_code == 404
    malformed = client.post("/api/v1/referrals/not-a-uuid/transition", json={})
    assert malformed.status_code == 422


def test_actor_role_is_validated_without_claiming_authorization(client):
    referral = _create_referral(client)
    response = client.post(
        f"/api/v1/referrals/{referral['referral_id']}/transition",
        json={
            "target_status": "PATIENT_INFORMED",
            "actor_id": "worker-1",
            "actor_role": "UNTRUSTED_ROLE",
            "idempotency_key": "invalid-role",
        },
    )
    assert response.status_code == 409