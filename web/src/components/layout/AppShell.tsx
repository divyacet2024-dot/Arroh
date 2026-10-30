import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  HeartPulse,
  LayoutDashboard,
  Users,
  Activity,
  Mic,
  Siren,
  Video,
  Package,
  CloudUpload,
  Menu,
  MapPin,
  X,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { ConnectivityBanner } from '../ConnectivityBanner';
import { SyncStatusIndicator } from '../SyncStatusIndicator';
import { useI18n, LANGUAGE_CODES, LANGUAGE_LABELS } from '../../i18n';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/patients', label: 'Patients', icon: Users },
  { to: '/triage', label: 'AI Triage', icon: Activity },
  { to: '/voice', label: 'Voice Assistant', icon: Mic },
  { to: '/emergency', label: 'Emergency', icon: Siren },
  { to: '/find-care', label: 'Find Care', icon: MapPin },
  { to: '/teleconsult', label: 'Tele-Consult', icon: Video },
  { to: '/inventory', label: 'PHC Inventory', icon: Package },
  { to: '/sync', label: 'Offline Sync', icon: CloudUpload },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
        <HeartPulse className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <p className="font-semibold tracking-tight text-slate-900">MEDORA</p>
        <p className="text-xs text-slate-500">Smarter Care. Healthier Futures.</p>
      </div>
    </div>
  );
}

function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();
  return (
    <label className="block text-xs text-slate-500">
      <span className="mb-1 block font-medium">Language</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as (typeof LANGUAGE_CODES)[number])}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        aria-label="Interface and voice language"
      >
        {LANGUAGE_CODES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 px-5 py-5">
        <BrandMark />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-3 border-t border-slate-100 px-5 py-4">
        {user && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              Sign out
            </button>
          </div>
        )}
        <ConnectivityBanner />
        <SyncStatusIndicator />
        <LanguageSwitcher />
      </div>
    </div>
  );
}

/** Responsive shell: fixed sidebar on desktop, drawer on mobile, top bar on mobile. */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <BrandMark />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
            <MedicalDisclaimer />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Non-clinical safety note shown on every surface. */
function MedicalDisclaimer() {
  const { t } = useI18n();
  return (
    <div className="mt-8 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
      {t('medical.disclaimer')}
    </div>
  );
}
