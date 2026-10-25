"""Regression tests for staff bearer-token validation."""

from fastapi.testclient import TestClient


def test_me_rejects_missing_and_invalid_bearer_tokens(client: TestClient) -> None:
    missing = client.get("/api/v1/auth/me")
    assert missing.status_code == 401
    assert missing.json()["detail"] == "Missing or invalid bearer token"

    invalid = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Invalid or expired token"
