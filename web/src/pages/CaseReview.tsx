import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Brain, ShieldCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { caseTakingService, type CaseSession, type ExtractedSymptom } from '../services/caseTaking';
import { useApi } from '../hooks/useApi';
import { ErrorState } from '../components/ErrorState';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { TriageBadge } from '../components/TriageBadge';
import { PageHeader } from '../components/PageHeader';
import { formatDateTime, humanize } from '../lib/format';

interface CaseReviewProps {
  caseSession?: CaseSession;
  patientId?: string;
  onSave?: (next: CaseSession) => void;
  readonly?: boolean;
}

export function CaseReview({ caseSession: initial, patientId, onSave, readonly }: CaseReviewProps) {
  const { caseId = '' } = useParams();
  const [session, setSession] = useState<CaseSession | null>(initial ?? null);
  const [loading, setLoading] = useState<boolean>(!initial);
  const [error, setError] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setSession(initial);
      setLoading(false);
      return;
    }
    let active = true;
    caseTakingService
      .getCase(caseId)
      .then((data: CaseSession) => {
        if (!active) return;
        setSession(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load case');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId, initial]);

  if (loading) {
    return <div className="text-slate-500">Loading case…</div>;
  }
  if (error) {
    return <ErrorState error={new Error(error)} title="Could not load case" />;
  }
  if (!session) {
    return <div className="text-slate-500">No case selected.</div>;
  }

  const aiSymptoms: ExtractedSymptom[] = session.ai_proposed_case.symptoms;
  const patientSymptoms: ExtractedSymptom[] = session.patient_case.symptoms;
  const triageLevel = (session.triage_result.triage_level as string) ?? 'UNKNOWN';

  const toggleSymptomConfirmed = (symptom: string) => {
    if (readonly || !session) return;
    setSession({
      ...session,
      patient_case: {
        ...session.patient_case,
        symptoms: session.patient_case.symptoms.map((s) =>
          s.symptom === symptom ? { ...s, confirmed_by_user: !s.confirmed_by_user } : s,
        ),
      },
    });
  };

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    try {
      const next = await caseTakingService.doctorEdit({
        patient_id: patientId ?? session.patient_local_uuid ?? '',
        session,
        notes: editNotes.doctor ?? undefined,
      });
      setSession(next.case_session);
      onSave?.(next.case_session);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Case review"
        description="AI-assisted case-taking session. Doctor edits are authoritative and stored alongside the AI proposal."
        actions={
          <Link to={patientId ? `/patients/${patientId}` : '/patients'} className="inline-flex items-center text-sm text-slate-600 hover:underline">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to patient
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <TriageBadge status={triageLevel as 'RED' | 'YELLOW' | 'GREEN'} />
        <Badge tone="neutral">Language: {session.language}</Badge>
        <Badge tone="neutral">AI provider: {session.ai_provider ?? 'mock'}</Badge>
        {session.emergency_intent_detected ? <Badge tone="red">Emergency intent detected</Badge> : null}
        {session.completed ? <Badge tone="green">Completed</Badge> : <Badge tone="amber">Open</Badge>}
      </div>
      {session.safety_flags.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <div className="font-semibold text-amber-800">Safety flags</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {session.safety_flags.map((flag) => (
                  <Badge key={flag} tone="amber">{flag}</Badge>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reported information" subtitle="What the patient / ASHA told us.">
          <DefinitionList
            items={[
              ['Chief concern', patientSymptoms.map((s) => s.symptom).join(', ') || '—'],
              ['Duration', session.patient_case.duration ?? 'unknown'],
              ['Severity', session.patient_case.severity ?? 'unknown'],
              ['Pregnancy', session.patient_case.pregnancy_status ?? 'unknown'],
              ['Allergies', session.patient_case.allergies.join(', ') || 'none'],
              ['Started at', formatDateTime(session.started_at)],
              ['Completed at', session.completed_at ? formatDateTime(session.completed_at) : 'in progress'],
            ]}
          />
        </Card>
        <Card title="AI-extracted information" subtitle="Symptoms the AI provider proposed. Confirm before they become part of the record.">
          {aiSymptoms.length === 0 ? <p className="text-sm text-slate-500">No symptoms extracted by the AI.</p> : null}
          <ul className="space-y-2">
            {aiSymptoms.map((symptom) => {
              const confirmed = patientSymptoms.some((s) => s.symptom === symptom.symptom && s.confirmed_by_user);
              return (
                <li key={symptom.symptom} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                  <div>
                    <div className="font-medium text-slate-800">{symptom.symptom}</div>
                    <div className="text-xs text-slate-500">
                      Confidence {Math.round(symptom.confidence * 100)}% · source {symptom.source}
                      {symptom.body_location ? ` · ${symptom.body_location}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={confirmed ? 'primary' : 'secondary'}
                    disabled={readonly}
                    onClick={() => toggleSymptomConfirmed(symptom.symptom)}
                  >
                    {confirmed ? 'Confirmed' : 'Confirm'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Measured (vitals)" subtitle="Authoritative numeric readings.">
          {Object.keys(session.patient_case.relevant_vitals).length === 0 ? (
            <p className="text-sm text-slate-500">No vitals were recorded.</p>
          ) : (
            <DefinitionList
              items={Object.entries(session.patient_case.relevant_vitals).map(([key, value]) => [
                key,
                String(value),
              ])}
            />
          )}
        </Card>
        <Card title="Deterministic safety engine" subtitle="This is the only source of truth for triage level.">
          <DefinitionList
            items={[
              ['Triage level', triageLevel],
              ['Risk score', String(session.triage_result.risk_score ?? 'n/a')],
              ['High-risk respiratory', String(session.triage_result.high_risk_respiratory ?? false)],
              ['High-risk maternal', String(session.triage_result.high_risk_maternal ?? false)],
              [
                'Maternal conditions',
                Array.isArray(session.triage_result.maternal_conditions)
                  ? (session.triage_result.maternal_conditions as string[]).join(', ') || '—'
                  : '—',
              ],
              [
                'Missing vitals',
                Array.isArray(session.triage_result.missing_vitals)
                  ? (session.triage_result.missing_vitals as string[]).join(', ') || '—'
                  : '—',
              ],
            ]}
          />
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {Array.isArray(session.triage_result.recommended_actions)
              ? (session.triage_result.recommended_actions as string[]).map((action) => (
                  <li key={action}>{action}</li>
                ))
              : null}
          </ul>
        </Card>
        {session.rag_result ? (
          <Card title="RAG knowledge base" subtitle="Curated health education (no arbitrary web search).">
            <DefinitionList
              items={Object.entries(session.rag_result)
                .filter(([key]) => key !== 'documents')
                .map(([key, value]) => [humanize(key), typeof value === 'string' ? value : JSON.stringify(value)])}
            />
            <ul className="mt-3 space-y-2 text-sm">
              {Array.isArray((session.rag_result as { documents?: Array<{ title: string; language: string; source: string; approval_status: string }> }).documents)
                ? (
                    (session.rag_result as { documents?: Array<{ title: string; language: string; source: string; approval_status: string }> }).documents ?? []
                  ).map((document) => (
                    <li key={document.title} className="rounded border border-slate-200 px-3 py-2">
                      <div className="font-medium text-slate-800">{document.title}</div>
                      <div className="text-xs text-slate-500">
                        {document.source} · {document.language} · {document.approval_status}
                      </div>
                    </li>
                  ))
                : null}
            </ul>
          </Card>
        ) : null}
        <Card title="Timeline" subtitle="What the system recorded.">
          <ul className="space-y-1 text-sm">
            {session.timeline_events.map((event, index) => (
              <li key={index} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
                <div>
                  <div className="font-medium text-slate-800">
                    {String(event.event_type ?? 'event')} · {formatDateTime(String(event.occurred_at ?? ''))}
                  </div>
                  {event.summary ? <div className="text-xs text-slate-500">{String(event.summary)}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {!readonly ? (
        <Card title="Doctor notes" subtitle="Authoritative notes attached to this case.">
          <textarea
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={editNotes.doctor ?? ''}
            onChange={(event) => setEditNotes((current) => ({ ...current, doctor: event.target.value }))}
            placeholder="e.g. BP rechecked at 150/95; refer to district hospital today."
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditNotes({})}>
              Discard
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Sparkles className="mr-1 h-4 w-4" /> {saving ? 'Saving…' : 'Save as authoritative'}
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <Brain className="h-4 w-4" /> AI cannot override this. The deterministic safety engine remains authoritative.
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function DefinitionList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[160px_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-slate-800">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function usePatientCases(patientId: string) {
  return useApi(() => caseTakingService.listPatientCases(patientId));
}
