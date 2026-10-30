"""Nearby hospital/pharmacy discovery endpoints."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.places import NearbyPlace, NearbyPlacesResponse
from app.services.places_service import search_nearby

router = APIRouter(prefix="/places", tags=["Places"])


@router.get("/nearby", response_model=NearbyPlacesResponse, summary="Find nearby hospitals or pharmacies")
async def nearby_places(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    radius: int = Query(5000, ge=500, le=50000, description="Search radius in metres"),
    place_type: Literal["hospital", "pharmacy", "all"] = Query("hospital", description="Place type to search"),
    limit: int = Query(20, ge=1, le=50, description="Max results"),
) -> NearbyPlacesResponse:
    types = ["hospital", "pharmacy"] if place_type == "all" else [place_type]
    merged: list[dict] = []
    try:
        for pt in types:
            merged.extend(await search_nearby(lat, lon, radius, pt))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Places provider unavailable") from exc

    merged.sort(key=lambda r: r["distance_km"])
    merged = merged[:limit]

    return NearbyPlacesResponse(
        latitude=lat,
        longitude=lon,
        radius_m=radius,
        place_type=place_type,
        count=len(merged),
        results=[NearbyPlace(**r) for r in merged],
    )