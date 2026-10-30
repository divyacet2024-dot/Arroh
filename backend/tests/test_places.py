"""Tests for the places (hospital/pharmacy) discovery endpoint."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


def test_nearby_invalid_latitude(client: TestClient) -> None:
    response = client.get("/api/v1/places/nearby", params={"lat": 999, "lon": 77.5, "place_type": "hospital"})
    assert response.status_code == 422


def test_nearby_invalid_place_type(client: TestClient) -> None:
    response = client.get("/api/v1/places/nearby", params={"lat": 12.9, "lon": 77.5, "place_type": "clinic"})
    assert response.status_code == 422


def test_nearby_success_with_mocked_provider(client: TestClient) -> None:
    fake = [
        {"name": "City Hospital", "place_type": "hospital", "latitude": 12.97, "longitude": 77.59,
         "distance_km": 0.5, "address": "MG Road", "phone": "+91-80-12345678",
         "opening_hours": "24/7", "website": "https://example.org"},
    ]
    with patch("app.api.v1.places.search_nearby", new=AsyncMock(return_value=fake)):
        response = client.get("/api/v1/places/nearby", params={"lat": 12.9716, "lon": 77.5946, "place_type": "hospital"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["name"] == "City Hospital"
    assert body["results"][0]["distance_km"] == 0.5


def test_nearby_provider_failure_returns_502(client: TestClient) -> None:
    with patch("app.api.v1.places.search_nearby", new=AsyncMock(side_effect=Exception("boom"))):
        response = client.get("/api/v1/places/nearby", params={"lat": 12.9716, "lon": 77.5946, "place_type": "hospital"})
    assert response.status_code == 502


def test_nearby_empty_results(client: TestClient) -> None:
    with patch("app.api.v1.places.search_nearby", new=AsyncMock(return_value=[])):
        response = client.get("/api/v1/places/nearby", params={"lat": 12.9716, "lon": 77.5946, "place_type": "pharmacy"})
    assert response.status_code == 200
    assert response.json()["count"] == 0