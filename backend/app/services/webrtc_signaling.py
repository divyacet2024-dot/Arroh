"""WebSocket relay for WebRTC negotiation and low-bandwidth fallback.

ARROH relays signaling only: audio/video media flows peer-to-peer when possible.
Clients report network quality; unsafe packet loss or latency emits NETWORK_DEGRADED
so both sides can switch to audio-only before a rural consultation is interrupted.
"""

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class WebRTCConnectionManager:
    """Tracks active room participants and safely relays signaling messages."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, WebSocket]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, client_id: str, websocket: WebSocket) -> None:
        """Accept and register a participant, replacing any stale same-ID socket."""

        await websocket.accept()
        async with self._lock:
            old_socket = self._rooms[room_id].get(client_id)
            self._rooms[room_id][client_id] = websocket
        if old_socket is not None and old_socket is not websocket:
            try:
                await old_socket.close(code=4001, reason="Superseded by newer connection")
            except RuntimeError:
                pass

    async def disconnect(self, room_id: str, client_id: str, websocket: WebSocket | None = None) -> None:
        """Remove a disconnected socket without deleting a newer reconnection."""

        async with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                return
            current = room.get(client_id)
            if websocket is None or current is websocket:
                room.pop(client_id, None)
            if not room:
                self._rooms.pop(room_id, None)

    async def relay(self, room_id: str, sender_id: str, message: dict[str, Any]) -> None:
        """Send SDP/ICE to one recipient or every other participant in the room."""

        recipient_id = message.get("recipient_id")
        async with self._lock:
            room = dict(self._rooms.get(room_id, {}))
        targets = ({recipient_id: room[recipient_id]} if recipient_id in room else {}) if recipient_id else room
        outbound = {**message, "sender_id": sender_id}
        stale: list[tuple[str, WebSocket]] = []
        for client_id, socket in targets.items():
            if client_id == sender_id:
                continue
            try:
                await socket.send_json(outbound)
            except (RuntimeError, WebSocketDisconnect):
                stale.append((client_id, socket))
        for client_id, socket in stale:
            await self.disconnect(room_id, client_id, socket)

    async def report_network(self, room_id: str, sender_id: str, packet_loss_percent: float, latency_ms: float) -> bool:
        """Emit the audio-only fallback event when network quality becomes unsafe."""

        degraded = packet_loss_percent >= 8.0 or latency_ms >= 500.0
        if degraded:
            await self.relay(
                room_id,
                sender_id,
                {
                    "type": "NETWORK_DEGRADED",
                    "packet_loss_percent": packet_loss_percent,
                    "latency_ms": latency_ms,
                    "force_audio_only": True,
                },
            )
        return degraded


signaling_manager = WebRTCConnectionManager()
