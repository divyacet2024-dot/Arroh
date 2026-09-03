import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardPlus, Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/ui/Input';
import { startConsultation, completeConsultation, createDischarge, type Consultation as ConsultationRecord } from '../services/consultations';
import { DEFAULT_DOCTOR_ID } from '../lib/constants';

export function Consultation() {
  const [params] = useSearchParams();
  const [patientId, setPatientId] = useState(params.get('patient_id') ?? '');
  const [referralId, setReferralId] = useState(params.get('referral_id') ?? '');
  const [doctorId] = useState(DEFAULT_DOCTOR_ID);
  const [record, setRecord] = useState<ConsultationRecord | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [treatment, setTreatment] = useState('');
  const [warningSigns, setWarningSigns] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function saveConsultation(event: FormEvent) {
    event.preventDefault();
    if (!patientId.trim()) return;
    setBusy(true); setMessage('');
    try {
      const created = await startConsultation({ patient_id: patientId.trim(), doctor_id: doctorId, referral_id: referralId.trim() || null, chief_complaint: '', history: '', findings: '', vitals: {}, assessment: '', clinical_impression: '', treatment_plan: '' });
      setRecord(created);
      setMessage('Consultation started. Clinical fields remain doctor-authored.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start consultation'); }
    finally { setBusy(false); }
  }

  async function complete(event: FormEvent) {
    event.preventDefault();
    if (!record) return;
    setBusy(true); setMessage('');
    try {
      await completeConsultation(record.id, doctorId);
      if (diagnosis && treatment) {
        await createDischarge({ consultation_id: record.id, doctor_id: doctorId, diagnosis, treatment_instructions: treatment, medication_instructions: [], warning_signs: warningSigns.split(',').map((item) => item.trim()).filter(Boolean), emergency_return_instructions: 'Return immediately if warning signs worsen.', follow_up_required: Boolean(followUpAt), follow_up_due_at: followUpAt || null });
      }
      setMessage('Consultation completed and discharge plan saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete consultation'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <PageHeader title="Doctor consultation" description="Record clinician-authored assessment, treatment, and discharge information." />
    <Card title="Consultation context"><form onSubmit={saveConsultation} className="grid gap-4 sm:grid-cols-2">
      <Input label="Patient ID" value={patientId} onChange={(event) => setPatientId(event.target.value)} required />
      <Input label="Referral ID (optional)" value={referralId} onChange={(event) => setReferralId(event.target.value)} />
      <Button type="submit" loading={busy}><ClipboardPlus className="h-4 w-4" aria-hidden="true" /> Start consultation</Button>
    </form></Card>
    {record && <form onSubmit={complete} className="space-y-6">
      <Card title="Clinical assessment"><div className="grid gap-4 sm:grid-cols-2">
        <Input label="Clinical impression / diagnosis" value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} required />
        <Input label="Treatment instructions" value={treatment} onChange={(event) => setTreatment(event.target.value)} required />
        <Input label="Warning signs (comma separated)" value={warningSigns} onChange={(event) => setWarningSigns(event.target.value)} />
        <Input label="Follow-up date/time (optional)" type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} />
      </div></Card>
      <Button type="submit" loading={busy}><Save className="h-4 w-4" aria-hidden="true" /> Complete and discharge</Button>
    </form>}
    {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
  </div>;
}
