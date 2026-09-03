import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Send, Mic, Sparkles, AlertTriangle } from 'lucide-react';
import { caseTakingService, type CaseSession, type FollowUpQuestion } from '../services/caseTaking';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { TriageBadge } from '../components/TriageBadge';
import { PageHeader } from '../components/PageHeader';
import { CaseReview } from './CaseReview';
import { humanize } from '../lib/format';

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'kn', label: 'ಕನ್ನಡ Kannada' },
  { code: 'hi', label: 'हिन्दी Hindi' },
  { code: 'ta', label: 'தமிழ் Tamil' },
];

export function CaseTakingPage() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState('en');
  const [transcript, setTranscript] = useState('');
  const [patientId, setPatientId] = useState('');
  const [session, setSession] = useState<CaseSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!transcript.trim()) {
      setError('Enter a transcript first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await caseTakingService.startCase({
        transcript: transcript.trim(),
        language,
        patient_local_uuid: patientId || undefined,
      });
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start case');
    } finally {
      setBusy(false);
    }
  };

  const answer = async (question: FollowUpQuestion, answer: string) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const response = await caseTakingService.answerQuestion({
        session,
        question_id: question.question_id,
        answer,
      });
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record answer');
    } finally {
    setBusy(false);
    }
  };

  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const response = await caseTakingService.confirmCase({ session });
      setSession(response.case_session);
      if (response.case_session.patient_local_uuid) {
        navigate(`/case/${response.case_session.case_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm case');
    } finally {
      setBusy(false);
    }
  };

  if (session) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Active case-taking session"
          description="The session is live; you can answer the remaining safety questions before saving the case."
          actions={
            <Button variant="secondary" onClick={() => setSession(null)}>
              Start a new case
            </Button>
          }
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Card title="Conversation" subtitle="The AI assists; the deterministic safety engine decides.">
            {session.follow_up_questions.length === 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-700">
                  <Sparkles className="h-4 w-4" /> All safety questions collected.
                </div>
                <Button onClick={confirm} disabled={busy}>
                  <Send className="mr-1 h-4 w-4" /> Confirm and save
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {session.follow_up_questions.map((question) => (
                  <div key={question.question_id} className="rounded-lg border border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-800">
                      {question.prompt_translations[session.language] ?? question.prompt}
                    </div>
                    {question.safety_reason ? (
                      <div className="text-xs text-slate-500">Why: {question.safety_reason}</div>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => answer(question, 'yes')}>
                        Yes
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => answer(question, 'no')}>
                        No
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="space-y-3">
            <TriageBanner session={session} />
            <CaseReview caseSession={session} patientId={session.patient_local_uuid ?? patientId} readonly />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI-assisted case-taking"
        description="Capture a multilingual patient complaint. The AI extracts structured symptoms and asks the next safety question; the deterministic safety engine remains authoritative."
      />
      <Card title="New case" subtitle="Choose a language and either type the transcript or paste a voice transcript.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-slate-600">Language</span>
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-600">Patient ID (optional)</span>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              placeholder="server-side patient UUID"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm">
          <span className="flex items-center gap-2 text-slate-600">
            <Mic className="h-4 w-4" /> Transcript
          </span>
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            rows={5}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="e.g. ನನಗೆ ಎದೆ ನೋವು ಇದೆ ಮತ್ತು ಉಸಿರಾಡಲು ಕಷ್ಟವಾಗುತ್ತಿದೆ"
          />
        </label>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Brain className="h-4 w-4" /> The AI never overrides the deterministic safety engine.
          </div>
          <Button onClick={start} disabled={busy}>
            <Send className="mr-1 h-4 w-4" /> {busy ? 'Starting…' : 'Start case-taking'}
          </Button>
        </div>
        {error ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function TriageBanner({ session }: { session: CaseSession }) {
  const level = (session.triage_result.triage_level as string) ?? 'UNKNOWN';
  const actions = Array.isArray(session.triage_result.recommended_actions)
    ? (session.triage_result.recommended_actions as string[])
    : [];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <TriageBadge status={level as 'RED' | 'YELLOW' | 'GREEN'} />
        <span className="text-sm text-slate-600">Risk score: {String(session.triage_result.risk_score ?? 'n/a')}</span>
        {session.emergency_intent_detected ? <Badge tone="red">Emergency intent</Badge> : null}
      </div>
      {actions.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 text-xs text-slate-500">{humanize(session.language)} session.</div>
    </Card>
  );
}
