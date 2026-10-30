# MEDORA Feature Audit

Project: MEDORA (previously ARROH)
Working directory: `C:\Users\DIVYA B\Desktop\Arroh`
Audit date: 2026-10-30
Auditor: Kilo (senior-engineer audit pass)

## 1. Repository Layout

Three first-class applications plus legacy HTML:

- `backend/` — FastAPI + SQLAlchemy async + SQLite/PostgreSQL, Pydantic schemas, pytest.
- `web/` — React 19 + Vite + TypeScript + Tailwind 4 + Capacitor (Android wrapper). Offline via `SyncContext`/`syncQueue`.
- `mobile/` — Flutter (Dart) offline-first ASHA field app. SQLite via sqflite, typed sync queue.
- `frontend/` — `asha_app.html`, `doctor_portal.html` (legacy single-file HTML prototypes, not part of the active build).
- `_verify/` — scratch probe scripts (added during this audit; removable). `arroh_dev.db` at repo root and `backend/` are local dev DBs.

## 2. Verification Summary (commands actually run)

| Check | Command | Result |
|---|---|---|
| Backend tests | `venv\Scripts\python -m pytest -q` (in `backend/`) | **64 passed, 8 warnings**, 2.65s |
| Web TypeScript | `npx tsc -b` (in `web/`) | **clean** (no output) |
| Web lint | `npm run lint` (oxlint) | only warnings (vendor whisper.js noise + 2 minor) |
| Web build | not run (no `dist/` rebuild required for audit) | — |
| Flutter analyze | `flutter analyze --no-pub` | **51 issues, all `info`-level** (no errors/warnings) |
| Flutter tests | `flutter test` | **12/12 passed** |
| Backend boot | `uvicorn app.main:app` | started; `/health` → `{"status":"ok"}` |
| Live API probes | `python _verify/probe.py`, `probe_voice.py` | see defects below |

## 3. Feature Matrix

### F1. Backend core (FastAPI, routing, CORS, error envelope)
- **Files:** `backend/app/main.py`, `backend/app/core/config.py`, `backend/app/db/session.py`, `backend/app/routers/*`
- **Status:** Implemented and verified.
- **Evidence:** 30+ routers registered; `/health` returns ok; 64 tests pass.
- **Defects:** `@app.on_event` deprecated (FastAPI lifespan). SQLite-only DDL in startup; no `users` migration. No authentication dependency on any endpoint except `/auth/me`.

### F2. Patient registration & records
- **Files:** `backend/app/api/v1/patients.py`, `backend/app/schemas/patient.py`, `backend/app/db/models/patient.py`
- **Endpoints:** `GET/POST /api/v1/patients/`, `GET /api/v1/patients/{id}`, `GET /api/v1/patients/{id}/timeline`, `GET /api/v1/patients/{id}/follow-ups`
- **Status:** Implemented but partially broken for offline sync.
- **Defects:** `PatientCreate.abha_id` is `required` with 14-digit pattern (`patient.py:73`), but the Flutter form marks ABHA optional and omits it from the payload → every offline registration without ABHA fails `/patients/` with **HTTP 422** and the row becomes `DEAD` after 8 retries. `district`/`state` are required server-side but the mobile form does collect them.

### F3. Triage (online + offline)
- **Files:** `backend/app/services/ai_triage.py`, `backend/app/api/v1/triage.py`; mobile `mobile/lib/offline/offline_triage.dart`
- **Endpoints:** `POST /api/v1/triage/assess`
- **Status:** Implemented and verified (backend tests + mobile tests).
- **Defects:** `/triage/assess` requires **no auth** and accepts any caller. Offline engine deterministic (verified in tests).

### F4. Voice intake + patient reply (new)
- **Files:** `backend/app/api/v1/voice.py`, `backend/app/services/voice_service.py`, `backend/app/services/patient_reply_service.py`, `backend/app/schemas/voice.py`; `web/src/pages/VoiceAssistant.tsx`, `web/src/services/voice.ts`
- **Endpoints:** `POST /api/v1/voice/parse-and-triage`
- **Status:** Implemented and verified (probe: Hindi/Telugu/English all return correct RED/YELLOW replies; unsupported language falls back to English).
- **Defects:** `build_patient_reply(clinical, ...)` ignores its `clinical` argument (dead param). `patient_reply_service` has no tests. Web `VoiceAssistant` added TTS playback but no tests.

### F5. Case taking (AI-assisted)
- **Files:** `backend/app/services/case_taking_service.py`, `backend/app/api/v1/case_taking.py`; mobile `mobile/lib/offline/case_taking_client.dart`, `mobile/lib/screens/case_taking_screen.dart`; web `web/src/pages/CaseTaking.tsx`, `web/src/pages/CaseReview.tsx`
- **Endpoints:** `POST /api/v1/case-taking/{start,answer,confirm,doctor-edit}`, `GET .../case/{id}`, `GET .../patient/{id}/cases`, `GET .../knowledge/search`
- **Status:** Implemented and verified (backend tests `test_case_taking.py`, mobile tests).

### F6. Consultations, diagnostics, discharge, prescriptions (Step 6)
- **Files:** `backend/app/services/consultation_service.py`, `backend/app/api/v1/consultations.py`, `backend/app/api/v1/prescriptions.py`; mobile `consultation_form_screen.dart`, `diagnostic_screen.dart`, `discharge_plan_screen.dart`, `prescription_screen.dart`, `consultation_summary_screen.dart`; web `web/src/pages/Consultation.tsx`
- **Endpoints:** consultations CRUD + complete + diagnostics + diagnostic-results + discharge; prescriptions create
- **Status:** Implemented and verified (sync contract fixed: `consultation_local_uuid` is now accepted and resolved to `consultation_id` server-side).
- **Defects:** Resolved — `CarePrescriptionCreateSchema` now accepts optional `consultation_local_uuid` and the endpoint resolves it via `Consultation.local_uuid`. `extra="forbid"` preserved.

### F7. Referral lifecycle
- **Files:** `backend/app/services/referral_lifecycle_service.py`, `backend/app/api/v1/referrals.py`; `backend/tests/test_referral_lifecycle.py`
- **Endpoints:** `POST /api/v1/referrals/{create,recommend,transition}`, `GET .../{id}/history`
- **Status:** Implemented and verified.

### F8. Follow-ups
- **Files:** `backend/app/services/follow_up_service.py`, `backend/app/api/v1/follow_ups.py`; mobile `follow_up_screen.dart`
- **Endpoints:** `POST /api/v1/follow-ups`, `POST .../{id}/transition`, `GET .../due`, `GET .../{id}`, `GET .../{id}/history`
- **Status:** Implemented and verified.

### F9. Visits (pregnancy/ANC/child/vaccination)
- **Files:** `backend/app/services/visit_service.py`, `backend/app/api/v1/visits.py`; mobile `visit_workflow_screens.dart`
- **Endpoints:** `POST /api/v1/visits`, `POST .../{id}/symptoms`, `POST .../{id}/vitals`, `POST .../{id}/complete`, `GET ...`, `GET .../by-local-uuid/{local_uuid}`
- **Status:** Implemented and verified.

### F10. Offline sync engine (mobile)
- **Files:** `mobile/lib/offline/sync_engine.dart`, `mobile/lib/offline/sync_queue_repository.dart`, `mobile/lib/offline/repositories.dart`
- **Endpoints:** `POST /api/v1/sync/bulk`, `POST /api/v1/sync/sms-fallback`
- **Status:** Implemented; defects above (F2, F6) cause permanent `DEAD` rows. Idempotency via `local_uuid` works for consultations (probe: SYNCED).
- **Defects:** No per-entity retry policy distinction between transient (5xx/network) and permanent (4xx validation) failures — both burn 8 attempts. `_syncPatient` does not handle the backend's `DUPLICATE`/`409` idempotency response path (it just fails).

### F11. Teleconsult (WebRTC signaling)
- **Files:** `backend/app/services/webrtc_signaling.py`, `backend/app/api/v1/teleconsult.py`; web `web/src/pages/TeleConsult.tsx`
- **Endpoints:** queue join/next, prescription, signaling
- **Status:** Implemented but unverified end-to-end (no WebRTC integration test).

### F12. Accessibility (communication modes)
- **Files:** `backend/app/services/accessibility_service.py`, `backend/app/api/v1/accessibility.py`; mobile screens `isl_screen.dart`, `low_literacy_screen.dart`, `connectivity_badge.dart`
- **Endpoints:** `POST /api/v1/accessibility/preferences`, `POST .../format-triage`, `GET .../preferences/{patient_id}`
- **Status:** Implemented and verified (`test_accessibility.py`).

### F13. Authentication
- **Files (staff):** `backend/app/api/v1/auth.py`, `backend/app/services/auth_service.py`, `backend/app/db/models/user.py`, `backend/app/schemas/auth.py`; `web/src/pages/Login.tsx`, `web/src/lib/auth.tsx`, `web/src/services/auth.ts`
- **Files (patient):** `backend/app/api/v1/patient_auth.py`, `backend/app/db/models/otp.py`, `backend/app/services/otp_service.py`; `web/src/lib/patientAuth.tsx`, `web/src/pages/PatientLogin.tsx`, `web/src/pages/PatientHome.tsx`, `web/src/pages/Welcome.tsx`
- **Endpoints (staff):** `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- **Endpoints (patient):** `POST /api/v1/patient-auth/request-otp`, `POST /api/v1/patient-auth/verify-otp`, `GET /api/v1/patient-auth/me`, `GET /api/v1/patient-auth/{prescriptions,consultations,appointments,follow-ups}`
- **Status:** Partially implemented (improved since first audit pass).
- **Verified:** `test_auth.py` (staff) and `test_patient_auth.py` (12 tests, OTP flow + lockout + patient-owned endpoints) pass; patient_auth router is registered in `main.py`.
- **Remaining defects:**
  - **Database migration added** (`backend/migrations/011_auth_tables.sql`) for `users` and `otp_records` tables (PostgreSQL). SQLite still auto-creates via `create_all`.
  - **Web API client now attaches bearer tokens** via request interceptor (staff token for non-patient-auth URLs, patient token for `/patient-auth/*`), with 401 session clearing.
  - **No auth dependency** on most staff data endpoints — mobile sync and existing tests rely on open endpoints; adding auth would break them. Patient-owned endpoints (`/patient-auth/*`) enforce auth via `_require_patient`.
  - **Token is an HMAC over `user_id.issue_time`, not a JWT** — no expiry/refresh/revocation.
  - **`User` has no role field** — role-based access control not implemented.
  - **`datetime.utcnow()` deprecated** usage in `patient_auth.py` (warnings only).

### F14. Frontend (web) dashboard & workflows
- **Files:** `web/src/App.tsx`, `web/src/components/layout/AppShell.tsx`, `web/src/pages/*`
- **Status:** Implemented; auth gating wired (RequireAuth).
- **Defects:** oxlint scans vendored `web/android/.../whisper/*.js` producing hundreds of warnings (config issue, not code). `web/src/index.css` is 4.8KB (recently +106 lines). Auth token not attached to API calls (see F13).

### F15. Mobile (Flutter) ASHA field app
- **Files:** `mobile/lib/main.dart`, `mobile/lib/offline/*`, `mobile/lib/screens/*`
- **Status:** Implemented; doctor/consultation screens added (untracked). `flutter analyze` clean of errors; `flutter test` 12/12 pass.
- **Defects:** `PatientSummaryScreen` is imported from `visit_workflow_screens.dart` (works, but naming is misleading). `home_shell.dart` and `home_screen.dart` appear unused in `main.dart` routes. New doctor flow is reachable via `/doctor` route but no UI entry point in `AshaHomeScreen` was verified.

### F16. Database migrations
- **Files:** `backend/migrations/002..010*.sql`
- **Status:** Partially implemented.
- **Defects:** No `001` baseline migration; no `users` table migration; SQLite dev path auto-creates via `create_all`, masking the gap. Migration `010` adds `consultation_id` to `care_prescriptions` (good).

### F17. Tests
- **Backend:** 89 tests (accessibility, auth, case_taking, consultation, cors, endpoints, follow_up, patient_auth, referral, sync, visits, voice reply). `test_auth.py` covers staff bearer-token validation; `test_patient_auth.py` covers OTP login, lockout, patient-owned endpoints.
- **Mobile:** 12 tests (offline DB, triage, case taking, visits, sync).
- **Web:** no test runner configured (only `lint` and `build`).

### F18. Internationalisation (web)
- **Files:** `web/src/i18n/index.tsx`, `web/src/lib/constants.ts`
- **Status:** Implemented; recently extended to ml/mr/bn/gu (constants.ts diff).
- **Defects:** `patient_reply_service` templates only cover en/hi/ta/kn/te/ml/mr/bn/gu (9) — matches. But `_normalize_language` falls back to `en` silently; acceptable.

## 4. Confirmed Defects (reproduced, not just suspected)

1. **Patient sync 422 (no ABHA)** — `POST /api/v1/patients/` requires `abha_id`; mobile omits it when the ASHA leaves it blank. Probe: HTTP 422 `{"loc":["body","abha_id"],"msg":"Field required"}`.
2. **Prescription sync 422 (extra field)** — RESOLVED: `CarePrescriptionCreateSchema` now accepts optional `consultation_local_uuid` and resolves it to `consultation_id`. (Probe verified 201 with link persisted.)
3. **Auth not wired to data layer** — staff data endpoints remain open; web client never sends the bearer token except `/auth/me`. (Patient OTP auth was added and is tested, but it only protects `/patient-auth/*` routes; cross-role enforcement is still missing.)
4. **No `users`/`otp` migration** — PostgreSQL deployments cannot register/login or issue patient OTPs.
5. **No role separation** — single `User` model; patient vs staff auth conflated.
6. **Permanent failure burn** — 4xx validation errors consume 8 retry attempts with exponential backoff before going `DEAD`; no fast-fail classification.
7. **Lint config scans vendored JS** — oxlint walks `web/android/.../whisper/*.js`.
8. **Stray artifacts** — `_verify/` probe scripts, `arroh_dev.db` at repo root, `backend/arroh.db` + `backend/arroh_dev.db`.

## 5. Recommended First Feature to Implement

**Phase G (Offline sync) — Fix the two confirmed 422 contract mismatches (F2 + F6).** Patient authentication (OTP) is now implemented and tested, so the auth facade is partially closed; remaining auth work is migration + interceptor + RBAC (see F13).

Rationale:
- The defects are reproduced with HTTP evidence, not suspected.
- They silently break the core offline promise: registrations and prescriptions entered by ASHA/doctors never reach the server and die after 8 retries.
- Fixing them is small, surgical, and testable via the existing `test_sync_contract.py` + targeted contract tests.

Recommended sequence (each independently testable):
1. Make `abha_id` optional on the backend (or have mobile generate a placeholder) — prefer backend: `abha_id: str | None` with the 14-digit pattern applied only when present. Add a test.
2. Add `consultation_local_uuid` (or `consultation_id`) handling to `CarePrescriptionCreateSchema` / endpoint: accept `consultation_local_uuid`, resolve via the same local→server map used by sync, or simply accept and ignore unknown extras (remove `extra="forbid"` is wrong; instead add the field as `uuid.UUID | None` or `str | None`). Add a test.
3. Add a `users` migration (011) and a role column; create `test_auth.py`.
4. Add a request interceptor in `web/src/services/api.ts` attaching `Authorization: Bearer <token>` from `localStorage`, and 401 → logout.

## 6. Explicitly Out of Scope for This Audit

- No application code was modified during this audit (only `docs/FEATURE_AUDIT.md` created and probe scripts in `_verify/`).
- No databases were reset or deleted.
- No commits were made.
