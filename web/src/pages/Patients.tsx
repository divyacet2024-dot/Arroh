import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, Users } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getPatients } from '../services/patients';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { TriageBadge } from '../components/TriageBadge';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { formatDate, ageFromBirthDate } from '../lib/format';
import { DEFAULT_PHC_ID } from '../lib/constants';
import type { TriageStatus } from '../types';

export function Patients() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const statusFilter = searchParams.get('status') ?? '';

  const { data: patients, loading, error, reload } = useApi(() =>
    getPatients({ phc_id: DEFAULT_PHC_ID }),
  );

  const filtered = useMemo(() => {
    if (!patients) return [];
    const needle = query.trim().toLowerCase();
    return patients.filter((patient) => {
      const matchesStatus = statusFilter ? patient.triage_status === statusFilter : true;
      const matchesQuery =
        !needle ||
        patient.name.toLowerCase().includes(needle) ||
        (patient.abha_id ?? '').toLowerCase().includes(needle) ||
        (patient.village ?? '').toLowerCase().includes(needle) ||
        (patient.phc_id ?? '').toLowerCase().includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [patients, query, statusFilter]);

  if (error) {
    return <ErrorState error={error} onRetry={reload} title="Could not load patients" />;
  }

  function setStatus(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="Patient records registered at this PHC, filtered by clinical priority."
        actions={
          <Link to="/patients/new">
            <Button>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Register patient
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <Input
            label="Search"
            placeholder="Search by name, ABHA ID, village…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
          />
        </div>
        <div className="sm:w-56">
          <Select
            label="Priority"
            value={statusFilter}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: '', label: 'All priorities' },
              { value: 'RED', label: 'RED (Priority)' },
              { value: 'YELLOW', label: 'YELLOW (Close follow-up)' },
              { value: 'GREEN', label: 'GREEN (Routine)' },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No patients match"
          description={
            patients?.length
              ? 'Try adjusting the search or priority filter.'
              : 'Register the first patient in this PHC to see them here.'
          }
          action={
            !patients?.length && (
              <Link to="/patients/new">
                <Button variant="outline" size="sm">
                  Register patient
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Village</th>
                  <th className="px-4 py-3">ABHA ID</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((patient) => {
                  const age = ageFromBirthDate(patient.birth_date);
                  return (
                    <tr key={patient.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/patients/${patient.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {patient.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{age !== null ? `${age} y` : '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{patient.village || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {patient.abha_id || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <TriageBadge status={patient.triage_status as TriageStatus} />
                      </td>
                      <td className="px-4 py-3">
                        {patient.is_synced_offline ? (
                          <span className="text-xs text-slate-500">Queued</span>
                        ) : (
                          <span className="text-xs font-medium text-priority-green">Synced</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Showing {filtered.length} of {patients?.length ?? 0} patients · {formatDate(new Date().toISOString())}
      </p>
    </div>
  );
}
