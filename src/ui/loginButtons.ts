/**
 * Sign-in buttons (progression step 2): one per provider the game server has
 * set up ("Google로 로그인", "Discord로 로그인"), plus a test login on a local
 * server. Shared by the multiplayer page, the service record and the main menu.
 */
import { t, type MessageKey } from '@/i18n';
import { uiSound } from '@/audio/uiSounds';
import { accountConfig, devSignIn, signIn, type Provider } from '@/net/account';
import './progress.css';

/** Fills `parent` with the buttons once the server says which sign-ins it has; `done` after signing in. */
export function loginButtons(parent: HTMLElement, done: () => void, note?: (text: string) => void): void {
  const row = document.createElement('div');
  row.className = 'login-btns';
  parent.appendChild(row);
  const wait = document.createElement('span');
  wait.className = 'ds-dim';
  wait.textContent = t('acct.checking');
  row.appendChild(wait);
  void accountConfig().then((cfg) => {
    wait.remove();
    if (!cfg || (!cfg.providers.length && !cfg.devLogin)) {
      const none = document.createElement('span');
      none.className = 'ds-dim';
      none.textContent = t(cfg ? 'acct.noProviders' : 'acct.noServer');
      row.appendChild(none);
      return;
    }
    const add = (label: string, go: () => Promise<boolean>) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ds-btn primary';
      b.textContent = label;
      b.addEventListener('pointerenter', () => uiSound('hover'));
      b.addEventListener('click', () => {
        uiSound('select');
        // The popup opens inside this click (browsers block it later).
        void go().then((ok) => {
          if (ok) done();
          else note?.(t('acct.failed'));
        });
      });
      row.appendChild(b);
    };
    for (const p of cfg.providers) add(t(`acct.with.${p}` as MessageKey), () => signIn(p as Provider));
    if (cfg.devLogin) add(t('acct.dev'), devSignIn);
  });
}
