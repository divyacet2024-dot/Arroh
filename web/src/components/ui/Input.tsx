import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
}

/** Labelled, accessible text input with optional hint + inline error text. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftIcon, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm',
            'placeholder:text-slate-400 focus:outline-none focus:ring-2',
            Boolean(leftIcon) && 'pl-10',
            error
              ? 'border-priority-red focus:border-red-500 focus:ring-red-200'
              : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
            className,
          )}
          {...props}
        />
      </div>
      {hint && !error && (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="mt-1 text-xs font-medium text-priority-red">
          {error}
        </p>
      )}
    </div>
  );
});
