import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'red' | 'amber' | 'green' | 'neutral' | 'brand';

const toneClasses: Record<Tone, string> = {
  red: 'bg-red-50 text-priority-red ring-red-200',
  amber: 'bg-amber-50 text-priority-amber ring-amber-200',
  green: 'bg-green-50 text-priority-green ring-green-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/** Small status pill. Pairs tone with always-visible text (not colour alone). */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
