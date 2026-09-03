import { useState, type FormEvent } from 'react';
import {
  CloudUpload,
  Plus,
  Trash2,
  CheckCircle2,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  Clock,
  History,
} from 'lucide-react';
import { useSync } from '../lib/offline/SyncContext';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/EmptyState';
import { formatDateTime } from '../lib/format';
import { cn } from '../lib/cn';
import type { SyncRecord, TriageStatus, Gender } from '../types';
import type { SyncItemStatus, SyncQueueItem } from '../lib/offline/syncQueue';

interface DraftRecord {
  name: string;
  gender: Gender;
  birth_date: string;
  abha_id: string;
  phone_number: string;
  abha_address: string;
  district: string;
  state: string;
  spo2: string;
  heart_rate: string;
  temperature: string;
  triage_status: TriageStatus;
}

const emptyDraft: DraftRecord = {
  name: '',
  gender: 'female',
  birth_date: '',
  abha_id: '',
  phone_number: '',
  abha_address: '',
  district: '',
  state: '',
  spo2: '',
  heart_rate: '',
  temperature: '',
  triage_status: 'GREEN',
};

export function Sync() {
  const {
    online,
    pendingCount,
    items,
    status,
    lastSyncedAt,
    errorMessage,
    workerId,
    phcId,
    setWorkerId,
    setPhcId,
    enqueue,
    flush,
    clearSynced,
    discardSyncedItem,
  } = useSync();

  const [draft, setDraft] = useState<DraftRecord>(emptyDraft);

  function update<Key extends keyof DraftRecord>(key: Key, value: DraftRecord[Key]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function addRecord(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.birth_date || !draft.district.trim() || !draft.state.trim()) return;
    if (!draft.abha_id.trim() && !draft.phone_number.trim()) return;

    const vitals: Record<string, number | string> = {};
    if (draft.spo2.trim()) vitals.spo2 = Number(draft.spo2);
    if (draft.heart_rate.trim()) vitals.heart_rate = Number(draft.heart_rate);
    if (draft.temperature.trim()) vitals.temperature = Number(draft.temperature);

    const record: SyncRecord = {
      local_client_uuid:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      local_timestamp: new Date().toISOString(),
      name: draft.name.trim(),
      gender: draft.gender,
      birth_date: draft.birth_date,
      abha_id: draft.abha_id.trim() || null,
      phone_number: draft.phone_number.trim() || null,
      abha_address: draft.abha_address.trim() || null,
      district: draft.district.trim(),
      state: draft.state.trim(),
      vitals,
      symptoms: [],
      triage_status: draft.triage_status,
    };

    enqueue(record);
    setDraft(emptyDraft);
  }

  const failedItems = items.filter((item) => item.status === 'failed');
  const syncedItems = items.filter((item) => item.status === 'synced');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offline Sync"
        description="Reconcile field observations recorded without network. Records are only cleared after the backend acknowledges them."
      />

      {/* Connection + queue status */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusPill
          icon={online ? Wifi : WifiOff}
          label="Connection"
          value={online ? 'ONLINE' : 'OFFLINE'}
          tone={online ? 'green' : 'amber'}
        />
        <StatusPill
          icon={Clock}
          label="Pending"
          value={`${pendingCount}`}
          tone={pendingCount > 0 ? 'amber' : 'green'}
        />
        <StatusPill
          icon={status === 'syncing' ? RefreshCw : CheckCircle2}
          label="Status"
          value={status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Error' : pendingCount === 0 ? 'Synced' : 'Awaiting'}
          tone={status === 'error' ? 'red' : 'green'}
          spin={status === 'syncing'}
        />
        <StatusPill icon={History} label="Last synced" value={lastSyncedAt ? formatDateTime(lastSyncedAt) : '—'} tone="neutral" />
      </div>

      {status === 'error' && errorMessage && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-priority-red" aria-hidden="true" />
            <p className="text-sm text-red-800">
              {errorMessage}
              {failedItems.length > 0 && ` ${failedItems.length} record(s) retained and still pending.`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void flush()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Add offline record" subtitle="Queue a field observation for later sync">
            <form onSubmit={addRecord} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Name" value={draft.name} onChange={(event) => update('name', event.target.value)} required />
                <Select
                  label="Gender"
                  value={draft.gender}
                  onChange={(event) => update('gender', event.target.value as Gender)}
                  options={[
                    { value: 'female', label: 'Female' },
                    { value: 'male', label: 'Male' },
                    { value: 'other', label: 'Other' },
                    { value: 'unknown', label: 'Unknown' },
                  ]}
                />
                <Input label="Birth date" type="date" value={draft.birth_date} onChange={(event) => update('birth_date', event.target.value)} required />
                <Input
                  label="ABHA ID"
                  value={draft.abha_id}
                  onChange={(event) => update('abha_id', event.target.value.replace(/\D/g, ''))}
                  maxLength={14}
                  hint="14 digits, or a 10-digit phone"
                />
                <Input
                  label="Phone number"
                  value={draft.phone_number}
                  onChange={(event) => update('phone_number', event.target.value.replace(/\D/g, ''))}
                  maxLength={10}
                />
                <Input
                  label="ABHA address"
                  value={draft.abha_address}
                  onChange={(event) => update('abha_address', event.target.value)}
                  placeholder="Optional"
                />
                <Input label="District *" value={draft.district} onChange={(event) => update('district', event.target.value)} required />
                <Input label="State *" value={draft.state} onChange={(event) => update('state', event.target.value)} required />
                <Input label="SpO2 %" value={draft.spo2} onChange={(event) => update('spo2', event.target.value)} inputMode="decimal" />
                <Input label="Heart rate" value={draft.heart_rate} onChange={(event) => update('heart_rate', event.target.value)} inputMode="decimal" />
                <Input label="Temperature °C" value={draft.temperature} onChange={(event) => update('temperature', event.target.value)} inputMode="decimal" />
                <Select
                  label="Triage priority"
                  value={draft.triage_status}
                  onChange={(event) => update('triage_status', event.target.value as TriageStatus)}
                  options={[
                    { value: 'GREEN', label: 'GREEN (Routine)' },
                    { value: 'YELLOW', label: 'YELLOW (Close follow-up)' },
                    { value: 'RED', label: 'RED (Priority)' },
                  ]}
                />
              </div>
              <Button type="submit" variant="secondary">
                <Plus className="h-4 w-4" aria-hidden="true" /> Queue record
              </Button>
            </form>
          </Card>

          <Card
            title={`Pending records (${pendingCount})`}
            subtitle="Synced records are shown until cleared; failed records are never discarded."
            actions={
              syncedItems.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={clearSynced}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear synced
                </Button>
              ) : undefined
            }
          >
            <QueueList items={items} onDiscardSynced={discardSyncedItem} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Sync queue" subtitle="Send all pending records to the backend">
            <div className="space-y-3">
              <Input label="Worker ID" value={workerId} onChange={(event) => setWorkerId(event.target.value)} placeholder="e.g. ASHA-DEMO-01" />
              <Input label="PHC ID" value={phcId} onChange={(event) => setPhcId(event.target.value)} />
              <Button
                type="button"
                loading={status === 'syncing'}
                disabled={!online || pendingCount === 0}
                onClick={() => void flush()}
                className="w-full"
              >
                <CloudUpload className="h-4 w-4" aria-hidden="true" /> Sync {pendingCount} record{pendingCount === 1 ? '' : 's'}
              </Button>
              {!online && (
                <p className="text-xs text-slate-500">
                  You are offline. The queue will sync automatically once the connection returns.
                </p>
              )}
              {online && pendingCount === 0 && (
                <p className="text-xs text-slate-500">Nothing to sync right now.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const toneClasses: Record<'green' | 'amber' | 'red' | 'neutral', string> = {
  green: 'bg-green-50 text-priority-green',
  amber: 'bg-amber-50 text-priority-amber',
  red: 'bg-red-50 text-priority-red',
  neutral: 'bg-slate-100 text-slate-600',
};

function StatusPill({
  icon: Icon,
  label,
  value,
  tone,
  spin,
}: {
  icon: typeof Wifi;
  label: string;
  value: string;
  tone: 'green' | 'amber' | 'red' | 'neutral';
  spin?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={cn('rounded-md p-1.5', toneClasses[tone])}>
          <Icon className={cn('h-4 w-4', spin && 'animate-spin')} aria-hidden="true" />
        </span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-2 truncate text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

const itemStatusTone: Record<SyncItemStatus, 'green' | 'amber' | 'red' | 'neutral'> = {
  synced: 'green',
  pending: 'amber',
  syncing: 'amber',
  failed: 'red',
};

function QueueList({
  items,
  onDiscardSynced,
}: {
  items: SyncQueueItem[];
  onDiscardSynced: (uuid: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState icon={CloudUpload} title="No records queued" description="Add an offline record above to build a sync batch." />
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.local_client_uuid} className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
              {item.payload.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{item.payload.name}</p>
              <p className="truncate text-xs text-slate-500">
                {item.payload.abha_id || item.payload.phone_number || item.payload.abha_address} ·{' '}
                {item.payload.district}
              </p>
              {item.lastError && (
                <p className="mt-1 max-w-[240px] truncate text-xs text-priority-red" title={item.lastError}>
                  {item.lastError}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={itemStatusTone[item.status]}>{item.status}</Badge>
            {item.status === 'synced' && (
              <button
                type="button"
                onClick={() => onDiscardSynced(item.local_client_uuid)}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-priority-red"
                aria-label={`Remove acknowledged record for ${item.payload.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
