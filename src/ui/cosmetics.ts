/**
 * Pictures of the cosmetics (progression step 5), all drawn here from the
 * catalog's parameters (no picture files): player cards on a canvas, emblems
 * as SVG, name plate colours, and a flat swatch of a camo for the shop and
 * the armory (the gun itself wears it through the shader, camoMaterial.ts).
 */
import type { CamoLook, CardLook, CharmLook, EmblemLook, Item, KillFxLook, VehicleClass, VehicleSkinLook } from '@/progression/catalog';
import type { WeaponId } from '@/weapons/weaponData';
import { weaponPortrait, weaponPortraitNow } from './weaponPortraits';
import { getLocale } from '@/i18n';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A catalog / challenge name in the page's language. */
export function nameOf(n: [string, string] | undefined): string {
  if (!n) return '';
  return getLocale() === 'ko' ? n[0] : n[1];
}

// ---------------------------------------------------------------------------
// Cards

/** A player card (`w` x `h` CSS pixels, drawn at twice that). */
export function cardCanvas(look: CardLook, w = 240, h = 60): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  c.className = `cos-card${look.animated ? ' anim' : ''}`;
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(2, 2);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, hex(look.bg[0]));
  grad.addColorStop(1, hex(look.bg[1]));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = hex(look.ink);
  g.strokeStyle = hex(look.ink);
  g.lineWidth = 2;
  g.globalAlpha = 0.85;
  const R = w * 0.72;
  const base = h * 0.78;
  switch (look.motif) {
    case 'sun':
      g.beginPath();
      g.arc(R, base, h * 0.32, Math.PI, 0);
      g.fill();
      line(g, 0, base, w, base);
      break;
    case 'ship':
    case 'carrier':
    case 'boat': {
      const len = look.motif === 'boat' ? w * 0.25 : w * 0.45;
      const x0 = R - len / 2;
      g.beginPath();
      g.moveTo(x0, base - h * 0.12);
      g.lineTo(x0 + len, base - h * 0.12);
      g.lineTo(x0 + len * 0.92, base);
      g.lineTo(x0 + len * 0.06, base);
      g.closePath();
      g.fill();
      if (look.motif === 'ship') {
        g.fillRect(x0 + len * 0.35, base - h * 0.32, len * 0.18, h * 0.2);
        g.fillRect(x0 + len * 0.42, base - h * 0.48, len * 0.05, h * 0.18);
      } else if (look.motif === 'carrier') {
        g.fillRect(x0 + len * 0.7, base - h * 0.3, len * 0.08, h * 0.18);
      } else {
        g.fillRect(x0 + len * 0.02, base - h * 0.28, len * 0.12, h * 0.16);
      }
      waves(g, w, base + 3, h);
      break;
    }
    case 'palm':
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(R, base);
      g.quadraticCurveTo(R - 6, base - h * 0.3, R + 4, base - h * 0.55);
      g.stroke();
      for (const a of [-2.6, -2.0, -1.2, -0.6, 0]) {
        g.beginPath();
        g.moveTo(R + 4, base - h * 0.55);
        g.quadraticCurveTo(R + 4 + Math.cos(a) * 18, base - h * 0.55 + Math.sin(a) * 12 - 6, R + 4 + Math.cos(a) * 28, base - h * 0.55 + Math.sin(a) * 6 + 8);
        g.stroke();
      }
      waves(g, w, base + 2, h);
      break;
    case 'waves':
      waves(g, w, base - h * 0.3, h);
      waves(g, w, base, h);
      break;
    case 'peaks':
      g.beginPath();
      g.moveTo(w * 0.35, h);
      g.lineTo(w * 0.55, h * 0.3);
      g.lineTo(w * 0.68, h * 0.55);
      g.lineTo(w * 0.8, h * 0.2);
      g.lineTo(w, h * 0.6);
      g.lineTo(w, h);
      g.closePath();
      g.fill();
      break;
    case 'stars':
      for (let i = 0; i < 24; i++) {
        const x = w * 0.3 + ((i * 47) % 70) * w * 0.01;
        const y = ((i * 31) % 90) * h * 0.01;
        g.fillRect(x, y, i % 5 === 0 ? 2.5 : 1.5, i % 5 === 0 ? 2.5 : 1.5);
      }
      break;
    case 'chevrons':
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(R - 18, h * 0.3 + i * 12);
        g.lineTo(R, h * 0.18 + i * 12);
        g.lineTo(R + 18, h * 0.3 + i * 12);
        g.lineWidth = 4;
        g.stroke();
      }
      break;
    case 'rays':
      for (let i = 0; i < 14; i++) {
        const a = Math.PI + (i / 13) * Math.PI;
        line(g, R, base, R + Math.cos(a) * w, base + Math.sin(a) * w);
      }
      g.beginPath();
      g.arc(R, base, h * 0.18, 0, Math.PI * 2);
      g.fill();
      break;
    case 'grid':
      g.globalAlpha = 0.35;
      for (let x = w * 0.4; x < w; x += 12) line(g, x, 0, x, h);
      for (let y = 6; y < h; y += 12) line(g, w * 0.4, y, w, y);
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(R, h * 0.45, 5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'moon':
      g.beginPath();
      g.arc(R, h * 0.45, h * 0.28, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(R + h * 0.12, h * 0.38, h * 0.26, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      break;
    case 'smoke':
      g.globalAlpha = 0.35;
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.arc(w * 0.45 + i * w * 0.06, h * 0.7 - i * 3 - Math.sin(i) * 6, h * 0.16 + i, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'wings':
      for (let i = 0; i < 3; i++) jet(g, R - 26 + i * 26, h * 0.35 + (i === 1 ? -8 : 6));
      break;
    case 'lighthouse':
      g.beginPath();
      g.moveTo(R - 6, base);
      g.lineTo(R - 3, base - h * 0.55);
      g.lineTo(R + 3, base - h * 0.55);
      g.lineTo(R + 6, base);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.3;
      g.beginPath();
      g.moveTo(R, base - h * 0.58);
      g.lineTo(R - w * 0.45, base - h * 0.85);
      g.lineTo(R - w * 0.45, base - h * 0.35);
      g.closePath();
      g.fill();
      waves(g, w, base + 2, h);
      break;
    case 'storm':
      g.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(R, h * 0.5, 6 + i * 6, i * 0.9, i * 0.9 + Math.PI * 1.3);
        g.stroke();
      }
      break;
  }
  return c;
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function waves(g: CanvasRenderingContext2D, w: number, y: number, h: number): void {
  g.beginPath();
  for (let x = w * 0.3; x <= w; x += 2) g.lineTo(x, y + Math.sin(x * 0.12) * h * 0.04);
  g.stroke();
}

function jet(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.beginPath();
  g.moveTo(x + 12, y);
  g.lineTo(x - 10, y - 3);
  g.lineTo(x - 2, y);
  g.lineTo(x - 10, y + 3);
  g.closePath();
  g.fill();
  g.fillRect(x - 4, y - 8, 4, 16);
}

// ---------------------------------------------------------------------------
// Emblems

const SHAPE: Record<EmblemLook['shape'], string> = {
  shield: 'M50 4 L92 16 L88 58 Q80 84 50 96 Q20 84 12 58 L8 16 Z',
  circle: 'M50 4 A46 46 0 1 1 49.9 4 Z',
  diamond: 'M50 2 L98 50 L50 98 L2 50 Z',
  hex: 'M50 3 L91 26 L91 74 L50 97 L9 74 L9 26 Z',
  star: 'M50 2 L62 36 L98 36 L69 58 L80 94 L50 72 L20 94 L31 58 L2 36 L38 36 Z',
  square: 'M8 8 H92 V92 H8 Z',
};

/** Simple glyphs on a 100 x 100 field (filled, the second colour). */
const GLYPH: Record<EmblemLook['glyph'], string> = {
  anchor: 'M47 20 h6 v8 h10 v6 h-10 v34 q14 -2 18 -14 l6 2 q-6 22 -27 22 q-21 0 -27 -22 l6 -2 q4 12 18 14 v-34 h-10 v-6 h10 z M50 12 a5 5 0 1 1 -0.1 0 z',
  wave: 'M14 58 q10 -14 20 0 t20 0 t20 0 t12 -4 v10 q-6 4 -12 0 q-10 -12 -20 0 t-20 0 t-20 0 z M14 40 q10 -14 20 0 t20 0 t20 0 t12 -4 v8 q-6 4 -12 0 q-10 -12 -20 0 t-20 0 t-20 0 z',
  gull: 'M16 50 q16 -16 32 2 q2 -2 4 0 q16 -18 32 -2 q-16 -6 -32 8 q-2 1 -4 0 q-16 -14 -32 -8 z',
  palm: 'M48 86 q-4 -26 2 -46 h4 q-4 22 0 46 z M52 40 q-20 -14 -34 0 q16 -4 30 4 z M52 40 q20 -14 34 0 q-16 -4 -30 4 z M52 40 q-8 -22 -26 -24 q14 8 22 26 z M52 40 q8 -22 26 -24 q-14 8 -22 26 z',
  coral: 'M46 86 v-24 l-14 -14 v-16 h6 v14 l8 8 v-28 h8 v20 l8 -8 v-14 h6 v18 l-14 14 v30 z',
  compass: 'M50 12 L58 50 L50 88 L42 50 Z M12 50 L50 44 L88 50 L50 56 Z',
  trident: 'M47 90 v-48 h-12 v-24 h6 v18 h6 v-24 h6 v24 h6 v-18 h6 v24 h-12 v48 z',
  seahorse: 'M56 16 q16 4 12 20 q-4 10 -14 10 q8 10 4 24 q-4 14 -16 16 q8 -10 2 -20 q-10 -14 2 -34 q2 -12 10 -16 z',
  kraken: 'M50 14 a20 20 0 0 1 20 20 v10 q0 10 -20 10 q-20 0 -20 -10 v-10 a20 20 0 0 1 20 -20 z M32 54 q-14 10 -12 30 q6 -18 16 -24 z M44 56 q-4 18 -12 30 q12 -8 16 -28 z M56 56 q4 18 12 30 q-12 -8 -16 -28 z M68 54 q14 10 12 30 q-6 -18 -16 -24 z',
  skull: 'M50 16 q26 0 26 26 q0 14 -10 18 v12 h-32 v-12 q-10 -4 -10 -18 q0 -26 26 -26 z M38 40 a6 6 0 1 0 0.1 0 z M62 40 a6 6 0 1 0 0.1 0 z',
  eagle: 'M50 24 l8 10 l30 -6 l-18 14 l14 4 l-24 4 l-4 30 l-6 -12 l-6 12 l-4 -30 l-24 -4 l14 -4 l-18 -14 l30 6 z',
  wolf: 'M30 18 l12 16 h16 l12 -16 l4 30 q0 22 -24 34 q-24 -12 -24 -34 z',
  tiger: 'M50 18 q24 0 28 22 q2 24 -28 40 q-30 -16 -28 -40 q4 -22 28 -22 z',
  bear: 'M26 26 a8 8 0 1 1 10 6 q14 -6 28 0 a8 8 0 1 1 10 -6 q10 14 4 34 q-8 22 -28 22 q-20 0 -28 -22 q-6 -20 4 -34 z',
  hawk: 'M50 20 l10 18 l26 -2 l-22 12 l8 26 l-22 -14 l-22 14 l8 -26 l-22 -12 l26 2 z',
  star: 'M50 14 L59 40 L86 40 L64 56 L72 82 L50 66 L28 82 L36 56 L14 40 L41 40 Z',
  bolt: 'M56 10 L28 56 H48 L40 90 L72 40 H52 Z',
  sword: 'M47 10 h6 v52 h12 v6 h-12 v14 h-6 v-14 h-12 v-6 h12 z',
  arrow: 'M50 10 L70 34 H56 V90 H44 V34 H30 Z',
  crown: 'M16 70 L22 30 L38 48 L50 22 L62 48 L78 30 L84 70 Z',
  flame: 'M50 12 q24 26 16 50 q-4 20 -16 24 q-12 -4 -16 -24 q-4 -14 8 -26 q0 12 8 14 q-6 -18 0 -38 z',
  leaf: 'M50 12 q30 20 22 52 q-8 22 -22 26 q-14 -4 -22 -26 q-8 -32 22 -52 z',
  mountain: 'M10 82 L38 30 L52 54 L64 38 L90 82 Z',
  letter: '',
};

/** An emblem as SVG markup (a `size` px square). */
export function emblemSvg(look: EmblemLook, size = 48): string {
  const [fill, ink, edge] = look.colors.map(hex);
  const glyph = look.glyph === 'letter'
    ? `<text x="50" y="64" text-anchor="middle" font-size="46" font-weight="700" fill="${ink}" font-family="inherit">${(look.letter ?? 'S').slice(0, 2)}</text>`
    : `<path d="${GLYPH[look.glyph]}" fill="${ink}"/>`;
  return `<svg class="cos-emblem${look.animated ? ' anim' : ''}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><path d="${SHAPE[look.shape]}" fill="${fill}" stroke="${edge}" stroke-width="4"/>${glyph}</svg>`;
}

// ---------------------------------------------------------------------------
// Camo swatches (a flat preview; the gun's shader does the real thing)

function vnoise(x: number, y: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
function fbm(x: number, y: number): number {
  let a = 0.5;
  let s = 0;
  for (let k = 0; k < 4; k++) {
    s += a * vnoise(x, y);
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s;
}

const swatchCache = new Map<string, string>();

/** A camo swatch as an image address (cached). */
export function camoSwatch(look: CamoLook, size = 64): string {
  const key = `${look.pattern}|${look.colors.join(',')}|${look.scale}|${size}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(size, size);
  const cols = look.colors.map((n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const s = look.scale / 14;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let px = x * s;
      let py = y * s;
      let pick = 0;
      let mix = 0;
      switch (look.pattern) {
        case 'solid':
          mix = vnoise(px * 2, py * 2) * 0.25;
          break;
        case 'blotch':
        case 'bands': {
          if (look.pattern === 'bands') {
            px *= 0.6;
            py *= 1.8;
          }
          const n = fbm(px, py);
          pick = n < 0.42 ? 1 : n < 0.58 ? 0 : 2;
          break;
        }
        case 'digital': {
          const n = fbm(Math.floor(px * 1.5) / 1.5, Math.floor(py * 1.5) / 1.5);
          pick = n < 0.42 ? 1 : n < 0.58 ? 0 : 2;
          break;
        }
        case 'stripes':
        case 'tiger':
        case 'waves': {
          const v = Math.sin(py * (look.pattern === 'tiger' ? 3 : 6) + fbm(px, py) * (look.pattern === 'tiger' ? 7 : 5));
          pick = v > 0.45 ? 1 : v < -0.6 ? 2 : 0;
          break;
        }
        case 'wrap': {
          const turn = (((px + py * 0.55) * 1.6) % 1 + 1) % 1;
          pick = turn < 0.06 || turn > 0.94 ? 1 : fbm(px * 2.5, py * 2.5) > 0.55 ? 2 : 0;
          break;
        }
        case 'carbon': {
          const w = (Math.floor(px * 0.25) + Math.floor(py * 0.25)) % 2;
          mix = 0;
          pick = w ? 0 : 1;
          break;
        }
        case 'hex': {
          const q = Math.floor(px * 0.9) + (Math.floor(py * 0.9) % 2) * 0.5;
          const edge = Math.abs(((px * 0.9) % 1) - 0.5) > 0.44 || Math.abs(((py * 0.9) % 1) - 0.5) > 0.44;
          pick = edge ? 2 : vnoise(q * 3, Math.floor(py * 0.9) * 3) > 0.5 ? 0 : 1;
          break;
        }
        case 'splinter': {
          const a = Math.sin(px * 1.7 + py * 2.3) + Math.sin(px * -2.9 + py * 1.1 + 1.7) + (vnoise(Math.floor(px * 2), Math.floor(py * 2)) - 0.5) * 1.4;
          pick = a > 0.6 ? 1 : a < -0.7 ? 2 : 0;
          break;
        }
        case 'net': {
          const gx = Math.abs(((px * 1.2) % 1) - 0.5);
          const gy = Math.abs(((py * 1.2) % 1) - 0.5);
          pick = Math.min(gx, gy) < 0.06 ? 1 : fbm(px, py) > 0.55 ? 2 : 0;
          break;
        }
        case 'metal':
        case 'obsidian':
        case 'flow':
        case 'scales': {
          const n = vnoise(px * 0.3, py * 8) * 0.6 + vnoise(px * 4, py * 4) * 0.4;
          pick = look.pattern === 'obsidian' ? (Math.abs(fbm(px, py) - 0.5) < 0.03 ? 2 : 1) : n > 0.8 ? 2 : n > 0.45 ? 0 : 1;
          mix = look.pattern === 'metal' ? n * 0.3 : 0;
          break;
        }
      }
      const c0 = cols[pick]!;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, c0[0]! * (1 - mix) + cols[1]![0]! * mix);
      img.data[i + 1] = Math.min(255, c0[1]! * (1 - mix) + cols[1]![1]! * mix);
      img.data[i + 2] = Math.min(255, c0[2]! * (1 - mix) + cols[1]![2]! * mix);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL();
  swatchCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Step 6: charms, vehicle skins, kill effects (gun skins are the gun's own picture).

const CHARM_PATH: Record<CharmLook['shape'], string> = {
  tag: '<rect x="8" y="3" width="8" height="15" rx="3"/><circle cx="12" cy="6" r="1.2" fill="var(--a)"/>',
  die: '<rect x="5" y="6" width="13" height="13" rx="2"/><circle cx="9" cy="10" r="1.3" fill="var(--a)"/><circle cx="14" cy="15" r="1.3" fill="var(--a)"/><circle cx="11.5" cy="12.5" r="1.3" fill="var(--a)"/>',
  cube: '<path d="M12 4 19 8v8l-7 4-7-4V8Z"/><path d="M12 12v8M12 12l7-4M12 12 5 8" stroke="var(--a)" stroke-width="1" fill="none"/>',
  bullet: '<path d="M10 9h4v10h-4Z"/><path d="M10 9c0-3 1-5 2-6 1 1 2 3 2 6Z" fill="var(--a)"/>',
  coin: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="var(--a)" stroke-width="1.2"/>',
  ring: '<circle cx="12" cy="13" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M10 5h4l-2 3Z" fill="var(--a)"/>',
  leaf: '<path d="M12 4c5 4 5 10 0 16-5-6-5-12 0-16Z"/><path d="M12 6v14" stroke="var(--a)" stroke-width="1"/>',
  star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7Z"/>',
  skull: '<path d="M6 11a6 6 0 1 1 12 0c0 2-1 3-2 3.5V18H8v-3.5C7 14 6 13 6 11Z"/><circle cx="9.5" cy="11" r="1.6" fill="var(--a)"/><circle cx="14.5" cy="11" r="1.6" fill="var(--a)"/>',
  heart: '<path d="M12 19 5 12a4 4 0 0 1 7-5 4 4 0 0 1 7 5Z"/>',
  bolt: '<path d="M14 3 6 13h5l-2 8 8-11h-5Z"/>',
  ball: '<circle cx="12" cy="12" r="7"/><path d="M7 7c3 2 3 8 0 10M17 7c-3 2-3 8 0 10" stroke="var(--a)" stroke-width="1.2" fill="none"/>',
  fish: '<path d="M4 12c3-4 8-5 12-2l4-3v10l-4-3c-4 3-9 2-12-2Z"/><circle cx="8" cy="11" r="1" fill="var(--a)"/>',
  bear: '<circle cx="12" cy="14" r="5"/><circle cx="12" cy="8" r="3.5"/><circle cx="9" cy="5" r="1.4"/><circle cx="15" cy="5" r="1.4"/>',
  grenade: '<ellipse cx="12" cy="14" rx="5" ry="6"/><rect x="10" y="4" width="4" height="4" fill="var(--a)"/>',
};

/** A charm as an SVG. */
export function charmSvg(look: CharmLook, size = 48): string {
  const glow = look.glow ? ` style="filter: drop-shadow(0 0 4px ${hex(look.color)})"` : '';
  return `<svg class="cos-charm" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${hex(look.color)};--a:${hex(look.accent)}" fill="currentColor"${glow}><path d="M12 0v3" stroke="#555" stroke-width="0.8"/>${CHARM_PATH[look.shape]}</svg>`;
}

/** Vehicle silhouettes per skin family (the picture of a vehicle skin). */
const SILHOUETTE: Record<VehicleClass, string> = {
  armor: 'M4 40h56l-5 9H9Z M14 40v-9h26v9 M40 34h20v3H40Z M8 30h40v2H8Z',
  car: 'M6 40v-8l6-10h28l10 10h8v8Z M14 44a5 5 0 1 0 0.1 0Z M48 44a5 5 0 1 0 0.1 0Z',
  air: 'M32 6l4 18 24 10v4l-24-4-2 14 7 5H23l7-5-2-14-24 4v-4l24-10Z',
  ship: 'M2 38h60l-8 10H10Z M14 38v-8h22v8 M22 30v-8h6v8 M38 34h14v4H38Z',
};
const VPAL: Record<VehicleClass, [number, number, number]> = {
  armor: [0x3c4a2e, 0x4c3d2a, 0x1e201a],
  car: [0x3c4a2e, 0x4c3d2a, 0x1e201a],
  air: [0x4f5861, 0x434b53, 0x3a4148],
  ship: [0x4f5861, 0x434b53, 0x3a4148],
};
const VPAT: Record<VehicleSkinLook['pattern'], CamoLook['pattern']> = { blotch: 'blotch', bands: 'bands', stripes: 'stripes', digital: 'digital', clouds: 'blotch', tiger: 'tiger', dazzle: 'splinter', splinter: 'splinter' };

/** A vehicle skin on its family's silhouette (blue's colours), as an SVG. */
export function vehicleSkinSvg(cls: VehicleClass, look: VehicleSkinLook, size = 64): string {
  const pal = VPAL[cls].map((c, i) => {
    const k = look.tones[i]!;
    const r = Math.min(255, ((c >> 16) & 255) * k);
    const g = Math.min(255, ((c >> 8) & 255) * k);
    const b = Math.min(255, (c & 255) * k);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }) as [number, number, number];
  // Lift the dark army colours so the pattern reads on the small picture.
  const lift = pal.map((c) => {
    const r = Math.min(255, ((c >> 16) & 255) * 1.7 + 12);
    const g = Math.min(255, ((c >> 8) & 255) * 1.7 + 12);
    const b = Math.min(255, (c & 255) * 1.7 + 12);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }) as [number, number, number];
  const swatch = camoSwatch({ pattern: VPAT[look.pattern], colors: lift, scale: (look.pattern === 'clouds' ? 4 : look.pattern === 'dazzle' ? 3 : 7) * look.scale }, 64);
  const id = `vs${Math.random().toString(36).slice(2, 8)}`;
  const band = look.band ? `<rect x="26" y="0" width="8" height="64" fill="${hex(lift[2])}" opacity="0.85" clip-path="url(#${id})"/>` : '';
  return `<svg class="cos-vskin" viewBox="0 0 64 56" width="${size}" height="${Math.round(size * 0.875)}"><defs><clipPath id="${id}"><path d="${SILHOUETTE[cls]}"/></clipPath></defs><image href="${swatch}" x="0" y="0" width="64" height="64" clip-path="url(#${id})" preserveAspectRatio="none"/>${band}<path d="${SILHOUETTE[cls]}" fill="none" stroke="rgb(255 255 255 / 0.25)" stroke-width="0.8"/></svg>`;
}

const KFX_SHAPE: Record<KillFxLook['shape'], string> = {
  shard: 'M0 -4 3 2 -2 4Z',
  spark: 'M0 -3 0.8 -0.8 3 0 0.8 0.8 0 3 -0.8 0.8 -3 0 -0.8 -0.8Z',
  petal: 'M0 -4C3 -2 3 2 0 4 -3 2 -3 -2 0 -4Z',
  star: 'M0 -4 1.2 -1.2 4 -1 1.8 1 2.4 4 0 2.4 -2.4 4 -1.8 1 -4 -1 -1.2 -1.2Z',
  flake: 'M0 -4V4M-3.5 -2 3.5 2M-3.5 2 3.5 -2',
  scale: 'M-4 0A4 4 0 0 1 4 0Z',
  tag: 'M-2 -3.5h4v7h-4Z',
  leaf: 'M0 -4Q3 0 0 4Q-3 0 0 -4Z',
};

/** A kill effect's picture: its pieces scattered round a body's outline, drifting (CSS). */
export function killFxSvg(look: KillFxLook, size = 56): string {
  const pieces: string[] = [];
  const n = Math.min(14, Math.max(5, Math.round(look.count / 3)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + i;
    const r = 8 + ((i * 37) % 13);
    const x = 32 + Math.cos(a) * r;
    const y = 30 + Math.sin(a) * r * (look.motion === 'ring' ? 0.35 : 1) - (look.motion === 'rise' ? 6 : look.motion === 'fall' ? -6 : 0);
    const c = hex(i % 2 ? look.colors[1] : look.colors[0]);
    const stroke = look.shape === 'flake' ? ` stroke="${c}" stroke-width="1" fill="none"` : ` fill="${c}"`;
    pieces.push(`<path d="${KFX_SHAPE[look.shape]}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(i * 47) % 360}) scale(${(0.8 + (i % 3) * 0.25).toFixed(2)})"${stroke} style="--d:${(i % 5) * 0.12}s"/>`);
  }
  return `<svg class="cos-kfx ${look.motion}" viewBox="0 0 64 64" width="${size}" height="${size}"><path d="M28 54v-14l-4-10 3-8h10l3 8-4 10v14Z" fill="rgb(255 255 255 / 0.12)"/><circle cx="32" cy="16" r="5" fill="rgb(255 255 255 / 0.12)"/>${pieces.join('')}</svg>`;
}

/** Any cosmetic's picture into `parent` (card, emblem, plate, camo, gun skin, charm, vehicle skin, kill effect). */
export function itemPicture(parent: HTMLElement, it: Item, size = 56): void {
  if (it.skin && it.weapon) {
    const img = document.createElement('img');
    img.className = 'cos-skin';
    img.alt = '';
    img.width = Math.round(size * 2.4);
    img.height = Math.round(size * 1.0);
    const w = it.weapon as WeaponId;
    const now = weaponPortraitNow(w, undefined, undefined, it.id);
    if (now) img.src = now;
    else void weaponPortrait(w, undefined, undefined, it.id).then((u) => u && (img.src = u));
    parent.appendChild(img);
    return;
  }
  if (it.charm) return parent.insertAdjacentHTML('beforeend', charmSvg(it.charm, size));
  if (it.vskin && it.vclass) return parent.insertAdjacentHTML('beforeend', vehicleSkinSvg(it.vclass, it.vskin, size * 1.3));
  if (it.kfx) return parent.insertAdjacentHTML('beforeend', killFxSvg(it.kfx, size));
  if (it.card) parent.appendChild(cardCanvas(it.card, size * 3, size * 0.75));
  else if (it.emblem) parent.insertAdjacentHTML('beforeend', emblemSvg(it.emblem, size));
  else if (it.camo) {
    const img = document.createElement('img');
    img.className = 'cos-camo';
    img.alt = '';
    img.src = camoSwatch(it.camo);
    img.width = img.height = size;
    parent.appendChild(img);
  } else if (it.plate !== undefined) {
    const sw = document.createElement('span');
    sw.className = 'cos-plate';
    sw.style.setProperty('--c', hex(it.plate));
    parent.appendChild(sw);
  }
}
