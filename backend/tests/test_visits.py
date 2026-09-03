"""Step 5 — ASHA/ANM home-visit lifecycle tests."""

import uuid
from datetime import datetime, timedelta, timezone


def _create_patient(client, suffix: str) -> dict:
    response = client.post(
        "/api/v1/patients/",
        json={
            "name": f"Visit Patient {suffix}",
            "gender": "female",
            "birth_date": "1990-04-12",
            "abha_id": f"{(uuid.uuid4().int % 10**14):014d}",
            "district": "Mandya",
            "state": "Karnataka",
            "village": "Test Village",
            "phone_number": "+919999999999",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _worker_headers(actor_id: str = "asha-001", actor_role: str = "ASHA", phc_id: str = "PHC-BEL-01"):
    return {"X-Worker-Id": actor_id, "X-Worker-Role": actor_role, "X-PHC-Id": phc_id}


def test_create_visit_and_get(client):
    patient = _create_patient(client, "A")
    response = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["patient_id"] == patient["id"]
    assert body["actor_role"] == "ASHA"
    assert body["actor_id"] == "asha-001"
    assert body["visit_type"] == "general follow-up"
    assert body["outcome"] is None
    fetched = client.get(f"/api/v1/visits/{body['id']}").json()
    assert fetched["id"] == body["id"]
    assert fetched["local_uuid"] in (None, body["local_uuid"])


def test_record_vitals_partial_save_does_not_block(client):
    patient = _create_patient(client, "B")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "elderly care"},
        headers=_worker_headers(),
    ).json()
    response = client.post(
        f"/api/v1/visits/{visit['id']}/vitals",
        json={"spo2": 97, "pulse_bpm": 72, "weight_kg": 60.0},
        headers=_worker_headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["spo2"] == 97
    assert body["temperature_c"] is None
    assert body["systolic_bp"] is None


def test_record_symptoms_and_complete_follow_up_required(client):
    patient = _create_patient(client, "C")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    client.post(
        f"/api/v1/visits/{visit['id']}/symptoms",
        json={"symptoms": [{"symptom": "mild fever", "severity": "MILD"}]},
        headers=_worker_headers(),
    )
    due = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    response = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={
            "outcome": "FOLLOW_UP_REQUIRED",
            "findings": "Stable; revisit in 2 days",
            "follow_up": {
                "follow_up_type": "post-treatment",
                "due_at": due,
                "priority": "ROUTINE",
                "high_risk": False,
            },
        },
        headers=_worker_headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "FOLLOW_UP_REQUIRED"
    assert body["risk_level"] in {"GREEN", "YELLOW", "RED"}
    assert body["follow_up_id"]
    follow_up = client.get(f"/api/v1/follow-ups/{body['follow_up_id']}").json()
    assert follow_up["status"] in {"DUE", "IN_PROGRESS"}


def test_complete_visit_referral_required_creates_referral(client):
    patient = _create_patient(client, "D")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "pregnancy / maternal health"},
        headers=_worker_headers(),
    ).json()
    response = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={
            "outcome": "REFERRAL_REQUIRED",
            "findings": "Possible pre-eclampsia, refer for obstetric review",
            "referral": {
                "reason_for_referral": "Possible pre-eclampsia",
                "required_capabilities": ["MATERNAL_CARE", "OBSTETRIC_CARE"],
                "referral_priority": "URGENT",
            },
        },
        headers=_worker_headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "REFERRAL_REQUIRED"
    assert body["referral_id"]
    timeline = client.get(f"/api/v1/patients/{patient['id']}/timeline").json()
    referral_events = [e for e in timeline["events"] if e["event_type"] in {"REFERRAL_CREATED", "REFERRAL_PATIENT_INFORMED"}]
    assert referral_events, timeline["events"]


def test_red_cannot_be_downgraded_to_completed(client):
    patient = _create_patient(client, "E")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    client.post(
        f"/api/v1/visits/{visit['id']}/vitals",
        json={"spo2": 88, "pulse_bpm": 130},
        headers=_worker_headers(),
    )
    client.post(
        f"/api/v1/visits/{visit['id']}/symptoms",
        json={"symptoms": [{"symptom": "chest pain"}, {"symptom": "shortness of breath"}]},
        headers=_worker_headers(),
    )
    response = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={"outcome": "COMPLETED", "findings": "Patient reported feeling better"},
        headers=_worker_headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "ESCALATION_REQUIRED"
    assert body["risk_level"] == "RED"
    assert body["follow_up_id"], "Escalation should attach a follow-up"
    assert body["follow_up_task_id"], "Escalation should attach a task"
    follow_up = client.get(f"/api/v1/follow-ups/{body['follow_up_id']}").json()
    assert follow_up["priority"] == "URGENT"


def test_complete_visit_invalid_outcome_rejected(client):
    patient = _create_patient(client, "F")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    response = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={"outcome": "WHATEVER"},
        headers=_worker_headers(),
    )
    assert response.status_code == 400


def test_complete_visit_twice_rejected(client):
    patient = _create_patient(client, "G")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    first = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={"outcome": "COMPLETED", "findings": "All good"},
        headers=_worker_headers(),
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={"outcome": "COMPLETED"},
        headers=_worker_headers(),
    )
    assert second.status_code == 409


def test_today_for_worker(client):
    patient = _create_patient(client, "H")
    client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "child health"},
        headers=_worker_headers(),
    )
    response = client.get("/api/v1/workers/asha-001/today")
    assert response.status_code == 200
    body = response.json()
    assert any(v["visit_type"] == "child health" for v in body)


def test_typed_sync_visit_creates_first_class_visit(client):
    patient = _create_patient(client, "I")
    response = client.post(
        "/api/v1/sync/bulk",
        json={
            "worker_id": "ASHA-OFFLINE",
            "phc_id": "PHC-LOCAL",
            "sync_timestamp": datetime.now(timezone.utc).isoformat(),
            "records": [
                {
                    "entity_type": "visit",
                    "local_uuid": "visit-sync-001",
                    "operation": "create",
                    "payload": {
                        "patient_local_uuid": patient["id"],
                        "actor_id": "ASHA-OFFLINE",
                        "actor_role": "ASHA",
                        "visit_type": "general follow-up",
                        "phc_id": "PHC-LOCAL",
                        "vitals": {"spo2": 97, "pulse_bpm": 80},
                        "symptoms": [{"symptom": "mild cough", "severity": "MILD"}],
                        "outcome": "COMPLETED",
                        "findings": "Stable",
                    },
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    sync_body = response.json()
    assert sync_body["synced_count"] == 1
    assert sync_body["results"][0]["status"] == "SYNCED"
    server_id = sync_body["results"][0]["server_id"]
    fetched = client.get(f"/api/v1/visits/{server_id}").json()
    assert fetched["outcome"] == "COMPLETED"
    repeat = client.post(
        "/api/v1/sync/bulk",
        json={
            "worker_id": "ASHA-OFFLINE",
            "phc_id": "PHC-LOCAL",
            "sync_timestamp": datetime.now(timezone.utc).isoformat(),
            "records": [
                {
                    "entity_type": "visit",
                    "local_uuid": "visit-sync-001",
                    "operation": "create",
                    "payload": {
                        "patient_local_uuid": patient["id"],
                        "visit_type": "general follow-up",
                    },
                }
            ],
        },
    )
    assert repeat.status_code == 200
    repeat_body = repeat.json()
    assert repeat_body["duplicate_count"] == 1
    assert repeat_body["results"][0]["status"] == "DUPLICATE"


def test_typed_sync_visit_duplicate_visit_persists_offline_mirror(client):
    patient = _create_patient(client, "J")
    client.post(
        "/api/v1/sync/bulk",
        json={
            "worker_id": "ASHA-OFFLINE",
            "phc_id": "PHC-LOCAL",
            "sync_timestamp": datetime.now(timezone.utc).isoformat(),
            "records": [
                {
                    "entity_type": "visit",
                    "local_uuid": "visit-sync-002",
                    "operation": "create",
                    "payload": {
                        "patient_local_uuid": patient["id"],
                        "visit_type": "general follow-up",
                    },
                }
            ],
        },
    )
    list_response = client.get(f"/api/v1/visits?patient_id={patient['id']}")
    assert list_response.status_code == 200
    rows = list_response.json()
    assert len(rows) == 1
    assert rows[0]["visit_type"] == "general follow-up"


def test_typed_sync_task_links_to_follow_up(client):
    patient = _create_patient(client, "K")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    body = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={
            "outcome": "ESCALATION_REQUIRED",
            "findings": "Vitals concerning",
            "follow_up": {
                "follow_up_type": "post-treatment",
                "due_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            },
        },
        headers=_worker_headers(),
    ).json()
    assert body["follow_up_id"]
    assert body["follow_up_task_id"]
    follow_up = client.get(f"/api/v1/follow-ups/{body['follow_up_id']}").json()
    assert follow_up["linked_task_id"] == body["follow_up_task_id"]


def test_typed_sync_task_creates_follow_up_task_for_explicit_link(client):
    patient = _create_patient(client, "L")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    completed = client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={
            "outcome": "ESCALATION_REQUIRED",
            "follow_up": {
                "follow_up_type": "post-treatment",
                "due_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            },
        },
        headers=_worker_headers(),
    ).json()
    assert completed["follow_up_task_id"]
    # The canonical FollowUpTask already exists. A subsequent sync of an
    # explicit task payload from the field app must be a no-op, never a
    # second row that would breach the unique constraint.
    sync_response = client.post(
        "/api/v1/sync/bulk",
        json={
            "worker_id": "ASHA-OFFLINE",
            "phc_id": "PHC-LOCAL",
            "sync_timestamp": datetime.now(timezone.utc).isoformat(),
            "records": [
                {
                    "entity_type": "task",
                    "local_uuid": "task-sync-001",
                    "operation": "create",
                    "payload": {
                        "follow_up_id": completed["follow_up_id"],
                        "task_type": "HOME_VISIT",
                        "priority": "URGENT",
                        "due_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
                        "actor_id": "ASHA-OFFLINE",
                        "visit_id": visit["id"],
                    },
                }
            ],
        },
    )
    assert sync_response.status_code == 200, sync_response.text
    sync_body = sync_response.json()
    assert sync_body["duplicate_count"] == 1
    assert sync_body["results"][0]["status"] == "DUPLICATE"


def test_timeline_includes_visit_events(client):
    patient = _create_patient(client, "M")
    visit = client.post(
        "/api/v1/visits",
        json={"patient_local_uuid": patient["id"], "visit_type": "general follow-up"},
        headers=_worker_headers(),
    ).json()
    client.post(f"/api/v1/visits/{visit['id']}/vitals", json={"spo2": 96}, headers=_worker_headers())
    client.post(
        f"/api/v1/visits/{visit['id']}/complete",
        json={"outcome": "COMPLETED", "findings": "OK"},
        headers=_worker_headers(),
    )
    timeline = client.get(f"/api/v1/patients/{patient['id']}/timeline").json()
    event_types = {event["event_type"] for event in timeline["events"]}
    assert "VISIT_STARTED" in event_types
    assert "VISIT_COMPLETED" in event_types
    assert "VITALS_RECORDED" in event_types
