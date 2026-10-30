"""Regression tests for staff bearer-token validation."""

import uuid

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


def test_me_accepts_a_valid_registered_user_token(client: TestClient) -> None:
    email = f"swagger-{uuid.uuid4()}@example.test"
    registered = client.post(
        "/api/v1/auth/register",
        json={"name": "Swagger Doctor", "email": email, "password": "test-password-123"},
    )
    assert registered.status_code == 201
    body = registered.json()

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['token']}"},
    )

    assert response.status_code == 200
    assert response.json()["id"] == body["user"]["id"]
    assert response.json()["email"] == email


def test_openapi_declares_http_bearer_security_for_me(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()

    assert schema["components"]["securitySchemes"]["HTTPBearer"] == {
        "type": "http",
        "scheme": "bearer",
    }
    protected_operations = [
        ("/api/v1/auth/me", "get"),
        ("/api/v1/patient-auth/me", "get"),
        ("/api/v1/patient-auth/prescriptions", "get"),
        ("/api/v1/patient-auth/consultations", "get"),
        ("/api/v1/patient-auth/appointments", "get"),
        ("/api/v1/patient-auth/follow-ups", "get"),
    ]
    for path, method in protected_operations:
        assert schema["paths"][path][method]["security"] == [{"HTTPBearer": []}]
