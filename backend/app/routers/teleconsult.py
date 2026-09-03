"""Tele-consultation router compatibility export."""

from app.api.v1.teleconsult import router, signaling_router

__all__ = ["router", "signaling_router"]
