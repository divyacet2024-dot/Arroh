"""Follow-up lifecycle, due processing, task, and timeline tests."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4
import uuid as _uuid_module


def _staff_headers(client):
    email = f"staff-fl-{_uuid_module.uuid4()}@test.local"
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "Test Staff", "email": email, "password": "TestPass123!"},
    )
    assert resp.status_code == 201, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def patient(client):
    response = client.post("/api/v1/patients/", json={
        "name": "Follow Up Patient", "gender": "female", "birth_date": "1991-01-01",
        "abha_id": f"{uuid4().int % 10**14:014d}", "district": "Mandya", "state": "Karnataka",
    })
    assert response.status_code == 201
    return response.json()


def create(client, patient_id, **overrides):
    payload = {
        "patient_id": patient_id, "follow_up_type": "POST_TREATMENT",
        "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "priority": "ROUTINE", "high_risk": False,
    }
    payload.update(overrides)
    response = client.post("/api/v1/follow-ups", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def transition(client, follow_up_id, status, key=None):
    return client.post(f"/api/v1/follow-ups/{follow_up_id}/transition", json={
        "target_status": status, "actor_id": "asha-1", "actor_role": "ASHA",
        "reason": "Community care", "notes": "Recorded offline", "idempotency_key": key or str(uuid4()),
    })


def test_follow_up_complete_lifecycle_history_task_and_timeline(client):
    patient_record = patient(client)
    follow_up = create(client, patient_record["id"])
    assert follow_up["status"] == "SCHEDULED"
    follow_up_id = follow_up["id"]
    for status in ("DUE", "IN_PROGRESS", "COMPLETED"):
        response = transition(client, follow_up_id, status)
        assert response.status_code == 200, response.text
    history = client.get(f"/api/v1/follow-ups/{follow_up_id}/history")
    assert history.status_code == 200
    assert [item["to_status"] for item in history.json()] == ["DUE", "IN_PROGRESS", "COMPLETED"]
    detail = client.get(f"/api/v1/follow-ups/{follow_up_id}").json()
    assert detail["status"] == "COMPLETED"
    assert detail["next_allowed_transitions"] == []
    assert detail["linked_task_id"]
    timeline = client.get(f"/api/v1/patients/{patient_record['id']}/timeline", headers=_staff_headers(client)).json()["events"]
    follow_up_events = [event for event in timeline if event["event_type"].startswith("FOLLOW_UP_")]
    assert {event["event_type"] for event in follow_up_events} >= {"FOLLOW_UP_CREATED", "FOLLOW_UP_SCHEDULED", "FOLLOW_UP_DUE", "FOLLOW_UP_STARTED", "FOLLOW_UP_COMPLETED", "FOLLOW_UP_TASK_CREATED"}
    assert all(event["details"]["follow_up_id"] == follow_up_id for event in follow_up_events)


def test_reschedule_missed_cancel_invalid_and_idempotent(client):
    patient_record = patient(client)
    follow_up = create(client, patient_record["id"])
    follow_up_id = follow_up["id"]
    assert transition(client, follow_up_id, "DUE").status_code == 200
    key = str(uuid4())
    first = transition(client, follow_up_id, "RESCHEDULED", key)
    second = transition(client, follow_up_id, "RESCHEDULED", key)
    assert first.status_code == second.status_code == 200
    assert len(client.get(f"/api/v1/follow-ups/{follow_up_id}/history").json()) == 2
    assert transition(client, follow_up_id, "DUE").status_code == 200
    assert transition(client, follow_up_id, "MISSED").status_code == 200
    assert transition(client, follow_up_id, "COMPLETED").status_code == 409

    cancelled = create(client, patient_record["id"])
    assert transition(client, cancelled["id"], "CANCELLED").status_code == 200
    assert transition(client, cancelled["id"], "DUE").status_code == 409


def test_due_endpoint_escalates_high_risk_overdue_and_deduplicates_task(client):
    patient_record = patient(client)
    follow_up = create(client, patient_record["id"], due_at=(datetime.now(timezone.utc) - timedelta(hours=72)).isoformat(), high_risk=True, priority="URGENT")
    response = client.get("/api/v1/follow-ups/due")
    assert response.status_code == 200
    assert any(item["id"] == follow_up["id"] for item in response.json()["overdue"])
    detail = client.get(f"/api/v1/follow-ups/{follow_up['id']}").json()
    assert detail["status"] == "MISSED"
    assert detail["linked_task_id"]
    timeline = client.get(f"/api/v1/patients/{patient_record['id']}/timeline", headers=_staff_headers(client)).json()["events"]
    event_types = {event["event_type"] for event in timeline}
    assert "FOLLOW_UP_ESCALATED" in event_types
    assert len([event for event in timeline if event["event_type"] == "FOLLOW_UP_TASK_CREATED"]) == 1


def test_duplicate_source_reference_creates_one_follow_up(client):
    patient_record = patient(client)
    source = f"discharge:{uuid4()}"
    first = create(client, patient_record["id"], source_reference=source)
    second = create(client, patient_record["id"], source_reference=source)
    assert first["id"] == second["id"]
    assert len(client.get(f"/api/v1/patients/{patient_record['id']}/follow-ups").json()) == 1
