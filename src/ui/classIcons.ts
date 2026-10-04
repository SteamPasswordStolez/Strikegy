import type { ClassId } from '@/data/classes';

const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

/**
 * Line icons per class for the lobby's roster: assault a double chevron,
 * medic a cross, support three rounds, recon a scope reticle.
 */
export const CLASS_ICON: Record<ClassId, string> = {
  assault: svg('<path d="M4 11l6-5 6 5"/><path d="M4 16l6-5 6 5"/>'),
  medic: svg('<path d="M8 3h4v5h5v4h-5v5H8v-5H3V8h5z"/>'),
  support: svg('<path d="M4 17V8l1.5-3L7 8v9zM8.5 17V8L10 5l1.5 3v9zM13 17V8l1.5-3L16 8v9z"/>'),
  recon: svg('<circle cx="10" cy="10" r="6"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/><circle cx="10" cy="10" r="0.6" fill="currentColor"/>'),
};
