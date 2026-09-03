"""Compatibility façade for the tele-consultation priority queue."""

from app.services.queue_manager import enqueue_patient, get_active_queue_stats, get_next_patient_for_doctor

__all__ = ["enqueue_patient", "get_active_queue_stats", "get_next_patient_for_doctor"]
