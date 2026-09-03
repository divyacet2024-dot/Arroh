import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';
import { describeError } from '../lib/format';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

/**
 * Friendly error surface with an expandable technical detail. Never shows raw
 * stack traces by default — a "technical details" disclosure exposes them.
 */
export function ErrorState({ error, onRetry, title = 'Could not load this' }: ErrorStateProps) {
  const { friendly, technical } = describeError(error);
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-100 bg-red-50/60 px-6 py-10 text-center">
      <span className="rounded-full bg-red-100 p-3 text-priority-red">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{friendly}</p>
        <details className="mt-3 text-left">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
            Technical details
          </summary>
          <p className="mt-1 break-words rounded bg-slate-100 px-3 py-2 font-mono text-xs text-slate-600">
            {technical}
          </p>
        </details>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
