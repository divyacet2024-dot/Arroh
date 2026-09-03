import { Badge } from './ui/Badge';
import { triageMeta } from '../lib/format';
import type { TriageStatus } from '../types';

/** A triage status pill that always carries an explicit text label (never colour alone). */
export function TriageBadge({ status }: { status: TriageStatus }) {
  const meta = triageMeta(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
