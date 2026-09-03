/** Web client for the AI-assisted case-taking backend endpoints. */

import { request } from './api';

export interface ExtractedSymptom {
  symptom: string;
  body_location?: string | null;
  onset?: string | null;
  duration?: string | null;
  severity?: string | null;
  associated?: string[];
  confidence: number;
  source: string;
  confirmed_by_user: boolean;
}

export interface StructuredCase {
  symptoms: ExtractedSymptom[];
  duration?: string | null;
  severity?: string | null;
  location?: string | null;
  associated_symptoms: string[];
  pregnancy_status?: string | null;
  injury?: string | null;
  medications: string[];
  allergies: string[];
  relevant_vitals: Record<string, number>;
  language: string;
  raw_transcript: string;
  overall_confidence: number;
  notes: string[];
}

export interface FollowUpQuestion {
  question_id: string;
  prompt: string;
  prompt_translations: Record<string, string>;
  expected_kind: string;
  priority: number;
  safety_reason: string;
}

export interface CaseSession {
  case_id: string;
  patient_local_uuid?: string | null;
  language: string;
  started_at: string;
  ai_proposed_case: StructuredCase;
  patient_case: StructuredCase;
  doctor_case?: StructuredCase | null;
  triage_result: Record<string, unknown>;
  safety_flags: string[];
  follow_up_questions: FollowUpQuestion[];
  answers: Array<Record<string, unknown>>;
  emergency_intent_detected: boolean;
  rag_result?: Record<string, unknown> | null;
  timeline_events: Array<Record<string, unknown>>;
  completed: boolean;
  completed_at?: string | null;
  notes: string[];
  ai_provider?: string;
}

export interface StartCaseResponse {
  session: CaseSession;
  rag?: Record<string, unknown> | null;
}

export const caseTakingService = {
  startCase: (requestBody: { transcript: string; language?: string; patient_local_uuid?: string }) =>
    request<StartCaseResponse>({
      method: 'POST',
      url: '/case-taking/start',
      data: requestBody,
    }),

  answerQuestion: (requestBody: { session: CaseSession; question_id: string; answer: string }) =>
    request<{ session: CaseSession }>({
      method: 'POST',
      url: '/case-taking/answer',
      data: requestBody,
    }),

  confirmCase: (requestBody: { session: CaseSession }) =>
    request<{ case_session: CaseSession; triage_result: Record<string, unknown> }>({
      method: 'POST',
      url: '/case-taking/confirm',
      data: requestBody,
    }),

  doctorEdit: (requestBody: { patient_id: string; session: CaseSession; notes?: string }) =>
    request<{ case_session: CaseSession; triage_result: Record<string, unknown>; timeline?: unknown }>({
      method: 'POST',
      url: '/case-taking/doctor-edit',
      data: requestBody,
    }),

  listPatientCases: (patientId: string) =>
    request<{ patient_id: string; cases: CaseSession[] }>({
      method: 'GET',
      url: `/case-taking/patient/${patientId}/cases`,
    }),

  getCase: (caseId: string) =>
    request<CaseSession>({
      method: 'GET',
      url: `/case-taking/case/${caseId}`,
    }),

  searchKnowledge: (query: string, language = 'en', topic?: string) => {
    const params = new URLSearchParams({ q: query, language });
    if (topic) params.append('topic', topic);
    return request<Record<string, unknown>>({
      method: 'GET',
      url: `/case-taking/knowledge/search?${params.toString()}`,
    });
  },
};

