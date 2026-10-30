import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:5173", "http://localhost:5174"],
)
def test_patient_auth_preflight_allows_local_web_origins(
    client: TestClient, origin: str
) -> None:
    response = client.options(
        "/api/v1/patient-auth/request-otp",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "POST" in response.headers["access-control-allow-methods"]
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers


def test_patient_auth_preflight_rejects_unlisted_origin(client: TestClient) -> None:
    response = client.options(
        "/api/v1/patient-auth/request-otp",
        headers={
            "Origin": "http://localhost:5175",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
