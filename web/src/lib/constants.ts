/**
 * Demo / default identifiers used across the UI.
 *
 * These are example values for the SIH demonstration only. They are editable at
 * runtime and are NOT fabricated clinical data — they identify the (demo) user
 * session, not patients. Patient records always come from the live backend.
 */

/** Physical location used for tele-consultation, inventory and emergency flows. */
export const DEFAULT_PHC_ID = 'PHC-MND-01';

/** Default doctor card used when the doctor portal signs in. */
export const DEFAULT_DOCTOR_ID = 'DOC-KAR-881';

/** Default field-worker id used when auto-flushing the offline outbox. */
export const DEFAULT_WORKER_ID = 'ASHA-DEMO-01';

/** Languages accepted by the voice / emergency endpoints. */
export const SUPPORTED_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'kn', label: 'Kannada' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
];

/** Common vitals available for triage input, with friendly labels + units. */
export const VITAL_FIELDS: { key: string; label: string; unit?: string }[] = [
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'heart_rate', label: 'Heart rate', unit: 'bpm' },
  { key: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'systolic_bp', label: 'Systolic BP', unit: 'mmHg' },
  { key: 'diastolic_bp', label: 'Diastolic BP', unit: 'mmHg' },
  { key: 'hemoglobin', label: 'Hemoglobin', unit: 'g/dL' },
];

/** Common symptom choices offered to a field worker, mapped to free text. */
export const SYMPTOM_PRESETS: { label: string; value: string }[] = [
  { label: 'Chest pain', value: 'chest pain' },
  { label: 'Shortness of breath', value: 'shortness of breath' },
  { label: 'High fever', value: 'high fever' },
  { label: 'Abnormal bleeding', value: 'abnormal bleeding' },
  { label: 'Snakebite', value: 'snakebite' },
  { label: 'Pregnant', value: 'pregnant' },
  { label: 'Pre-eclampsia', value: 'pre-eclampsia' },
  { label: 'Severe headache', value: 'severe headache' },
  { label: 'Facial swelling', value: 'facial swelling' },
  { label: 'Loss of consciousness', value: 'unconscious' },
  { label: 'Head injury', value: 'head injury' },
];

/** How often the frontend re-checks backend health (ms). */
export const HEALTH_POLL_INTERVAL_MS = 15000;
