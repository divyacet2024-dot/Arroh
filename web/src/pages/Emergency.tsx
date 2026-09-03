import { useEffect, useState, type FormEvent } from 'react';
import { Siren, Ambulance, MapPin, ShieldAlert, AlertTriangle, Phone, Building2 } from 'lucide-react';
import { emergencySession } from '../services/emergency';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { TriageBadge } from '../components/TriageBadge';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/Badge';
import { formatVital, humanize } from '../lib/format';
import { SUPPORTED_LANGUAGES, DEFAULT_PHC_ID } from '../lib/constants';
import type { EmergencySessionResponse } from '../types';
import type { TriageStatus } from '../types';

const HIGH_RISK_DELAYS_THRESHOLD_MIN = 30;

export function Emergency() {
  const [transcript, setTranscript] = useState('');
  const [language, setLanguage] = useState('en');
  const [phcId, setPhcId] = useState(DEFAULT_PHC_ID);
  const [callerPhone, setCallerPhone] = useState('');
  const [ambulanceEta, setAmbulanceEta] = useState(30);
  const [result, setResult] = useState<EmergencySessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    if (result?.ambulance_status.eta_minutes) {
      setAmbulanceEta(result.ambulance_status.eta_minutes);
    }
  }, [result]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!transcript.trim()) return;
    setLoading(true);
    try {
      const session = await emergencySession({
        caller_phone: callerPhone.trim() || null,
        spoken_emergency_text: transcript.trim(),
        language,
        current_phc_id: phcId.trim(),
        ambulance_eta_minutes: ambulanceEta,
      });
      setResult(session);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency voice agent"
        description="Start a trauma emergency session. The agent parses the call, triages, and gives first-aid + transport guidance."
      />

      <form onSubmit={onSubmit} className="max-w-3xl">
        <Card title="Emergency intake">
          <div className="space-y-4">
            <label htmlFor="emergency-text" className="block text-base font-semibold text-slate-800">
              Describe the emergency
            </label>
            <textarea
              id="emergency-text"
              rows={5}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="e.g. A 30-year-old woman is unconscious after a snakebite, breathing rapidly…"
              className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
              aria-describedby="emergency-help"
            />
            <p id="emergency-help" className="text-xs text-slate-500">
              Speak plainly — vitals, mechanism, age, and pregnancy status help the agent prioritise.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                options={SUPPORTED_LANGUAGES.map((language) => ({
                  value: language.code,
                  label: language.label,
                }))}
              />
              <Input label="PHC ID" value={phcId} onChange={(event) => setPhcId(event.target.value)} />
              <Input
                label="Caller phone"
                value={callerPhone}
                onChange={(event) => setCallerPhone(event.target.value.replace(/\D/g, ''))}
                maxLength={15}
                hint="Optional"
              />
              <Input
                label="Ambulance ETA (min)"
                type="number"
                min={0}
                max={240}
                value={ambulanceEta}
                onChange={(event) => setAmbulanceEta(Math.max(0, Math.min(240, Number(event.target.value) || 0)))}
              />
            </div>
            <Button
              type="submit"
              variant="danger"
              size="lg"
              loading={loading}
              className="w-full text-base"
            >
              <Siren className="h-5 w-5" aria-hidden="true" />
              Start emergency session
            </Button>
          </div>
        </Card>
      </form>

      {Boolean(error) && <ErrorState error={error} onRetry={() => setError(null)} title="Emergency session failed" />}

      {result && <EmergencyResult session={result} />}
    </div>
  );
}

function EmergencyResult({ session }: { session: EmergencySessionResponse }) {
  const facility = session.recommended_facility;
  const delayed = session.ambulance_status.is_delayed;
  const longDelay = session.ambulance_status.eta_minutes >= HIGH_RISK_DELAYS_THRESHOLD_MIN;
  return (
    <div className="space-y-6">
      <div
        role="alert"
        className="rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4"
      >
        <div className="flex items-center gap-2 text-base font-bold uppercase tracking-wide text-priority-red">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          {session.status === 'EMERGENCY_SESSION_ACTIVE' ? 'Emergency session active' : session.status}
        </div>
        <p className="mt-2 text-base text-red-900">{session.agent_spoken_voice_response}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Triage assessment">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-500">Risk score</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {session.triage_result.risk_score}
                  <span className="text-base font-medium text-slate-400">/100</span>
                </p>
              </div>
              <TriageBadge status={session.triage_result.triage_level as TriageStatus} />
            </div>
            {session.triage_result.high_risk_respiratory && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-priority-amber">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                High-risk respiratory case — prioritise oxygen-aware facility.
              </div>
            )}
            {session.triage_result.high_risk_maternal && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-priority-amber">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Maternal high-risk markers: {session.triage_result.maternal_conditions.join(', ')}
              </div>
            )}
          </Card>

          <Card title="First aid protocol">
            <p className="text-base font-semibold text-slate-900">{session.rag_first_aid.protocol_title}</p>
            <ol className="mt-3 space-y-2 text-base text-slate-800">
              {session.rag_first_aid.instructions.map((instruction, index) => (
                <li key={index} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-100 text-sm font-bold text-priority-red">
                    {index + 1}
                  </span>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Recommended facility">
            {facility ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden="true" />
                  <div>
                    <p className="text-base font-semibold text-slate-900">{facility.facility_name}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {humanize(facility.facility_type)} · {facility.facility_id}
                    </p>
                  </div>
                </div>
                {facility.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {facility.capabilities.map((capability) => (
                      <Badge key={capability} tone="brand">
                        {humanize(capability)}
                      </Badge>
                    ))}
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Distance</dt>
                    <dd className="font-semibold text-slate-900">{facility.distance_km} km</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Transport ETA</dt>
                    <dd className="font-semibold text-slate-900">{facility.transport_eta}</dd>
                  </div>
                </dl>
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{facility.match_reason}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No facility matched for this scenario.</p>
            )}
          </Card>

          <Card title="Ambulance status">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-red-100">
                <Ambulance className="h-6 w-6 text-priority-red" aria-hidden="true" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">
                  ETA {session.ambulance_status.eta_minutes} minutes
                  {delayed && (
                    <Badge tone="red" className="ml-2">
                      Delayed
                    </Badge>
                  )}
                </p>
                <p className="mt-1 text-sm text-slate-700">{session.ambulance_status.actionable_transport_advice}</p>
                {longDelay && (
                  <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-priority-amber">
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    Arrange alternate transport — see <MapPin className="ml-1 h-3.5 w-3.5" aria-hidden="true" /> recommended facility above.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <Card title="Parsed clinical data">
            <div className="space-y-3">
              {session.parsed_clinical_data.symptoms.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symptoms</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {session.parsed_clinical_data.symptoms.map((symptom, index) => (
                      <Badge key={index} tone="neutral">
                        {humanize(symptom)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(session.parsed_clinical_data.vitals).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vitals</p>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    {Object.entries(session.parsed_clinical_data.vitals).map(([key, value]) => (
                      <div key={key} className="rounded-lg bg-slate-50 px-3 py-2">
                        <dt className="text-xs text-slate-500">{key}</dt>
                        <dd className="text-sm font-medium text-slate-900">{formatVital(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}