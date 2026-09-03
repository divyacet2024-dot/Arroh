import { Link } from 'react-router-dom';
import { Users, Siren, Video, Package, CloudUpload, Activity, ArrowRight } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getPatients } from '../services/patients';
import { StatCard } from '../components/StatCard';
import { ErrorState } from '../components/ErrorState';
import { TriageBadge } from '../components/TriageBadge';
import { formatDate } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DEFAULT_PHC_ID } from '../lib/constants';

export function Dashboard() {
  const { data: patients, loading, error, reload } = useApi(() =>
    getPatients({ phc_id: DEFAULT_PHC_ID }),
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={reload}
        title="Could not load dashboard"
      />
    );
  }

  const total = patients?.length ?? 0;
  const red = patients?.filter((p) => p.triage_status === 'RED').length ?? 0;
  const yellow = patients?.filter((p) => p.triage_status === 'YELLOW').length ?? 0;
  const green = patients?.filter((p) => p.triage_status === 'GREEN').length ?? 0;
  const syncedOffline = patients?.filter((p) => p.is_synced_offline).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live overview for PHC {DEFAULT_PHC_ID}. Patient counts are real backend records.
          </p>
        </div>
        <Link to="/emergency">
          <Button variant="primary">
            <Siren className="h-4 w-4" aria-hidden="true" /> Start emergency session
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total patients" value={total} icon={Users} hint="Under this PHC" />
        <StatCard
          label="Priority (RED)"
          value={red}
          icon={Activity}
          tone="red"
          hint="Needs urgent care"
        />
        <StatCard label="Close follow-up (YELLOW)" value={yellow} icon={Activity} tone="amber" />
        <StatCard label="Routine (GREEN)" value={green} icon={Activity} tone="green" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="Recent patients"
            subtitle="Latest records registered at this PHC"
            actions={
              <Link to="/patients">
                <Button variant="ghost" size="sm">
                  View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
            }
          >
            {total === 0 ? (
              <NoPatients />
            ) : (
              <ul className="divide-y divide-slate-100">
                {patients!.slice(0, 5).map((patient) => (
                  <li key={patient.id} className="py-3">
                    <Link
                      to={`/patients/${patient.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1 -mx-2 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                          {patient.name.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-medium text-slate-900">{patient.name}</p>
                          <p className="text-xs text-slate-500">
                            {patient.village || patient.district} · {formatDate(patient.birth_date)}
                          </p>
                        </div>
                      </div>
                      <TriageBadge status={patient.triage_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <QuickActions />
          <Card title="Offline readiness" subtitle={`${syncedOffline} of ${total} records are queued for offline sync`}>
            <div className="flex items-center gap-3">
              <CloudUpload className="h-5 w-5 text-brand-600" aria-hidden="true" />
              <p className="text-sm text-slate-500">
                Records sync from the field to this backend. Sync status is captured per patient.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function NoPatients() {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-slate-500">
        No patients registered under this PHC yet.
      </p>
      <Link to="/patients/new" className="mt-3 inline-block">
        <Button variant="outline" size="sm">
          Register a patient
        </Button>
      </Link>
    </div>
  );
}

function QuickActions() {
  const actions = [
    { to: '/triage', label: 'Run AI triage', icon: Activity },
    { to: '/voice', label: 'Voice intake', icon: Siren },
    { to: '/teleconsult', label: 'Join consult queue', icon: Video },
    { to: '/inventory', label: 'Check inventory', icon: Package },
    { to: '/sync', label: 'Sync offline batch', icon: CloudUpload },
  ];
  return (
    <Card title="Quick actions">
      <div className="grid grid-cols-1 gap-2">
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <action.icon className="h-4 w-4 text-brand-600" aria-hidden="true" />
            {action.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-7 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
    </div>
  );
}
