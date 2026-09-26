import ko from './ko.json';
import en from './en.json';

export type Locale = 'ko' | 'en';
export type MessageKey = keyof typeof ko;

const tables: Record<Locale, Record<MessageKey, string>> = { ko, en };
let current: Locale = 'ko';

export function setLocale(locale: Locale): void {
  current = locale;
  document.documentElement.lang = locale;
}

export function t(key: MessageKey): string {
  return tables[current][key] ?? tables.ko[key] ?? key;
}
