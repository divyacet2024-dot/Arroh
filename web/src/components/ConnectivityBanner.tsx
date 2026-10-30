/**
 * ConnectivityBanner — probe-aware online/offline indicator.
 *
 * Previously relied on navigator.onLine only. Now reads from
 * useConnectivity() which reflects the real backend probe result.
 *
 * States displayed:
 *   ONLINE            — backend /health responded 200
 *   OFFLINE           — probe failed (captive portal, backend down, no network)
 *   CHECKING          — first probe in-flight (brief transient)
 *
 * The banner is compact and non-intrusive in the sidebar (doctor portal)
 * or inline in the patient portal.
 */

import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useConnectivity } from '../lib/offline/connectivity';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';

interface ConnectivityBannerProps {
  /** Show a brief "Checking…" state on initial probe. Default: false. */
  showProbing?: boolean;
  className?: string;
}

export function ConnectivityBanner({
  showProbing = false,
  className,
}: ConnectivityBannerProps = {}) {
  const { online, probing } = useConnectivity();
  const { t } = useI18n();

  if (probing && showProbing) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold',
          'bg-slate-100 text-slate-500',
          className,
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>Checking…</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold',
        online
          ? 'bg-green-50 text-emerald-700'
          : 'bg-amber-50 text-amber-700',
        className,
      )}
    >
      {online ? (
        <>
          <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('status.online')}</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('status.offline')}</span>
        </>
      )}
      <span className="font-normal text-slate-500 ml-1">
        · {t('status.fieldMode')}
      </span>
    </div>
  );
}
