import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mic, MicOff, Send, RotateCcw, ShieldAlert, AlertCircle } from 'lucide-react';
import { voiceTriage } from '../services/voice';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { TriageBadge } from '../components/TriageBadge';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/Badge';
import { formatVital, humanize } from '../lib/format';
import { SUPPORTED_LANGUAGES } from '../lib/constants';
import type { VoiceParseResponse } from '../types';
import type { TriageStatus } from '../types';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function VoiceAssistant() {
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patient_id') ?? '';

  const [transcript, setTranscript] = useState('');
  const [language, setLanguage] = useState('en');
  const [result, setResult] = useState<VoiceParseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSpeechSupported(getSpeechRecognition() !== null);
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore: nothing to stop
      }
    };
  }, []);

  function startListening() {
    setSpeechError(null);
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setSpeechSupported(false);
      setSpeechError('Live microphone capture is not available in this browser. Type or paste the transcript instead.');
      return;
    }
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language;
    recognition.onresult = (event) => {
      const first = event.results[0]?.[0];
      if (first?.transcript) {
        const next = first.transcript.trim();
        if (next) setTranscript((current) => (current ? `${current} ${next}` : next));
      }
    };
    recognition.onerror = (event) => {
      const code = event.error;
      setSpeechError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone permission was denied. Please allow access in your browser settings, or type the transcript below.'
          : code === 'no-speech'
            ? 'No speech was detected. Try again or type the transcript below.'
            : `Microphone capture failed (${code}). You can still type the transcript below.`,
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch (cause) {
      setSpeechError(
        cause instanceof Error
          ? cause.message
          : 'Microphone could not be started. Type the transcript below instead.',
      );
      setListening(false);
    }
  }

  function stopListening() {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore: nothing to stop
    }
    setListening(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!transcript.trim()) return;
    setLoading(true);
    try {
      const parsed = await voiceTriage({
        transcript: transcript.trim(),
        language,
        abha_id: patientId || undefined,
      });
      setResult(parsed);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Voice Assistant"
        description="Decode a spoken clinical narrative into symptoms, vitals and a triage assessment."
      />

      <form onSubmit={onSubmit} className="max-w-3xl">
        <Card
          title="Voice transcript"
          subtitle="Speak into your microphone, or type / paste a transcript directly. Live capture needs microphone permission."
          actions={
            result ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setTranscript('');
                  setResult(null);
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset
              </Button>
            ) : null
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  className={
                    listening
                      ? 'relative grid h-12 w-12 place-items-center rounded-full bg-red-600 text-white'
                      : 'grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-white'
                  }
                >
                  {listening ? <MicOff className="h-5 w-5" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
                  {listening && (
                    <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-red-400/60" aria-hidden="true" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {listening ? 'Listening…' : speechSupported ? 'Live microphone available' : 'Live microphone unavailable'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {speechSupported
                      ? 'Tap to dictate. Captured text is appended below.'
                      : 'Your browser does not expose Web Speech. Use the textarea.'}
                  </p>
                </div>
              </div>
              {speechSupported ? (
                listening ? (
                  <Button type="button" variant="danger" onClick={stopListening}>
                    <MicOff className="h-4 w-4" aria-hidden="true" /> Stop
                  </Button>
                ) : (
                  <Button type="button" onClick={startListening}>
                    <Mic className="h-4 w-4" aria-hidden="true" /> Start dictation
                  </Button>
                )
              ) : null}
            </div>

            {speechError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-priority-amber" aria-hidden="true" />
                <p>{speechError}</p>
              </div>
            )}

            <label htmlFor="transcript" className="block text-sm font-medium text-slate-700">
              Transcript
            </label>
            <textarea
              id="transcript"
              rows={5}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="e.g. The patient has chest pain, shortness of breath and high fever since two days, and she is pregnant…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                options={SUPPORTED_LANGUAGES.map((language) => ({
                  value: language.code,
                  label: language.label,
                }))}
              />
              <Input label="Patient ID" value={patientId || ''} hint="Optional — accepted as ABHA ID" readOnly />
            </div>
            {patientId && (
              <p className="text-xs text-slate-500">
                Linked to patient record {patientId}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1 text-xs text-slate-500">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                AI-assisted. Not a confirmed medical diagnosis.
              </p>
              <Button type="submit" loading={loading}>
                {transcript ? <Send className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                Parse & triage
              </Button>
            </div>
          </div>
        </Card>
      </form>

      {Boolean(error) && <ErrorState error={error} onRetry={() => setError(null)} title="Voice triage failed" />}

      {result && <VoiceResult result={result} />}
    </div>
  );
}

function VoiceResult({ result }: { result: VoiceParseResponse }) {
  const { extracted_clinical_data: clinical, triage_assessment: assessment } = result;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Parsed transcript">
          <p className="text-sm italic text-slate-700">“{result.transcript}”</p>
        </Card>

        <Card title="Extracted clinical data">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Language
              </p>
              <p className="mt-1 text-sm text-slate-700">{clinical.language}</p>
            </div>
            {clinical.symptoms.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symptoms</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {clinical.symptoms.map((symptom, index) => (
                    <Badge key={index} tone="brand">
                      {humanize(symptom)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(clinical.vitals).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vitals</p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.entries(clinical.vitals).map(([key, value]) => (
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

      <div className="space-y-4">
        <Card title="Triage assessment">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-500">Risk score</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {assessment.risk_score}
                <span className="text-base font-medium text-slate-400">/100</span>
              </p>
            </div>
            <TriageBadge status={assessment.triage_level as TriageStatus} />
          </div>
        </Card>

        <Card title="Recommended actions">
          <ul className="space-y-2">
            {assessment.recommended_actions.length === 0 ? (
              <li className="text-sm text-slate-500">No immediate actions required.</li>
            ) : (
              assessment.recommended_actions.map((action, index) => (
                <li key={index} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  {action}
                </li>
              ))
            )}
          </ul>
        </Card>

        {assessment.maternal_conditions.length > 0 && (
          <Card title="Maternal markers">
            <ul className="space-y-1 text-sm text-slate-700">
              {assessment.maternal_conditions.map((condition) => (
                <li key={condition}>• {condition}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}