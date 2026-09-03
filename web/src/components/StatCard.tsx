import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  hint?: string;
  tone?: 'brand' | 'red' | 'amber' | 'green';
}

const toneIcon: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600',
  red: 'bg-red-50 text-priority-red',
  amber: 'bg-amber-50 text-priority-amber',
  green: 'bg-green-50 text-priority-green',
};

/** Compact KPI card for the dashboard. Value is always paired with a label. */
export function StatCard({ label, value, icon: Icon, hint, tone = 'brand' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn('rounded-lg p-2.5', toneIcon[tone])}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}
