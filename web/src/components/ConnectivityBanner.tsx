import { Wifi, WifiOff } from 'lucide-react';
import { useConnectivity } from '../lib/offline/connectivity';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';

/**
 * Always-visible ONLINE / OFFLINE indicator. Driven by real network events,
 * never faked. When offline, the field-work surfaces (triage, voice,
 * emergency) remain reachable because they use the network-free rule layer.
 */
export function ConnectivityBanner() {
  const { online } = useConnectivity();
  const { t } = useI18n();

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold',
        online
          ? 'bg-green-50 text-priority-green'
          : 'bg-amber-50 text-priority-amber',
      )}
    >
      {online ? (
        <>
          <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          {t('status.online')}
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          {t('status.offline')}
        </>
      )}
      <span className="font-normal text-slate-500">· {t('status.fieldMode')}</span>
    </div>
  );
}
