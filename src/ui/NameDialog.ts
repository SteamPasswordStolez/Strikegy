import { t } from '@/i18n';
import { saveName } from '@/net/identity';
import { NAME_MAX, reservedText } from '@/net/lobbyProtocol';

/**
 * "Pick your name": shown over the main menu on the first visit, and when the
 * name on the menu is clicked. `required` hides the cancel button.
 */
export function askName(parent: HTMLElement, current: string | null, required: boolean, done: (name: string | null) => void, switchLanguage?: () => void): void {
  const shade = document.createElement('div');
  shade.className = 'lb-dialog-shade';
  const box = document.createElement('form');
  box.className = 'lb-dialog';
  shade.appendChild(box);
  const title = document.createElement('div');
  title.className = 'lb-dialog-title';
  title.textContent = t('name.title');
  const input = document.createElement('input');
  input.className = 'lb-input';
  input.maxLength = NAME_MAX;
  input.value = current ?? '';
  input.placeholder = t('name.placeholder');
  input.setAttribute('autocomplete', 'nickname');
  const note = document.createElement('div');
  note.className = 'lb-desc';
  note.textContent = t('name.rule');
  const row = document.createElement('div');
  row.className = 'lb-dialog-buttons';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'lb-btn primary';
  ok.textContent = t('lobby.hint.ok');
  row.appendChild(ok);
  let cancel: HTMLButtonElement | null = null;
  if (!required) {
    cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lb-btn';
    cancel.textContent = t('mp.cancel');
    cancel.addEventListener('click', () => close(null));
    row.appendChild(cancel);
  }
  box.append(title, input, note, row);
  // The first thing a new player sees: a way to English (or back) right here.
  if (switchLanguage) {
    const lang = document.createElement('button');
    lang.type = 'button';
    lang.className = 'lb-lang';
    const label = () => (lang.textContent = t('lobby.otherLanguage'));
    label();
    lang.addEventListener('click', () => {
      switchLanguage();
      title.textContent = t('name.title');
      input.placeholder = t('name.placeholder');
      note.textContent = t('name.rule');
      ok.textContent = t('lobby.hint.ok');
      if (cancel) cancel.textContent = t('mp.cancel');
      label();
      input.focus();
    });
    box.prepend(lang);
  }
  const close = (name: string | null): void => {
    shade.remove();
    done(name);
  };
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = saveName(input.value);
    if (name) close(name);
    else {
      // Names passing for staff or the server (owner, 2026-10-14) get their own reason.
      note.textContent = t(reservedText(input.value) ? 'name.reserved' : 'name.rule');
      note.classList.add('warn');
      input.focus();
    }
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // Enter while a Hangul syllable is still being composed only finishes it (no submit with half a name).
    if (e.key === 'Enter' && e.isComposing) e.preventDefault();
    if (e.key === 'Escape' && !required) close(null);
  });
  parent.appendChild(shade);
  input.focus();
}
