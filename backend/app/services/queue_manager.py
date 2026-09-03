"""Async in-memory doctor queue for ARROH's tele-consultation demonstration.

RED is always served before YELLOW and GREEN. Within a triage tier, FIFO ordering
prevents lower-connectivity field workers from being disadvantaged by retries.
Production deployments can replace this service with a Redis-backed implementation
without changing the HTTP contract.
"""

import asyncio
import heapq
import itertools
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.db.models.patient import TriageStatus

_PRIORITY = {TriageStatus.RED: 0, TriageStatus.YELLOW: 1, TriageStatus.GREEN: 2}


@dataclass(order=True)
class QueueEntry:
    """One waiting patient, ordered by clinical urgency then join order."""

    priority: int
    sequence: int
    patient_id: uuid.UUID = field(compare=False)
    triage_status: TriageStatus = field(compare=False)
    phc_id: str = field(compare=False)
    joined_at: datetime = field(compare=False)


class DoctorPriorityQueue:
    """Concurrency-safe priority queues partitioned by PHC."""

    def __init__(self) -> None:
        self._queues: dict[str, list[QueueEntry]] = {}
        self._waiting_patient_ids: set[uuid.UUID] = set()
        self._entries_by_patient: dict[uuid.UUID, QueueEntry] = {}
        self._claimed: dict[uuid.UUID, dict[str, str]] = {}
        self._sequence = itertools.count()
        self._lock = asyncio.Lock()

    async def enqueue_patient(self, patient_id: uuid.UUID, triage_status: TriageStatus, phc_id: str) -> QueueEntry:
        """Queue a patient once; duplicate joins retain their original place."""

        async with self._lock:
            if patient_id in self._waiting_patient_ids:
                return self._entries_by_patient[patient_id]
            entry = QueueEntry(
                priority=_PRIORITY[triage_status],
                sequence=next(self._sequence),
                patient_id=patient_id,
                triage_status=triage_status,
                phc_id=phc_id,
                joined_at=datetime.now(timezone.utc),
            )
            heapq.heappush(self._queues.setdefault(phc_id, []), entry)
            self._waiting_patient_ids.add(patient_id)
            self._entries_by_patient[patient_id] = entry
            return entry

    async def get_next_patient_for_doctor(self, doctor_id: str, phc_id: str) -> QueueEntry | None:
        """Atomically claim the most urgent waiting patient for the doctor."""

        async with self._lock:
            queue = self._queues.get(phc_id, [])
            while queue:
                entry = heapq.heappop(queue)
                if entry.patient_id not in self._waiting_patient_ids:
                    continue
                self._waiting_patient_ids.remove(entry.patient_id)
                self._entries_by_patient.pop(entry.patient_id, None)
                self._claimed[entry.patient_id] = {
                    "doctor_id": doctor_id,
                    "phc_id": phc_id,
                    "claimed_at": datetime.now(timezone.utc).isoformat(),
                }
                return entry
            return None

    async def get_active_queue_stats(self) -> dict[str, object]:
        """Return queue sizes by PHC and clinical tier for the operations dashboard."""

        async with self._lock:
            by_phc: dict[str, dict[str, int]] = {}
            for phc_id, entries in self._queues.items():
                counts = {status.value: 0 for status in TriageStatus}
                for entry in entries:
                    if entry.patient_id in self._waiting_patient_ids:
                        counts[entry.triage_status.value] += 1
                by_phc[phc_id] = counts
            return {"waiting_count": len(self._waiting_patient_ids), "claimed_count": len(self._claimed), "by_phc": by_phc}

    async def get_claim_for_patient(self, patient_id: uuid.UUID) -> dict[str, str] | None:
        """Return the active in-memory doctor assignment for timeline enrichment."""

        async with self._lock:
            claim = self._claimed.get(patient_id)
            return dict(claim) if claim else None


priority_queue = DoctorPriorityQueue()


async def enqueue_patient(patient_id: uuid.UUID, triage_status: TriageStatus, phc_id: str) -> QueueEntry:
    """Add a patient to the shared ARROH priority queue."""

    return await priority_queue.enqueue_patient(patient_id, triage_status, phc_id)


async def get_next_patient_for_doctor(doctor_id: str, phc_id: str) -> QueueEntry | None:
    """Claim the next highest-priority patient for a doctor."""

    return await priority_queue.get_next_patient_for_doctor(doctor_id, phc_id)


async def get_active_queue_stats() -> dict[str, object]:
    """Read current queue metrics without modifying waiting order."""

    return await priority_queue.get_active_queue_stats()


async def get_claim_for_patient(patient_id: uuid.UUID) -> dict[str, str] | None:
    """Read an active consultation claim for a patient, if this process has one."""

    return await priority_queue.get_claim_for_patient(patient_id)
