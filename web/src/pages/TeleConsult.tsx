import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Video, UserPlus, FileText, Check, Hospital, Send } from 'lucide-react';
import { joinTeleconsultQueue, getNextPatient, createPrescription } from '../services/teleconsult';
import { recommendFacilities, createReferral } from '../services/referrals';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { TriageBadge } from '../components/TriageBadge';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/Badge';
import { describeError, formatDateTime, humanize } from '../lib/format';
import { DEFAULT_PHC_ID, DEFAULT_DOCTOR_ID } from '../lib/constants';
import type {
  QueuePatient,
  TriageStatus,
  PrescriptionResponse,
  ReferralRecommendationResponse,
  RecommendedFacility,
  FacilityType,
} from '../types';

export function TeleConsult() {
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patient_id') ?? '';

  const [phcId, setPhcId] = useState(DEFAULT_PHC_ID);
  const [doctorId] = useState(DEFAULT_DOCTOR_ID);
  const [queueStatus, setQueueStatus] = useState<TriageStatus>('YELLOW');
  const [queuePatientId, setQueuePatientId] = useState(patientId);
  const [nextPatient, setNextPatient] = useState<QueuePatient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onJoinQueue(event: FormEvent) {
    event.preventDefault();
    if (!queuePatientId.trim()) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const joined = await joinTeleconsultQueue({
        patient_id: queuePatientId.trim(),
        triage_status: queueStatus,
        phc_id: phcId.trim(),
      });
      setSuccess(`Patient ${joined.patient_id} added to the ${joined.triage_status} queue.`);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function onClaimNext() {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const next = await getNextPatient({ doctor_id: doctorId.trim(), phc_id: phcId.trim() });
      setNextPatient(next);
      if (!next) setSuccess('The queue is currently empty.');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tele-Consultation"
        description="Join the doctor priority queue, claim the next patient, and issue a digital prescription."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Join consultation queue" subtitle="Add an assessed patient to the PHC queue">
            <form onSubmit={onJoinQueue} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Patient ID"
                  value={queuePatientId}
                  onChange={(event) => setQueuePatientId(event.target.value)}
                  placeholder="Patient UUID"
                />
                <Select
                  label="Triage priority"
                  value={queueStatus}
                  onChange={(event) => setQueueStatus(event.target.value as TriageStatus)}
                  options={[
                    { value: 'RED', label: 'RED (Priority)' },
                    { value: 'YELLOW', label: 'YELLOW (Close follow-up)' },
                    { value: 'GREEN', label: 'GREEN (Routine)' },
                  ]}
                />
                <Input label="PHC ID" value={phcId} onChange={(event) => setPhcId(event.target.value)} />
              </div>
              <Button type="submit" loading={loading}>
                <UserPlus className="h-4 w-4" aria-hidden="true" /> Join queue
              </Button>
            </form>
          </Card>

          <Card
            title="Next in queue"
            subtitle="Claim the highest-priority patient for this doctor"
            actions={
              <Button variant="outline" size="sm" onClick={onClaimNext} loading={loading}>
                <Video className="h-4 w-4" aria-hidden="true" /> Claim next
              </Button>
            }
          >
            {nextPatient ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-medium text-slate-900">{nextPatient.patient_id}</p>
                  <p className="text-xs text-slate-500">
                    Joined {formatDateTime(nextPatient.joined_at)} · {nextPatient.phc_id}
                  </p>
                </div>
                <TriageBadge status={nextPatient.triage_status} />
              </div>
            ) : (
              <p className="text-sm text-slate-500">Claim the next patient to pop the priority queue.</p>
            )}
          </Card>

          {Boolean(error) && <ErrorState error={error} onRetry={() => setError(null)} title="Tele-consult action failed" />}
          {success && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-priority-green">
              <Check className="h-4 w-4" aria-hidden="true" /> {success}
            </div>
          )}
        </div>

        <PrescriptionForm doctorId={doctorId} />
      </div>

      <ReferralSection defaultPhcId={phcId} />
    </div>
  );
}

function PrescriptionForm({ doctorId }: { doctorId: string }) {
  const [patientId, setPatientId] = useState('');
  const [medicationCode, setMedicationCode] = useState('');
  const [medicationDisplay, setMedicationDisplay] = useState('');
  const [dosage, setDosage] = useState('');
  const [prescription, setPrescription] = useState<PrescriptionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!patientId.trim() || !medicationCode.trim() || !medicationDisplay.trim() || !dosage.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const created = await createPrescription({
        patient_id: patientId.trim(),
        prescriber_id: doctorId.trim(),
        medication_code: medicationCode.trim(),
        medication_display: medicationDisplay.trim(),
        dosage_instruction: dosage.trim(),
      });
      setPrescription(created);
      setPatientId('');
      setMedicationCode('');
      setMedicationDisplay('');
      setDosage('');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Issue prescription" subtitle="Creates a FHIR MedicationRequest">
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label="Patient ID" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="Patient UUID" />
        <Input label="Medication code" value={medicationCode} onChange={(event) => setMedicationCode(event.target.value)} placeholder="e.g. PARACETAMOL-500" />
        <Input label="Medication name" value={medicationDisplay} onChange={(event) => setMedicationDisplay(event.target.value)} placeholder="e.g. Paracetamol 500mg" />
        <Input label="Dosage instruction" value={dosage} onChange={(event) => setDosage(event.target.value)} placeholder="e.g. 1 tablet three times daily after food" />
        <Button type="submit" loading={loading} className="w-full">
          <FileText className="h-4 w-4" aria-hidden="true" /> Create prescription
        </Button>
      </form>

      {Boolean(error) && (
        <p className="mt-3 text-sm text-priority-red">{describeError(error).friendly}</p>
      )}
      {prescription && (
        <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm">
          <p className="font-semibold text-priority-green">Prescription issued</p>
          <p className="mt-1 text-slate-700">
            {(prescription.medicationCodeableConcept as { text?: string })?.text || '—'}
          </p>
          <p className="text-xs text-slate-500">
            Status: {humanize(prescription.status)} · Intent: {humanize(prescription.intent)}
          </p>
          <div className="mt-2 space-y-1">
            {prescription.dosageInstruction?.map((instruction, index) => (
              <Badge key={index} tone="green">
                {instruction.text}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ReferralSection({ defaultPhcId }: { defaultPhcId: string }) {
  const [patientId, setPatientId] = useState('');
  const [originPhc, setOriginPhc] = useState(defaultPhcId);
  const [level, setLevel] = useState<TriageStatus>('RED');
  const [capabilities, setCapabilities] = useState('ICU,OXYGEN_CYLINDER');
  const [vitalsSpo2, setVitalsSpo2] = useState('');
  const [highRiskRespiratory, setHighRiskRespiratory] = useState(true);
  const [data, setData] = useState<ReferralRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [reason, setReason] = useState('');
  const [referralStatus, setReferralStatus] = useState<string | null>(null);

  async function onRecommend(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setReferralStatus(null);
    if (!patientId.trim()) return;
    const vitals: Record<string, number | string> = {};
    if (vitalsSpo2.trim()) vitals.spo2 = Number(vitalsSpo2);
    setLoading(true);
    try {
      const response = await recommendFacilities({
        patient_id: patientId.trim(),
        triage_level: level,
        required_capabilities: capabilities
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        vitals,
        high_risk_respiratory: highRiskRespiratory,
        origin_phc_id: originPhc.trim() || null,
      });
      setData(response);
    } catch (err) {
      setData(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function onRefer(facility: RecommendedFacility) {
    setError(null);
    setReferralStatus(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setError('Reason for referral is required (at least 5 characters).');
      return;
    }
    setLoading(true);
    try {
      const created = await createReferral({
        patient_id: patientId.trim(),
        origin_phc_id: originPhc.trim(),
        target_facility_id: facility.facility_id,
        target_facility_name: facility.facility_name,
        target_facility_type: facility.facility_type as FacilityType,
        referral_priority: level,
        reason_for_referral: reason.trim(),
        required_capabilities: facility.capabilities,
      });
      setReferralStatus(`Referral ${created.referral_id} locked to ${facility.facility_name}.`);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      title="Smart referrals"
      subtitle="Rank capable facilities, then lock the referral to a specific destination."
    >
      <form onSubmit={onRecommend} className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Patient ID"
          value={patientId}
          onChange={(event) => setPatientId(event.target.value)}
          placeholder="Patient UUID"
        />
        <Input
          label="Origin PHC ID"
          value={originPhc}
          onChange={(event) => setOriginPhc(event.target.value)}
        />
        <Select
          label="Triage level"
          value={level}
          onChange={(event) => setLevel(event.target.value as TriageStatus)}
          options={[
            { value: 'RED', label: 'RED' },
            { value: 'YELLOW', label: 'YELLOW' },
            { value: 'GREEN', label: 'GREEN' },
          ]}
        />
        <Input
          label="Required capabilities (comma)"
          value={capabilities}
          onChange={(event) => setCapabilities(event.target.value)}
          placeholder="ICU,OXYGEN_CYLINDER,BLOOD_BANK"
        />
        <Input
          label="SpO2 (%)"
          value={vitalsSpo2}
          onChange={(event) => setVitalsSpo2(event.target.value.replace(/\D/g, ''))}
          inputMode="decimal"
        />
        <Select
          label="High-risk respiratory"
          value={highRiskRespiratory ? 'yes' : 'no'}
          onChange={(event) => setHighRiskRespiratory(event.target.value === 'yes')}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
        <div className="sm:col-span-3 flex">
          <Button type="submit" loading={loading}>
            <Hospital className="h-4 w-4" aria-hidden="true" /> Recommend facilities
          </Button>
        </div>
      </form>

      <div className="mt-4">
        <Input
          label="Reason for referral"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Hypoxia with SpO2 84%, requires ICU and oxygen"
          hint="Required to lock a referral. Minimum 5 characters."
        />
      </div>

      {Boolean(error) && (
        <p className="mt-3 text-sm text-priority-red">{describeError(error).friendly}</p>
      )}
      {referralStatus && (
        <p className="mt-3 flex items-center gap-2 text-sm text-priority-green">
          <Check className="h-4 w-4" aria-hidden="true" /> {referralStatus}
        </p>
      )}

      {data && data.recommendations.length > 0 && (
        <ul className="mt-4 space-y-3">
          {data.recommendations.map((facility, index) => (
            <li
              key={facility.facility_id}
              className={
                index === 0
                  ? 'rounded-lg border-2 border-red-300 bg-red-50 p-4'
                  : 'rounded-lg border border-slate-200 bg-white p-4'
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-900">
                    {facility.facility_name}{' '}
                    {index === 0 && <Badge tone="red">Top match</Badge>}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {humanize(facility.facility_type)} · {facility.facility_id}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>
                    Distance: <span className="font-semibold text-slate-700">{facility.distance_km} km</span>
                  </p>
                  <p>
                    ETA: <span className="font-semibold text-slate-700">{facility.transport_eta}</span>
                  </p>
                </div>
              </div>
              {facility.capabilities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {facility.capabilities.map((capability) => (
                    <Badge key={capability} tone="brand">
                      {humanize(capability)}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="mt-2 text-sm text-slate-700">{facility.match_reason}</p>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => onRefer(facility)} loading={loading}>
                  <Send className="h-4 w-4" aria-hidden="true" /> Lock referral
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}