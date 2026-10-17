/**
 * One icon set for every screen (design system, 2026-10-17): 24 px grid,
 * 1.75 stroke, square ends, no fills. Replaces the emoji and the Unicode
 * symbols (💬 🔒 ◆ ▣ ⌂ ...) the screens used before. Drawn with
 * `.ds-icon` (ds.css), so the colour is the text colour.
 */
const PATHS = {
  play: '<path d="M7 4 19 12 7 20Z"/>',
  multiplayer:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.2c2.2.6 3.5 2.6 3.5 5.8"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/>',
  tutorial: '<path d="M3 5h6.5A2.5 2.5 0 0 1 12 7.5V20a2 2 0 0 0-2-2H3Z"/><path d="M21 5h-6.5A2.5 2.5 0 0 0 12 7.5V20a2 2 0 0 1 2-2h7Z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12"/><path d="M6 10h.5M10 10h.5M14 10h.5M18 10h.5M7 14h10"/>',
  settings:
    '<path d="M3 6h10M19 6h2M3 12h3M12 12h9M3 18h12M21 18h0"/><circle cx="16" cy="6" r="2.25"/><circle cx="9" cy="12" r="2.25"/><circle cx="18" cy="18" r="2.25"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m4 12.5 5.5 5.5L20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4Z"/>',
  desktop: '<rect x="3" y="4" width="18" height="12"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19"/><path d="M11 18.5h2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20 3.5v5h-5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  host: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/>',
  squad:
    '<circle cx="6" cy="9" r="2.5"/><circle cx="12" cy="7" r="3"/><circle cx="18" cy="9" r="2.5"/><path d="M2 19c0-2.5 1.8-4 4-4M8 19c0-3 1.8-5 4-5s4 2 4 5M18 15c2.2 0 4 1.5 4 4"/>',
  exit: '<path d="M10 4H4v16h6"/><path d="m15 8 4 4-4 4M19 12H9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H3.5v1.5A4 4 0 0 0 7 11.5M17 6h3.5v1.5a4 4 0 0 1-3.5 4M12 14v4M8 21h8M9 18h6"/>',
  // In-match things.
  base: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  zone: '<path d="M5 21V3"/><path d="M5 4h13l-3 4.5 3 4.5H5"/>',
  medkit: '<rect x="3" y="7" width="18" height="13"/><path d="M9 7V4h6v3M12 10.5v6M9 13.5h6"/>',
  ammo: '<path d="M5 21v-10l1.5-5L8 11v10ZM10.5 21v-10l1.5-5 1.5 5v10ZM16 21v-10l1.5-5 1.5 5v10Z"/>',
  grenade: '<circle cx="12" cy="14.5" r="6"/><path d="M10 8.5V5.5h4v3M14 6l4-2.5"/>',
  tank: '<path d="M2 15h20l-2 4.5H4Z"/><path d="M6.5 15v-4h8v4M14.5 12.5H22"/>',
  jet: '<path d="M12 2.5 13.8 9l8.2 4v2l-8.2-2-.5 5.5 2.7 2h-8l2.7-2-.5-5.5-8.2 2v-2L10.2 9Z"/>',
  beacon: '<path d="M12 21v-9"/><circle cx="12" cy="9" r="2"/><path d="M8 5a5.6 5.6 0 0 0 0 8M16 5a5.6 5.6 0 0 1 0 8M5 2.5a9.5 9.5 0 0 0 0 13M19 2.5a9.5 9.5 0 0 1 0 13"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z"/>',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** An inline SVG icon (markup from this file only, never from players). */
export function icon(name: IconName, extraClass = ''): string {
  return `<svg class="ds-icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}
