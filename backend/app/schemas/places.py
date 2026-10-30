"""Schemas for nearby hospital/pharmacy discovery."""

from typing import Literal

from pydantic import BaseModel, Field


class NearbyPlace(BaseModel):
    name: str
    place_type: Literal["hospital", "pharmacy"]
    latitude: float
    longitude: float
    distance_km: float
    address: str | None = None
    phone: str | None = None
    opening_hours: str | None = None
    website: str | None = None
    source: str = "OpenStreetMap (Overpass)"


class NearbyPlacesResponse(BaseModel):
    latitude: float
    longitude: float
    radius_m: int
    place_type: Literal["hospital", "pharmacy", "all"]
    count: int
    results: list[NearbyPlace]
    provider: str = "OpenStreetMap Overpass API"