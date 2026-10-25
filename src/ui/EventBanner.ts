import { t, type MessageKey } from '@/i18n';
import { EVENT_MULT } from '@/net/lobbyProtocol';
import { eventsNow } from '@/net/events';
import { icon } from './icons';
import './eventBanner.css';

/**
 * "XP 2배 이벤트 진행 중" over the main menu and the multiplayer pages while
 * the staff run a double event (owner, 2026-10-25): which kinds, and how long
 * is left. Nothing when none is on.
 */
export function eventBanner(parent: HTMLElement): HTMLElement | null {
  const on = eventsNow();
  if (!on.length) return null;
  const b = document.createElement('div');
  b.className = 'evb';
  b.innerHTML = icon('star');
  const text = document.createElement('div');
  text.className = 'evb-text';
  const head = document.createElement('b');
  head.textContent = t('event.title').replace('{x}', String(EVENT_MULT));
  const kinds = document.createElement('span');
  kinds.textContent = on.map((e) => t(`event.kind.${e.kind}` as MessageKey)).join(' · ');
  text.append(head, kinds);
  b.appendChild(text);
  // The soonest end (an event on until turned off has none).
  const ends = on.map((e) => e.until).filter((u) => u > 0);
  if (ends.length) {
    const left = document.createElement('span');
    left.className = 'evb-left';
    const ms = Math.min(...ends) - Date.now();
    const h = Math.floor(ms / 3600_000);
    const m = Math.max(1, Math.ceil((ms % 3600_000) / 60_000));
    left.textContent = h >= 24 ? t('event.leftDays').replace('{n}', String(Math.ceil(h / 24))) : h > 0 ? t('event.leftHours').replace('{h}', String(h)).replace('{m}', String(m)) : t('event.leftMin').replace('{m}', String(m));
    b.appendChild(left);
  }
  parent.appendChild(b);
  return b;
}
