import { ApiError } from '../services/api';
import type { TriageStatus } from '../types';

/** Format an ISO date to a regional, human-readable date (e.g. 12 Mar 1990). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Format an ISO timestamp to date + time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compute whole years from a birth date. Returns null when unparseable. */
export function ageFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** Decide the triage label + semantic colour family. Never rely on colour alone. */
export function triageMeta(status: TriageStatus): { label: string; tone: 'red' | 'amber' | 'green' } {
  switch (status) {
    case 'RED':
      return { label: 'RED — Priority', tone: 'red' };
    case 'YELLOW':
      return { label: 'YELLOW — Close follow-up', tone: 'amber' };
    default:
      return { label: 'GREEN — Routine', tone: 'green' };
  }
}

/**
 * Return a human-friendly + technical summary of any error.
 * The friendly message is safe to show everyone; technical detail is expandable.
 */
export function describeError(error: unknown): { friendly: string; technical: string } {
  if (error instanceof ApiError) {
    let technical = error.message;
    if (Array.isArray(error.details)) {
      technical = error.details
        .map((item: Record<string, unknown>) => item.msg ?? JSON.stringify(item))
        .join('; ');
    } else if (error.details !== undefined) {
      technical = typeof error.details === 'string' ? error.details : JSON.stringify(error.details);
    }
    return { friendly: error.friendly, technical };
  }
  return {
    friendly: 'Something went wrong. Please try again.',
    technical: error instanceof Error ? error.message : String(error),
  };
}

/** Simple display + unit formatting for a vital value. */
export function formatVital(value: number | string | undefined, unit?: string): string {
  if (value === undefined || value === null || value === '') return '—';
  return `${value}${unit ? ` ${unit}` : ''}`;
}

/** Humanise a snake_case / SCREAMING_SNAKE string (e.g. CRITICAL_STOCKOUT_RISK). */
export function humanize(value: string): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
