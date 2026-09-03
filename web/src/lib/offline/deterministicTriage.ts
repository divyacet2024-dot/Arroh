/**
 * Deterministic, network-free triage rule engine.
 *
 * This is a conservative decision layer used when offline. It intentionally
 * mirrors the backend `ai_triage` deterministic rules so on-device and server
 * agree on the clear-cut cases. It is NOT a medical chatbot: when the input is
 * ambiguous or missing critical vitals it returns `unableToAssess: true` with
 * a directive to seek professional evaluation.
 *
 * Medical safety invariants:
 *  - RED flags always win (highest priority), regardless of score.
 *  - Ambiguity escalates to "unable to safely assess" rather than guessing.
 *  - The UI always shows the disclaimer that this is not a diagnosis.
 */

import type { OfflineTriageVerdict } from './interfaces';

const NOT_ENOUGH_INFO = 'Unable to safely assess. Please seek professional medical evaluation.';

export interface OfflineTriageInput {
  symptoms: string[];
  vitals: Record<string, number | string>;
}

function numberFrom(vitals: Record<string, number | string>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(vitals[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function includes(symptoms: string[], needle: string): boolean {
  return symptoms.some((symptom) => symptom.toLowerCase().includes(needle));
}

function redScreen(riskScore: number, actions: string[], maternal: string[]): OfflineTriageVerdict {
  return {
    risk_score: riskScore,
    triage_level: 'RED',
    recommended_actions: actions,
    maternal_conditions: maternal,
    unableToAssess: false,
  };
}

export function assessOfflineTriage(input: OfflineTriageInput): OfflineTriageVerdict {
  const symptoms = input.symptoms.map((symptom) => symptom.toLowerCase());
  const vitals = input.vitals;
  const maternal: string[] = [];

  const spo2 = numberFrom(vitals, ['spo2']);
  const systolic = numberFrom(vitals, ['systolic_bp']);
  const heartRate = numberFrom(vitals, ['heart_rate']);
  const temperature = numberFrom(vitals, ['temperature']);

  /* ----- RED flags: unconditional escalation, never downgraded ----- */
  const redActions: string[] = [];
  let red = false;

  if (includes(symptoms, 'unconscious') || includes(symptoms, 'loss of consciousness')) {
    red = true;
    redActions.push('Immediately call an ambulance. The person is not breathing normally / is unconscious.');
  }
  if (includes(symptoms, 'abnormal bleeding')) {
    red = true;
    redActions.push('Control bleeding with direct pressure and transport to the nearest emergency facility now.');
  }
  if (includes(symptoms, 'snakebite')) {
    red = true;
    redActions.push('Keep the victim still and calmly transport to a facility with anti-venom. Do not apply a tourniquet.');
  }
  if (includes(symptoms, 'head injury')) {
    red = true;
    redActions.push('Head injury with possible brain involvement — immobilise the neck and go to hospital immediately.');
  }
  if (spo2 !== null && spo2 < 90) {
    red = true;
    redActions.push('Oxygen saturation is dangerously low. Provide oxygen if available and transport immediately.');
  }
  if (includes(symptoms, 'chest pain')) {
    red = true;
    redActions.push('Chest pain may be a heart event. Call emergency services and do not let the person walk.');
  }

  /* ----- Maternal high-risk markers (mirrors backend rules) ----- */
  const pregnant = includes(symptoms, 'pregnant') || includes(symptoms, 'pregnancy');
  if (pregnant && (includes(symptoms, 'pre-eclampsia') || includes(symptoms, 'facial swelling') || includes(symptoms, 'severe headache'))) {
    maternal.push('Pre-eclampsia');
  }
  if (pregnant && includes(symptoms, 'abnormal bleeding')) {
    maternal.push('Antepartum haemorrhage');
  }
  if (pregnant && includeHemoglobinLow(vitals)) {
    maternal.push('Severe anaemia in pregnancy');
  }
  if (maternal.length > 0) {
    red = true;
    redActions.push('Pregnancy with a high-risk marker — refer for obstetric care without delay.');
  }

  if (red) {
    return redScreen(100, redActions, maternal);
  }

  /* ----- YELLOW: needs follow-up but not immediately life-threatening ----- */
  const yellowActions: string[] = [];
  let yellow = false;

  if (temperature !== null && temperature >= 39.5) {
    yellow = true;
    yellowActions.push('Very high fever. Use paracetamol and arrange review within the day.');
  }
  if (includes(symptoms, 'shortness of breath')) {
    yellow = true;
    yellowActions.push('Breathing difficulty — rest, sit upright, and monitor oxygen. Seek review today.');
  }
  if (spo2 !== null && spo2 < 94) {
    yellow = true;
    yellowActions.push('Borderline low oxygen saturation — monitor closely and seek review.');
  }
  if (systolic !== null && systolic >= 140) {
    yellow = true;
    yellowActions.push('Elevated blood pressure — confirm with a repeat reading and arrange follow-up.');
  }
  if (heartRate !== null && (heartRate > 110 || heartRate < 55)) {
    yellow = true;
    yellowActions.push('Abnormal heart rate — rest and arrange review today.');
  }
  if (includes(symptoms, 'high fever') || includes(symptoms, 'severe headache')) {
    yellow = true;
    yellowActions.push('Fever or severe headache — hydrate and seek a health-worker review.');
  }

  if (yellow) {
    return { risk_score: 55, triage_level: 'YELLOW', recommended_actions: yellowActions, maternal_conditions: maternal, unableToAssess: false };
  }

  /* ----- GREEN: routine ----- */
  if (symptoms.length > 0 || Object.keys(vitals).length > 0) {
    return {
      risk_score: 15,
      triage_level: 'GREEN',
      recommended_actions: ['Mild presentation. Routine care and preventive follow-up is appropriate.'],
      maternal_conditions: maternal,
      unableToAssess: false,
    };
  }

  /* ----- Ambiguous: not enough information to classify safely ----- */
  return {
    risk_score: 0,
    triage_level: 'RED',
    recommended_actions: [NOT_ENOUGH_INFO],
    maternal_conditions: [],
    unableToAssess: true,
  };
}

function includeHemoglobinLow(vitals: Record<string, number | string>): boolean {
  const hb = numberFrom(vitals, ['hemoglobin']);
  return hb !== null && hb < 7;
}

export { NOT_ENOUGH_INFO };
