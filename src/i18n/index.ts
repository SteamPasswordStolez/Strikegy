import ko from './ko.json';
import en from './en.json';

export type Locale = 'ko' | 'en';
export type MessageKey = keyof typeof ko;

const tables: Record<Locale, Record<MessageKey, string>> = { ko, en };
let current: Locale = 'ko';

/** Names the key bound to an action, for `{k:action}` in the strings (set by `input/bindings`). */
let keyNameOf: (action: string) => string = (action) => action;

export function setKeyNames(fn: (action: string) => string): void {
  keyNameOf = fn;
}

export function setLocale(locale: Locale): void {
  current = locale;
  document.documentElement.lang = locale;
}

/** The language the page shows. */
export function getLocale(): Locale {
  return current;
}

export function t(key: MessageKey): string {
  const s = tables[current][key] ?? tables.ko[key] ?? key;
  return s.includes('{k:') ? s.replace(/\{k:(\w+)\}/g, (_, a: string) => keyNameOf(a)) : s;
}
