import { t } from '@/i18n';
import { saveName } from '@/net/identity';
import { NAME_MAX, reservedText } from '@/net/lobbyProtocol';
import { profane } from '@/net/wordFilter';
import { uiSound } from '@/audio/uiSounds';
import './ds.css';
import './welcome.css';

/**
 * The first thing a new player sees (owner, 2026-11-01: launch): what the game
 * is and one button into a first match, over the menu's battle film. The name is
 * filled in for them (a required form first thing made people stop and think) and
 * can be changed here or later.
 */
export interface WelcomeActions {
  /** Into the first match. */
  start(name: string): void;
  /** To the main menu instead. */
  browse(name: string): void;
  switchLanguage(): void;
}

export function showWelcome(parent: HTMLElement, go: WelcomeActions): void {
  const root = document.createElement('div');
  root.className = 'wc ds-root';
  root.dataset.dsTheme = 'bfv';
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, into: HTMLElement): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.className = cls;
    into.appendChild(e);
    return e;
  };
  const lang = add('button', 'ds-btn ghost wc-lang', root);
  lang.type = 'button';
  const form = add('form', 'wc-main', root);
  const mark = add('h1', 'wc-mark', form);
  mark.textContent = t('title');
  const tagline = add('p', 'wc-tag', form);
  const row = add('label', 'wc-name', form);
  const nameLabel = add('span', 'ds-label', row);
  const input = add('input', 'ds-input', row);
  input.maxLength = NAME_MAX;
  input.setAttribute('autocomplete', 'nickname');
  const note = add('div', 'wc-note', form);
  const start = add('button', 'ds-btn primary wc-start', form);
  start.type = 'submit';
  const browse = add('button', 'ds-btn ghost wc-browse', form);
  browse.type = 'button';
  const number = String(1000 + Math.floor(Math.random() * 9000));
  let auto = '';
  const texts = (): void => {
    lang.textContent = t('lobby.otherLanguage');
    tagline.textContent = t('welcome.tag');
    nameLabel.textContent = t('welcome.name');
    start.textContent = t('welcome.start');
    browse.textContent = t('welcome.browse');
    note.textContent = t('welcome.note');
    note.classList.remove('warn');
    // A suggested name follows the language until the player types their own.
    const next = t('welcome.autoName').replace('{n}', number);
    if (input.value === auto) input.value = next;
    auto = next;
  };
  texts();

  const leave = (then: (name: string) => void): void => {
    // The same rules as the name dialog (the server refuses the rest too).
    const bad = profane(input.value);
    const name = bad ? null : saveName(input.value);
    if (!name) {
      uiSound('error');
      note.textContent = t(bad ? 'name.words' : reservedText(input.value) ? 'name.reserved' : 'name.rule');
      note.classList.add('warn');
      input.focus();
      return;
    }
    root.remove();
    then(name);
  };
  lang.addEventListener('click', () => {
    uiSound('select');
    go.switchLanguage();
    texts();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    leave(go.start);
  });
  browse.addEventListener('click', () => {
    uiSound('select');
    leave(go.browse);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // Enter while a Hangul syllable is still being composed only finishes it.
    if (e.key === 'Enter' && e.isComposing) e.preventDefault();
  });
  for (const b of [start, browse, lang]) b.addEventListener('pointerenter', () => uiSound('hover'));
  parent.appendChild(root);
  start.focus();
}
