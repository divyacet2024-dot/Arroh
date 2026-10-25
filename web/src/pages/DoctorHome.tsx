/**
 * DoctorHome — role-specific dashboard for authenticated doctors.
 *
 * Reuses existing backend: GET /api/v1/patients/ for the patient queue.
 * Shows: high-priority queue, quick stats, AI triage summary, nav to all tools.
 */

import { Link } from 'react-router-dom';
import {
  Users, Activity, Siren, Video, Package,
  CloudUpload, ArrowRight, AlertTriangle,
  Clock, CheckCircle2, Stethoscope,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getPatients } from '../services/patients';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { useConnectivity } from '../lib/offline/connectivity';
import { TriageBadge } from '../components/TriageBadge';
import { AIAvatar } from '../components/AIAvatar';
import { formatDate } from '../lib/format';
import { DEFAULT_PHC_ID } from '../lib/constants';
import { cn } from '../lib/cn';

export function DoctorHome() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { online } = useConnectivity();

  const { data: patients, loading, error, reload } = useApi(() =>
    getPatients({ phc_id: DEFAULT_PHC_ID }),
  );

  const redCases    = patients?.filter((p) => p.triage_status === 'RED')    ?? [];
  const yellowCases = patients?.filter((p) => p.triage_status === 'YELLOW') ?? [];
  const greenCases  = patients?.filter((p) => p.triage_status === 'GREEN')  ?? [];
  const total       = patients?.length ?? 0;
  const hasError    = error !== null;

  return (
    <div className="doctor-home-root">
      {/* Header */}
      <header className="doctor-home-header">
        <div className="flex items-center gap-3">
          <div className="doctor-home-logo">
            <Stethoscope className="h-5 w-5 text-brand-600" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">
              {user?.name ? `Dr. ${user.name.split(' ').pop()}` : 'Doctor'}
            </p>
            <p className="text-xs text-slate-500">PHC {DEFAULT_PHC_ID} · {online ? t('status.online') : t('status.offline')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="doctor-home-logout"
        >
          Sign out
        </button>
      </header>

      {/* Priority banner — RED cases */}
      {redCases.length > 0 && (
        <div className="doctor-priority-banner" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            <strong>{redCases.length}</strong>{' '}
            {redCases.length === 1 ? 'patient requires' : 'patients require'} urgent attention
          </p>
          <Link to="/patients" className="ml-auto text-sm font-semibold underline">
            View
          </Link>
        </div>
      )}

      {/* Stats row */}
      <div className="doctor-stats-row">
        <StatChip value={total}             label="Total"   icon={Users}         tone="slate"   />
        <StatChip value={redCases.length}   label="RED"     icon={AlertTriangle} tone="red"     />
        <StatChip value={yellowCases.length}label="YELLOW"  icon={Clock}         tone="amber"   />
        <StatChip value={greenCases.length} label="GREEN"   icon={CheckCircle2}  tone="green"   />
      </div>

      {/* AI assistant card */}
      <div className="doctor-ai-card">
        <AIAvatar state="IDLE" size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">MEDORA AI Assistant</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {redCases.length > 0
              ? `${redCases.length} priority case${redCases.length > 1 ? 's' : ''} need review.`
              : 'All cases are stable. AI summary available.'}
          </p>
        </div>
        <Link
          to="/triage"
          className="doctor-ai-btn"
          aria-label="Open AI triage"
        >
          <Activity className="h-4 w-4" aria-hidden="true" />
          Triage
        </Link>
      </div>

      {/* Patient queue */}
      <section className="doctor-queue-section">
        <div className="doctor-section-header">
          <h2 className="doctor-section-title">{t('doctor.queue')}</h2>
          <Link to="/patients" className="doctor-see-all">
            View all <ArrowRight className="h-3.5 w-3.5 inline" aria-hidden="true" />
          </Link>
        </div>

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {hasError && (
          <div className="doctor-queue-error">
            <p className="text-sm text-slate-500">{t('error.server')}</p>
            <button type="button" onClick={reload} className="text-sm text-brand-600 font-medium">
              {t('common.tryAgain')}
            </button>
          </div>
        )}

        {!loading && !hasError && (
          <>
            {total === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">{t('doctor.queue.empty')}</p>
            ) : (
              <ul className="doctor-queue-list">
                {/* Show RED first, then YELLOW, then GREEN */}
                {[...redCases, ...yellowCases, ...greenCases].slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/patients/${p.id}`}
                      className="doctor-queue-item"
                    >
                      <span className={cn(
                        'doctor-queue-avatar',
                        p.triage_status === 'RED'    && 'bg-red-100 text-red-700',
                        p.triage_status === 'YELLOW' && 'bg-amber-100 text-amber-700',
                        p.triage_status === 'GREEN'  && 'bg-emerald-100 text-emerald-700',
                      )}>
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                        <p className="text-xs text-slate-500">
                          {p.village ?? p.district} · {formatDate(p.birth_date)}
                        </p>
                      </div>
                      <TriageBadge status={p.triage_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Quick-access nav */}
      <nav className="doctor-quick-nav" aria-label="Quick actions">
        <h2 className="doctor-section-title mb-3">Quick access</h2>
        <div className="doctor-quick-grid">
          {[
            { to: '/voice',       icon: Activity,     label: 'Voice intake'  },
            { to: '/emergency',   icon: Siren,        label: 'Emergency'     },
            { to: '/teleconsult', icon: Video,        label: 'Tele-consult'  },
            { to: '/inventory',   icon: Package,      label: 'Inventory'     },
            { to: '/sync',        icon: CloudUpload,  label: 'Sync'          },
            { to: '/case-taking', icon: Stethoscope,  label: 'Case taking'   },
          ].map((item) => (
            <Link key={item.to} to={item.to} className="doctor-quick-item">
              <item.icon className="h-5 w-5 text-brand-600" aria-hidden="true" />
              <span className="text-xs font-medium text-slate-700">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* Disclaimer */}
      <p className="doctor-disclaimer">{t('medical.disclaimer')}</p>
    </div>
  );
}

// ── Stat chip ────────────────────────────────────────────────────────────────

interface StatChipProps {
  value: number;
  label: string;
  icon: React.ElementType;
  tone: 'slate' | 'red' | 'amber' | 'green';
}

const TONE_CLASSES: Record<string, string> = {
  slate: 'bg-slate-50  text-slate-600  border-slate-200',
  red:   'bg-red-50    text-red-600    border-red-200',
  amber: 'bg-amber-50  text-amber-600  border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function StatChip({ value, label, icon: Icon, tone }: StatChipProps) {
  return (
    <div className={cn('doctor-stat-chip', TONE_CLASSES[tone])}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      </div>
    </div>
  );
}
