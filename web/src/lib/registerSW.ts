/**
 * registerSW — service worker lifecycle management for MEDORA.
 *
 * Responsibilities:
 *   1. Register /sw.js once the page has loaded (non-blocking).
 *   2. Detect when a new SW is waiting and notify the app so it can
 *      show an "Update available" prompt.
 *   3. Send SKIP_WAITING only after the user acknowledges — never
 *      automatically, to avoid interrupting an active sync session.
 *   4. Capture the beforeinstallprompt event so the app can show
 *      an install button at an appropriate moment.
 *
 * This module is intentionally framework-free. It is called once from
 * main.tsx after the React tree mounts.
 *
 * SAFETY:
 *   - Never calls skipWaiting() without explicit user confirmation.
 *   - Does not register a SW if the browser does not support it.
 *   - Does not throw; all errors are logged to the console only.
 */

export type SWUpdateCallback = (applyUpdate: () => void) => void;
export type SWInstallPromptCallback = (prompt: () => Promise<void>) => void;

let _registration: ServiceWorkerRegistration | null = null;

/**
 * Install the MEDORA service worker.
 *
 * @param onUpdateAvailable  Called when a new SW is waiting.
 *   Receives an `applyUpdate()` function — call it only after the
 *   user has confirmed they want to reload.
 *
 * @param onInstallAvailable Called when the browser fires
 *   beforeinstallprompt. Receives a function that triggers the
 *   native install dialog.
 */
export async function registerServiceWorker(
  onUpdateAvailable?: SWUpdateCallback,
  onInstallAvailable?: SWInstallPromptCallback,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Defer registration until after page load so it does not compete
  // with critical resources on first render.
  if (document.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
  }

  // Capture install prompt so the app can show a custom install button.
  let _deferredPrompt: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    _deferredPrompt = event as BeforeInstallPromptEvent;
    onInstallAvailable?.(() => {
      if (!_deferredPrompt) return Promise.resolve();
      return _deferredPrompt.prompt().then(() => {
        _deferredPrompt = null;
      });
    });
  });

  try {
    _registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      // updateViaCache: 'none' ensures the browser always re-fetches sw.js
      // from the network on navigation — avoids stale SW bugs.
      updateViaCache: 'none',
    });

    // Check for a waiting worker right now (e.g. page reloaded after update)
    if (_registration.waiting) {
      onUpdateAvailable?.(applyUpdate);
    }

    // Listen for future updates
    _registration.addEventListener('updatefound', () => {
      const newWorker = _registration?.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (
          newWorker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          // A new SW installed but did not yet take over — prompt the user.
          onUpdateAvailable?.(applyUpdate);
        }
      });
    });

    // When the SW activates (after skipWaiting), reload to use the new assets.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    console.info('[SW] Registered:', _registration.scope);
  } catch (err) {
    console.error('[SW] Registration failed:', err);
  }
}

/**
 * Tell the waiting service worker to skip waiting and take control.
 * The page will reload automatically via the controllerchange handler above.
 *
 * IMPORTANT: Only call this after the user has explicitly confirmed
 * they want to update. Calling it mid-sync could interrupt pending work.
 */
function applyUpdate(): void {
  if (!_registration?.waiting) return;
  _registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Force an immediate check for a new SW version. */
export async function checkForUpdate(): Promise<void> {
  try {
    await _registration?.update();
  } catch {
    // non-critical
  }
}

// Types not in lib.dom.d.ts
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
