/**
 * Shared ARROH API types.
 *
 * Every interface here mirrors the verified FastAPI/OpenAPI contract exactly.
 * Fields were read from the backend schemas (`app/schemas/*.py`) — nothing is
 * invented. Nullable fields are typed as `null | value` so callers handle them
 * explicitly instead of silently passing broken data.
 */

/* ----------------------------- Enumerations ----------------------------- */

/** Clinical priority. Never shown by color alone — always paired with a text label. */
export type TriageStatus = 'RED' | 'YELLOW' | 'GREEN';

/** FHIR gender values accepted by the patient + sync schemas. */
export type Gender = 'male' | 'female' | 'other' | 'unknown';

/** Communication modes for the accessible intake layer. */
export type CommunicationMode = 'deaf' | 'speech_impaired' | 'low_literacy' | 'standard';

/* ------------------------------- Patients ------------------------------- */

/** A patient as returned by the list / detail / create endpoints (FHIR-projected). */
export interface Patient {
  id: string;
  name: string;
  gender: Gender;
  birth_date: string;
  abha_id: string | null;
  abha_address: string | null;
  phone_number: string | null;
  village: string | null;
  phc_id: string | null;
  district: string;
  state: string;
  triage_status: TriageStatus;
  is_synced_offline: boolean;
  created_at: string;
}

/**
 * Payload to register a patient.
 * `abha_id` is REQUIRED at creation (14 digits) — the frontend mirrors that.
 * `is_synced_offline` defaults to false on the backend.
 */
export interface PatientCreate {
  name: string;
  gender: Gender;
  birth_date: string; // ISO date, e.g. 1990-01-01
  abha_id: string;
  abha_address?: string | null;
  phone_number?: string | null;
  village?: string | null;
  phc_id?: string | null;
  district: string;
  state: string;
  triage_status?: TriageStatus;
  is_synced_offline?: boolean;
}

/** Query string filters accepted by GET /patients/. */
export interface PatientListParams {
  phc_id?: string;
  district?: string;
  triage_status?: TriageStatus;
}

/* -------------------------------- Triage -------------------------------- */

export interface TriageRequest {
  symptoms: string[];
  vitals: Record<string, number | string>;
}

export interface AssessedVitals {
  SpO2?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate?: number;
  temperature?: number;
  hemoglobin?: number;
  [key: string]: number | undefined;
}

export interface TriageResult {
  risk_score: number;
  triage_level: TriageStatus;
  recommended_actions: string[];
  high_risk_respiratory: boolean;
  high_risk_maternal: boolean;
  maternal_conditions: string[];
  assessed_vitals: AssessedVitals;
  missing_vitals: string[];
}

/* ------------------------------ Referral -------------------------------- */

export type FacilityType = 'SUB_CENTER' | 'PHC' | 'CHC' | 'DISTRICT_HOSPITAL';
export type ReferralStatus = 'INITIATED' | 'EN_ROUTE' | 'ACCEPTED' | 'COMPLETED';

export interface ReferralRecommendationRequest {
  patient_id: string;
  triage_level: TriageStatus;
  required_capabilities: string[];
  vitals: Record<string, number | string>;
  high_risk_respiratory?: boolean;
  origin_phc_id?: string | null;
}

export interface ReferralRecommendationResponse {
  patient_id: string;
  required_capabilities: string[];
  recommendations: RecommendedFacility[];
}

export interface ReferralCreateRequest {
  patient_id: string;
  origin_phc_id: string;
  target_facility_id: string;
  target_facility_name: string;
  target_facility_type: FacilityType;
  referral_priority: TriageStatus;
  reason_for_referral: string;
  required_capabilities?: string[];
  status?: ReferralStatus;
}

export interface ReferralCreateResponse extends ReferralCreateRequest {
  referral_id: string;
  created_at: string;
}

/* ----------------------------- Voice intake ----------------------------- */

export interface VoiceParseRequest {
  transcript: string;
  language: string;
  abha_id?: string | null;
}

export interface ExtractedClinicalData {
  language: string;
  symptoms: string[];
  vitals: Record<string, number | string>;
}

export interface VoiceParseResponse {
  transcript: string;
  extracted_clinical_data: ExtractedClinicalData;
  triage_assessment: TriageResult;
}

/* ---------------------------- Accessibility ----------------------------- */

export interface FormatTriageRequest {
  patient_id: string;
  communication_mode: CommunicationMode;
  triage_payload: TriageResult;
}

export interface FormatTriageResponse {
  communication_mode: CommunicationMode;
  sign_interpreter_requested: boolean;
  visual_captions: string[];
  read_aloud_script: string;
  simplified_actions: string[];
}

/* ------------------------------ Emergency ------------------------------- */

export interface EmergencyCallRequest {
  caller_phone?: string | null;
  spoken_emergency_text: string;
  language: string;
  current_phc_id: string;
  ambulance_eta_minutes?: number;
}

export interface RagFirstAid {
  protocol_title: string;
  instructions: string[];
}

export interface RecommendedFacility {
  facility_id: string;
  facility_name: string;
  facility_type: string;
  capabilities: string[];
  distance_km: number;
  transport_eta: string;
  match_reason: string;
}

export interface AmbulanceStatus {
  eta_minutes: number;
  is_delayed: boolean;
  actionable_transport_advice: string;
}

export interface EmergencySessionResponse {
  status: 'EMERGENCY_SESSION_ACTIVE';
  parsed_clinical_data: ExtractedClinicalData;
  triage_result: TriageResult;
  rag_first_aid: RagFirstAid;
  recommended_facility: RecommendedFacility | null;
  ambulance_status: AmbulanceStatus;
  agent_spoken_voice_response: string;
}

/* ----------------------------- Tele-consult ----------------------------- */

export interface QueueJoinRequest {
  patient_id: string;
  triage_status: TriageStatus;
  phc_id: string;
}

export interface QueuePatient {
  patient_id: string;
  triage_status: TriageStatus;
  phc_id: string;
  joined_at: string;
}

export interface PrescriptionCreateRequest {
  patient_id: string;
  prescriber_id: string; // doctor ID — keep separate from phc_id, never combine
  medication_code: string;
  medication_display: string;
  dosage_instruction: string;
  status?: 'active' | 'on-hold' | 'cancelled' | 'completed' | 'stopped';
  intent?:
    | 'proposal'
    | 'plan'
    | 'order'
    | 'original-order'
    | 'reflex-order'
    | 'filler-order'
    | 'instance-order'
    | 'option';
}

export interface PrescriptionResponse {
  resourceType: 'MedicationRequest';
  id: string;
  status: string;
  intent: string;
  subject: Record<string, string>;
  authoredOn: string;
  medicationCodeableConcept: Record<string, unknown>;
  dosageInstruction: Record<string, string>[];
}

/* ------------------------------ Inventory ------------------------------- */

export type StockoutStatus = 'CRITICAL_STOCKOUT_RISK' | 'STABLE' | 'ADEQUATE';

export interface StockoutForecastItem {
  medicine_name: string;
  current_stock_level: number;
  estimated_daily_consumption: number;
  reorder_threshold: number;
  estimated_days_until_stockout: number;
  status: StockoutStatus;
  demand_signal: string;
}

export interface InventoryForecastResponse {
  phc_id: string;
  active_patient_log_count: number;
  forecasts: StockoutForecastItem[];
}

/* ----------------------------- Offline sync ----------------------------- */

/** One queued offline observation. Requires ABHA ID or phone number. */
export interface SyncRecord {
  local_client_uuid: string;
  local_timestamp: string;
  name: string;
  gender: Gender;
  birth_date: string;
  abha_id?: string | null;
  phone_number?: string | null;
  abha_address?: string | null;
  district: string;
  state: string;
  vitals: Record<string, number | string>;
  symptoms: string[];
  triage_status: TriageStatus;
}

export interface SyncPayload {
  worker_id: string;
  phc_id: string;
  sync_timestamp: string;
  records: SyncRecord[];
}

export interface ResolvedConflict {
  local_client_uuid: string;
  patient_id: string;
  resolution: string;
}

export interface SyncResponse {
  synced_count: number;
  duplicate_count: number;
  failed_count: number;
  resolved_conflicts: ResolvedConflict[];
}

export interface SmsFallbackRequest {
  compressed_payload: string;
}

export interface SmsFallbackResponse {
  patient_id: string;
  triage_status: TriageStatus;
  resolution: string;
}

/* ------------------------------ Timeline -------------------------------- */

export interface TimelineEvent {
  event_id: string;
  resource_type: string;
  event_type: string;
  occurred_at: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface PatientTimelineResponse {
  patient_id: string;
  events: TimelineEvent[];
}
