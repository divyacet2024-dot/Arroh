/**
 * Bounded retry policy shared by offline submission flows.
 *
 * Attempt numbering is one-based: attempt 1 waits around 2 seconds, then 4,
 * 8, 16 and at most 30 seconds for attempt 5 and all later attempts. Jitter
 * reduces retry storms, but the final delay is always capped at 30 seconds.
 */

export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 30_000;
export const JITTER_FACTOR = 0.25;

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const base = Math.min(BASE_DELAY_MS * 2 ** (normalizedAttempt - 1), MAX_DELAY_MS);
  const jitter = base * JITTER_FACTOR * (random() * 2 - 1);
  return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(base + jitter)));
}
