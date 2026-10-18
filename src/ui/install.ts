/**
 * Installing the site as an app (owner, 2026-10-18): with the web app manifest
 * (public/manifest.webmanifest) browsers that can install it fire
 * `beforeinstallprompt`; it is kept here and the main menu's "앱 설치" button
 * shows the browser's own install dialog. iPhones / iPads have no such event:
 * there the button explains Share → Add to Home Screen. Installed, the game
 * opens full screen in landscape from its icon, and the button is gone.
 * `watchInstall()` runs at start (main.ts) so the event isn't missed.
 */

/** Chrome / Edge / Samsung Internet's install event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'prompt' | 'ios' | 'none';

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((f) => f());

/** Already running as the installed app (from its icon). */
function standalone(): boolean {
  return (
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** An iPhone / iPad (iPadOS says it is a Mac, but with touch): no install event there, the share menu adds it. */
function ios(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function watchInstall(): void {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });
}

export function installState(): InstallState {
  if (installed || standalone()) return 'none';
  if (deferred) return 'prompt';
  return ios() ? 'ios' : 'none';
}

/** Called when `installState()` may have changed; returns the unsubscribe. */
export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The browser's install dialog (only once per event: the browser fires a new one if it is dismissed). */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  changed();
  return outcome === 'accepted';
}
