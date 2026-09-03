import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, Phone, CreditCard, CheckCircle2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getPatient, getPatientTimeline } from '../services/patients';
import { ErrorState } from '../components/ErrorState';
import { TriageBadge } from '../components/TriageBadge';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/PageHeader';
import { formatDate, formatDateTime, ageFromBirthDate, humanize } from '../lib/format';
import type { TriageStatus } from '../types';

export function PatientDetail() {
  const { id = '' } = useParams();

  const patientApi = useApi(() => getPatient(id));
  const timelineApi = useApi(() => getPatientTimeline(id));

  const { data: patient, loading, error, reload } = patientApi;

  if (error) {
    return <ErrorState error={error} onRetry={reload} title="Could not load patient" />;
  }

  if (loading || !patient) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  const age = ageFromBirthDate(patient.birth_date);

  return (
    <div className="space-y-6">
      <Link
        to="/patients"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to patients
      </Link>

      <PageHeader title={patient.name} description={`Patient record · ${formatDate(patient.created_at)}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Risk assessment">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Current triage priority</p>
                <div className="mt-1">
                  <TriageBadge status={patient.triage_status as TriageStatus} />
                </div>
              </div>
              {patient.is_synced_offline ? (
                <Badge tone="amber">Queued offline</Badge>
              ) : (
                <Badge tone="green">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Synced
                </Badge>
              )}
            </div>
          </Card>

          <Card title="Recent activity" subtitle="Longitudinal patient timeline">
            <Timeline loading={timelineApi.loading} error={timelineApi.error} events={timelineApi.data?.events ?? []} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Demographics">
            <dl className="space-y-3 text-sm">
              <DetailRow icon={Calendar} label="Birth date" value={`${formatDate(patient.birth_date)} · ${age !== null ? `${age} y` : ''}`} />
              <DetailRow icon={CreditCard} label="ABHA ID" value={patient.abha_id || '—'} mono />
              <DetailRow icon={Phone} label="Phone" value={patient.phone_number || '—'} />
              <DetailRow icon={MapPin} label="Village" value={patient.village || '—'} />
              <DetailRow icon={MapPin} label="District" value={patient.district} />
              <DetailRow icon={MapPin} label="State" value={patient.state} />
              <DetailRow icon={CreditCard} label="PHC" value={patient.phc_id || '—'} />
            </dl>
          </Card>

          <Card title="Actions">
            <div className="space-y-2">
              <Link to={`/triage?patient_id=${patient.id}`} className="block">
                <Button variant="outline" size="sm" className="w-full">
                  Run AI triage
                </Button>
              </Link>
              <Link to={`/voice?patient_id=${patient.id}`} className="block">
                <Button variant="outline" size="sm" className="w-full">
                  Voice intake
                </Button>
              </Link>
              <Link to={`/teleconsult?patient_id=${patient.id}`} className="block">
                <Button variant="outline" size="sm" className="w-full">
                  Tele-consult
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-slate-400">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-slate-500">{label}</dt>
        <dd className={`break-words text-slate-800 ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
      </div>
    </div>
  );
}

function Timeline({
  loading,
  error,
  events,
}: {
  loading: boolean;
  error: unknown;
  events: { event_id: string; resource_type: string; event_type: string; occurred_at: string; summary: string }[];
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState error={error} title="Could not load timeline" />
    );
  }
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        No recorded encounters yet for this patient.
      </p>
    );
  }
  return (
    <ol className="relative space-y-5 border-l border-slate-200 pl-5">
      {events.map((event) => (
        <li key={event.event_id} className="relative">
          <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
          <p className="text-xs text-slate-500">{formatDateTime(event.occurred_at)}</p>
          <p className="mt-0.5 text-sm font-medium text-slate-900">{event.summary}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {humanize(event.resource_type)} · {humanize(event.event_type)}
          </p>
        </li>
      ))}
    </ol>
  );
}
