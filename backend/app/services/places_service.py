"""Nearby hospital/pharmacy discovery via OpenStreetMap Overpass API."""

import math
from typing import Any

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "MEDORA/1.0 (healthcare finder)"
TIMEOUT_SECONDS = 15.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return round(r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 3)


def _amenity_for(place_type: str) -> str:
    if place_type == "pharmacy":
        return "pharmacy"
    return "hospital"


def _build_address(tags: dict[str, Any]) -> str | None:
    parts = []
    for key in ("addr:housenumber", "addr:street", "addr:suburb", "addr:city", "addr:state", "addr:postcode"):
        v = tags.get(key)
        if v:
            parts.append(str(v))
    if not parts:
        return tags.get("addr:full")
    return ", ".join(parts)


def _extract_coords(element: dict[str, Any]) -> tuple[float, float] | None:
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center")
    if center and "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


async def search_nearby(lat: float, lon: float, radius_m: int, place_type: str) -> list[dict[str, Any]]:
    amenity = _amenity_for(place_type)
    query = (
        f"[out:json][timeout:12];\n"
        f"(\n"
        f'  node["amenity"="{amenity}"](around:{radius_m},{lat},{lon});\n'
        f'  way["amenity"="{amenity}"](around:{radius_m},{lat},{lon});\n'
        f");\n"
        f"out center;"
    )
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.post(OVERPASS_URL, data={"data": query})
        response.raise_for_status()
        data = response.json()

    results = []
    for el in data.get("elements", []):
        coords = _extract_coords(el)
        if coords is None:
            continue
        tags = el.get("tags", {}) or {}
        name = tags.get("name")
        if not name:
            continue
        plat, plon = coords
        results.append({
            "name": name,
            "place_type": "pharmacy" if amenity == "pharmacy" else "hospital",
            "latitude": plat,
            "longitude": plon,
            "distance_km": _haversine_km(lat, lon, plat, plon),
            "address": _build_address(tags),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "opening_hours": tags.get("opening_hours"),
            "website": tags.get("website") or tags.get("contact:website"),
        })
    results.sort(key=lambda r: r["distance_km"])
    return results