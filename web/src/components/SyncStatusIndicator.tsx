import { Link } from 'react-router-dom';
import { CheckCircle2, RefreshCw, AlertTriangle, Clock, type LucideIcon } from 'lucide-react';
import { useSync } from '../lib/offline/SyncContext';
import { cn } from '../lib/cn';

/**
 * Compact, always-visible sync state chip. Clicking it opens the Sync page.
 * "Synced" is only shown when the backend has acknowledged every record — it is
 * never claimed for queued or failed work.
 */
export function SyncStatusIndicator() {
  const { status, pendingCount, errorMessage } = useSync();

  let label: string;
  let Icon: LucideIcon;
  let tone: string;
  let spinning = false;

  if (status === 'syncing') {
    label = 'Syncing…';
    Icon = RefreshCw;
    tone = 'bg-brand-50 text-brand-700';
    spinning = true;
  } else if (status === 'error') {
    label = 'Sync failed — retry';
    Icon = AlertTriangle;
    tone = 'bg-red-50 text-priority-red';
  } else if (pendingCount > 0) {
    label = `${pendingCount} record${pendingCount === 1 ? '' : 's'} pending`;
    Icon = Clock;
    tone = 'bg-amber-50 text-priority-amber';
  } else {
    label = 'Synced';
    Icon = CheckCircle2;
    tone = 'bg-green-50 text-priority-green';
  }

  return (
    <Link
      to="/sync"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:opacity-90',
        tone,
      )}
      aria-label={`Sync status: ${label}${errorMessage ? `. ${errorMessage}` : ''}`}
      title={errorMessage || label}
    >
      <Icon className={cn('h-4 w-4', spinning && 'animate-spin')} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
