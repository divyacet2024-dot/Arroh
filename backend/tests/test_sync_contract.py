"""Typed offline sync contract and idempotency coverage."""

from uuid import uuid4


def _patient(client):
    response = client.post(
        "/api/v1/patients/",
        json={
            "name": "Sync Patient",
            "gender": "female",
            "birth_date": "1988-01-02",
            "abha_id": f"{uuid4().int % 10**14:014d}",
            "district": "Mandya",
            "state": "Karnataka",
            "phc_id": "PHC-SYNC-01",
        },
    )
    assert response.status_code == 201
    return response.json()


def _bulk(client, records):
    return client.post(
        "/api/v1/sync/bulk",
        json={
            "worker_id": "asha-sync-1",
            "phc_id": "PHC-SYNC-01",
            "sync_timestamp": "2026-09-03T10:00:00Z",
            "records": records,
        },
    )


def _typed(entity_type, local_uuid, payload, operation="create"):
    return {"entity_type": entity_type, "local_uuid": local_uuid, "operation": operation, "payload": payload}


def test_typed_entities_preserve_payload_and_replay_is_idempotent(client):
    patient = _patient(client)
    patient_id = patient["id"]
    referral_uuid = f"ref-{uuid4()}"
    visit_uuid = f"visit-{uuid4()}"
    task_uuid = f"task-{uuid4()}"
    follow_up_uuid = f"follow-{uuid4()}"
    case_uuid = str(uuid4())
    records = [
        _typed("referral", referral_uuid, {
            "patient_id": patient_id,
            "origin_phc_id": "PHC-SYNC-01",
            "target_facility_id": "CHC-SYNC-01",
            "target_facility_name": "Sync CHC",
            "target_facility_type": "CHC",
            "referral_priority": "RED",
            "reason_for_referral": "Urgent review from offline worker.",
            "required_capabilities": ["OBSTETRIC_CARE"],
            "status": "CREATED",
        }),
        _typed("visit", visit_uuid, {"patient_local_uuid": patient_id, "visit_type": "HOME", "visited_at": "2026-09-03T09:00:00Z", "findings": "Stable", "actor_id": "asha-1"}),
        _typed("task", task_uuid, {"patient_local_uuid": patient_id, "title": "Call patient", "description": "Confirm appointment", "status": "PENDING", "due_date": "2026-09-04"}),
        _typed("follow_up", follow_up_uuid, {"patient_local_uuid": patient_id, "follow_up_type": "POST_DISCHARGE", "scheduled_for": "2026-09-05T09:00:00Z", "status": "PENDING", "notes": "Bring medicines"}),
        _typed("case_session", f"case-local-{uuid4()}", {"case_id": case_uuid, "patient_local_uuid": patient_id, "language": "kn", "started_at": "2026-09-03T08:00:00Z", "patient_case": {"symptoms": [{"symptom": "severe headache"}]}, "ai_proposed_case": {}, "triage_result": {"triage_level": "RED"}, "answers": [{"question": "bleeding", "answer": "no"}], "completed": True}),
    ]
    response = _bulk(client, records)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["synced_count"] == 5
    assert {item["entity_type"] for item in body["results"]} == {"referral", "visit", "task", "follow_up", "case_session"}
    assert all(item["server_id"] for item in body["results"])

    replay = _bulk(client, records)
    assert replay.status_code == 200, replay.text
    replay_body = replay.json()
    assert replay_body["duplicate_count"] == 5
    assert all(item["status"] == "DUPLICATE" for item in replay_body["results"])

    referral = client.get(f"/api/v1/referrals/{body['results'][0]['server_id']}/history")
    assert referral.status_code == 200


def test_unsupported_type_is_rejected_without_silent_conversion(client):
    response = _bulk(client, [_typed("unknown_entity", "unknown-1", {"clinical": "value"})])
    assert response.status_code == 422
    assert "entity_type" in response.text


def test_partial_typed_batch_returns_per_operation_failure(client):
    patient = _patient(client)
    valid_uuid = f"visit-{uuid4()}"
    response = _bulk(client, [
        _typed("visit", valid_uuid, {"patient_local_uuid": patient["id"], "visit_type": "HOME", "visited_at": "2026-09-03T09:00:00Z"}),
        _typed("follow_up", f"bad-{uuid4()}", {"status": "PENDING"}),
    ])
    assert response.status_code == 200
    body = response.json()
    assert body["synced_count"] == 1
    assert body["failed_count"] == 1
    statuses = {item["local_uuid"]: item["status"] for item in body["results"]}
    assert statuses[valid_uuid] == "SYNCED"
    assert next(status for local_uuid, status in statuses.items() if local_uuid != valid_uuid) == "FAILED"
