# MEDORA — Six-Module Implementation Plan (Phase 1 Audit)

## Existing capability audit

### Already present (verified)
- Backend: FastAPI, SQLAlchemy async, patients/triage/visits/referrals/follow-ups/consultations/prescriptions/case-taking/voice/sync/auth/patient-auth. 89 tests pass.
- Mobile: Flutter offline-first ASHA app with SQLite sync queue, deterministic offline triage, voice, ISL phrases.
- Web: React 19 + Vite patient/staff portal, i18n (10 languages), voice assistant with TTS, offline sync queue, patient auth (OTP).
- Voice: multilingual parse-and-triage with patient-reply TTS (en/hi/ta/kn/te/ml/mr/bn/gu).
- Auth: staff HMAC tokens (24h expiry), patient OTP, role field on User (doctor/asha/admin/patient), migration 011.

### Missing / not implemented
1. Accessible Multilingual Voice Agent — partial: voice triage + TTS exists; no agentic tool execution, no hospital/pharmacy/medicine/emergency tool calls.
2. Hospital & Pharmacy Finder — missing entirely (no geolocation, no POI search, no routing).
3. Medicine Safety Assistant — missing (no medicine DB, no interaction checks, no OCR).
4. Prescription–Medicine Matching — missing (no OCR, no comparison).
5. Medicine Ordering — missing (no pharmacy integration, no order flow).
6. Emergency & Caretaker Assistance — missing (no caretaker contacts, no emergency dispatch, no location sharing).

### Existing touchpoints to extend
- `web/src/lib/intentParser.ts` (11 keyword matches) — intent routing scaffold.
- `web/src/lib/patientAgent.ts` — agent scaffold.
- `web/src/pages/VoiceAssistant.tsx` — voice UI + TTS.
- `web/src/pages/Emergency.tsx` — emergency page.
- `web/src/pages/TeleConsult.tsx` — teleconsult.
- `backend/app/api/v1/voice.py`, `voice_agent.py` — voice endpoints.
- `backend/app/services/ai_provider.py`, `rag_service.py` — AI/RAG infra.

## Proposed phased implementation

Phase 2 — Voice Agent (extend VoiceAssistant + intentParser + patientAgent):
- Add tool-calling loop: voice transcript → intent → backend tool endpoints (triage, find-hospital, medicine-info, emergency).
- Reuse existing TTS playback; add keyboard + screen-reader labels.
- Tests: intent routing, fallback when no tool match.

Phase 3 — Hospital/Pharmacy Finder:
- New backend: `GET /api/v1/places/nearby?lat&lon&type&radius` proxying a real POI provider (OpenStreetMap Nominatim/Overpass or Google Places) — key from env, never hardcoded.
- Web: geolocation permission flow (explicit prompt), distance calc, directions link (Google Maps deep link), freshness timestamp.
- Fallback: manual location entry when permission denied.
- Tests: permission denied path, provider unavailable fallback.

Phase 4 — Medicine Safety Assistant:
- New backend: `GET /api/v1/medicines/{name}` (verified DB or openFDA/RxNorm), interaction check endpoint.
- OCR: web uses Tesseract.js or native camera; confidence score returned; low confidence → ask user to confirm.
- Expiry interpretation: parse date, flag expired/near-expiry; never invent dates.

Phase 5 — Prescription–Medicine Matching:
- Backend: `POST /api/v1/prescriptions/{id}/match` comparing prescribed meds vs identified package (name, strength, form). Returns match/mismatch/insufficient-info. No auto-substitution.
- Tests: mismatch, missing strength, ambiguous.

Phase 6 — Emergency & Caretaker:
- Backend: caretaker contacts CRUD (patient-owned, auth-gated), emergency event log.
- Web/mobile: emergency button → call 112/108 (tel: link, user confirms), share location via SMS deep link (user confirms), notify caretaker (opt-in).
- Never claim call/SMS succeeded without device evidence.

Phase 7 — Medicine Ordering:
- Backend: order creation only via supported pharmacy API (partner TBD); price/availability from provider; explicit user confirmation; order status polling.
- If no partner API, implement transparent "request quote" flow + manual fulfillment, clearly labelled.

Phase 8 — Integration + regression + security tests.

## Files to create/modify (high-level)
- backend/app/api/v1/places.py, medicines.py, caretakers.py, orders.py (new)
- backend/app/services/places_service.py, medicine_service.py, order_service.py (new)
- backend/app/db/models/caretaker.py, medicine.py, order.py (new) + migration 012
- web/src/pages/HospitalFinder.tsx, MedicineScanner.tsx, MedicineSafety.tsx, OrderMedicine.tsx, Caretakers.tsx (new)
- web/src/lib/intentParser.ts, patientAgent.ts (extend)
- mobile: corresponding screens + permissions

## Critical constraints
- No hardcoded API keys; all via env (VITE_*/backend env).
- No invented locations/prices/availability; always source-attributed + timestamp.
- Explicit confirmation before orders/calls/SMS.
- Permission prompts for mic/location/camera/contacts.
- Backend auth on all new sensitive endpoints (patient/staff).
- Mobile offline: queue new operations; idempotency via local_uuid.

## Recommended first implementation slice
Phase 3 (Hospital/Pharmacy Finder) is the smallest end-to-end verifiable slice with a real external API and clear UX. It exercises geolocation permission, backend proxy, distance calc, and accessible error handling. Recommended to start there after approving this plan.