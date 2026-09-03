import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { assessTriage, formatTriage } from '../services/triage';
import { ApiError } from '../services/api';
import { useConnectivity } from '../lib/offline/connectivity';
import { assessOfflineTriage } from '../lib/offline/deterministicTriage';
import type { OfflineTriageVerdict } from '../lib/offline/interfaces';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Badge } from '../components/ui/Badge';
import { TriageBadge } from '../components/TriageBadge';
import { ErrorState } from '../components/ErrorState';
import { formatVital } from '../lib/format';
import { VITAL_FIELDS, SYMPTOM_PRESETS } from '../lib/constants';
import { cn } from '../lib/cn';
import type { TriageResult, CommunicationMode, FormatTriageResponse } from '../types';

function offlineToTriage(verdict: OfflineTriageVerdict): TriageResult {
  return {
    risk_score: verdict.risk_score,
    triage_level: verdict.triage_level,
    recommended_actions: verdict.recommended_actions,
    high_risk_respiratory: verdict.triage_level === 'RED',
    high_risk_maternal: verdict.maternal_conditions.length > 0,
    maternal_conditions: verdict.maternal_conditions,
    assessed_vitals: {},
    missing_vitals: [],
  };
}

interface VitalInput {
  value: string;
}
const emptyVitals: Record<string, VitalInput> = Object.fromEntries(
  VITAL_FIELDS.map((field) => [field.key, { value: '' }]),
);

export function Triage() {
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patient_id') ?? '';

  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [vitals, setVitals] = useState<Record<string, VitalInput>>(emptyVitals);
  const [mode, setMode] = useState<CommunicationMode>('standard');
  const { online } = useConnectivity();
  const [result, setResult] = useState<TriageResult | null>(null);
  const [formatted, setFormatted] = useState<FormatTriageResponse | null>(null);
  const [usedOffline, setUsedOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  function toggleSymptom(value: string) {
    setSelectedSymptoms((previous) =>
      previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value],
    );
  }

  function setVital(key: string, value: string) {
    setVitals((previous) => ({ ...previous, [key]: { value } }));
  }

  function buildVitalsPayload(): Record<string, number | string> {
    const payload: Record<string, number | string> = {};
    VITAL_FIELDS.forEach((field) => {
      const raw = vitals[field.key]?.value.trim();
      if (!raw) return;
      const number = Number(raw);
      payload[field.key] = Number.isFinite(number) ? number : raw;
    });
    return payload;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFormatted(null);
    setUsedOffline(false);
    const vitalsPayload = buildVitalsPayload();
    setLoading(true);
    try {
      const triage = await assessTriage({ symptoms: selectedSymptoms, vitals: vitalsPayload });
      setResult(triage);
      if (patientId && mode !== 'standard') {
        const formatted = await formatTriage({
          patient_id: patientId,
          communication_mode: mode,
          triage_payload: triage,
        });
        setFormatted(formatted);
      }
    } catch (err) {
      // Genuine offline fallback: use the network-free deterministic rule layer
      // when we are offline or the backend was unreachable (transport error).
      const transportError = err instanceof ApiError && err.status === undefined;
      if (!online || transportError) {
        const verdict = assessOfflineTriage({
          symptoms: selectedSymptoms,
          vitals: vitalsPayload,
        });
        setResult(offlineToTriage(verdict));
        setUsedOffline(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Triage"
        description="Assess symptom severity at the edge. Optionally trigger an accessible interpretation for a specific patient."
      />

      <form onSubmit={onSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Symptoms" subtitle="Tap any symptom you observe. Free-text symptoms are also accepted.">
              <div className="flex flex-wrap gap-2">
                {SYMPTOM_PRESETS.map((preset) => {
                  const active = selectedSymptoms.includes(preset.value);
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSymptom(preset.value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                        active
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-300 bg-white text-slate-600 hover:border-brand-300 hover:bg-slate-50',
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {selectedSymptoms.length === 0 && (
                <p className="mt-3 text-xs text-slate-400">No symptoms selected yet.</p>
              )}
            </Card>

            <Card title="Vitals" subtitle="Optional — missing vitals are reported by the model.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {VITAL_FIELDS.map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    inputMode="decimal"
                    value={vitals[field.key].value}
                    onChange={(event) => setVital(field.key, event.target.value)}
                    hint={field.unit}
                  />
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Accessible interpretation" subtitle="Send this triage to the accessibility formatter">
              <Select
                label="Communication mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as CommunicationMode)}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'deaf', label: 'Deaf — visual captions' },
                  { value: 'speech_impaired', label: 'Speech impaired' },
                  { value: 'low_literacy', label: 'Low literacy — read-aloud' },
                ]}
              />
              {!patientId && (
                <p className="mt-3 text-xs text-slate-500">
                  Open this page from a patient record to enable accessibility formatting.
                </p>
              )}
            </Card>

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {result ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Activity className="h-4 w-4" aria-hidden="true" />}
              {result ? 'Re-run triage' : 'Assess severity'}
            </Button>
          </div>
        </div>
      </form>

      {Boolean(error) && <ErrorState error={error} onRetry={() => setError(null)} title="Triage failed" />}

      {usedOffline && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-priority-amber">
          You are offline — this assessment used the on-device deterministic rule layer.
        </div>
      )}
      {result && <TriageResultPanel result={result} formatted={formatted} />}
    </div>
  );
}

function TriageResultPanel({
  result,
  formatted,
}: {
  result: TriageResult;
  formatted: FormatTriageResponse | null;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Assessment outcome">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-500">Risk score</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {result.risk_score}
                <span className="text-base font-medium text-slate-400">/100</span>
              </p>
            </div>
            <TriageBadge status={result.triage_level} />
          </div>

          {result.high_risk_maternal && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-priority-amber">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> High-risk pregnancy markers
              </p>
              {result.maternal_conditions.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {result.maternal_conditions.map((condition) => (
                    <li key={condition}>• {condition}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {result.missing_vitals.length > 0 && (
          <Card title="Missing vitals">
            <div className="flex flex-wrap gap-2">
              {result.missing_vitals.map((vital) => (
                <Badge key={vital} tone="neutral">
                  {vital}
                </Badge>
              ))}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Recommended actions">
          <ul className="space-y-2">
            {result.recommended_actions.length === 0 ? (
              <li className="text-sm text-slate-500">No immediate actions required.</li>
            ) : (
              result.recommended_actions.map((action, index) => (
                <li key={index} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  {action}
                </li>
              ))
            )}
          </ul>
        </Card>

        <Card title="Assessed vitals">
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(result.assessed_vitals).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">{key}</dt>
                <dd className="text-sm font-medium text-slate-900">{formatVital(value)}</dd>
              </div>
            ))}
            {Object.keys(result.assessed_vitals).length === 0 && (
              <p className="col-span-full text-sm text-slate-500">No vitals were supplied.</p>
            )}
          </dl>
        </Card>
      </div>

      {formatted && (
        <div className="lg:col-span-2">
          <Card
            title={`Accessible output — ${formatted.communication_mode}`}
            subtitle={formatted.sign_interpreter_requested ? 'Sign interpreter requested' : undefined}
          >
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Simplified actions</p>
                <ul className="mt-2 space-y-1">
                  {formatted.simplified_actions.map((action, index) => (
                    <li key={index} className="text-sm text-slate-700">
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
              {formatted.visual_captions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visual captions</p>
                  <ul className="mt-2 space-y-1">
                    {formatted.visual_captions.map((caption, index) => (
                      <li key={index} className="text-sm text-slate-700">
                        {caption}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {formatted.read_aloud_script && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Read-aloud script</p>
                  <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    {formatted.read_aloud_script}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
