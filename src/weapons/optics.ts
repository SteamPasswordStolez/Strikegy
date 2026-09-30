/**
 * Sights per weapon: the optic model on the gun and the reticle seen through
 * it. Plain data plus the scope reticle drawings (SVG), so the HUD and the gun
 * models read the same table and tests need no DOM or WebGL.
 */

/** 1x sights are seen on the gun model; `scope` means a magnified scope (full-screen view when aimed). */
export type OpticModel = 'reddot' | 'reflex' | 'holo' | 'kobra' | 'prism' | 'irons' | 'bead' | 'scope';

/**
 * Reticle patterns. 1x: dot (red dot / reflex), circleDot (holographic ring),
 * kobra (Russian collimator: posts and a chevron), chevron (prism).
 * Scopes: duplex, mildot, pso (chevrons and a range-finder curve), bdc
 * (bullet-drop hash marks), tree (holdover dots, lit centre).
 */
export type Reticle = 'dot' | 'circleDot' | 'kobra' | 'chevron' | 'duplex' | 'mildot' | 'pso' | 'bdc' | 'tree';

/** Shape of a magnified scope (meters; the gun models are at real scale). */
export interface ScopeShape {
  /** Main tube radius. */
  tube: number;
  /** Objective bell radius (front). */
  objective: number;
  /** Eyepiece radius (back). */
  eyepiece: number;
  /** Body length, eyepiece to objective. */
  length: number;
  /** Sunshade past the objective (0 = none). */
  shade: number;
  /** Turret style: low caps, capped hunting turrets or tall target turrets. */
  turrets: 'low' | 'capped' | 'tall';
  finish: 'black' | 'tan' | 'olive';
  /** Long rubber eye cup (PSO-style). */
  eyecup?: boolean;
  /** Clamped from a bracket on the left instead of two rings. */
  sideMount?: boolean;
  /** Throw lever on the power ring (low-power variable). */
  lever?: boolean;
  /** Illumination knob on the left side. */
  illum?: boolean;
}

export interface Optic {
  model: OpticModel;
  reticle: Reticle;
  /** Colour of the lit parts of the reticle. */
  color: number;
  /** Magnified scopes only. */
  scope?: ScopeShape;
}

const RED = 0xff2a1a;
const GREEN = 0x49ff62;
const AMBER = 0xff6a1c;

/** Unlisted weapons: irons (pistols, belt-fed MGs) or a shotgun bead. */
const OPTICS: Record<string, Optic> = {
  ar1: { model: 'reddot', reticle: 'dot', color: RED },
  ar2: { model: 'kobra', reticle: 'kobra', color: RED },
  ar3: { model: 'reflex', reticle: 'dot', color: GREEN },
  ar4: { model: 'holo', reticle: 'circleDot', color: RED },
  smg1: { model: 'reflex', reticle: 'dot', color: GREEN },
  smg2: { model: 'kobra', reticle: 'kobra', color: RED },
  smg3: { model: 'reddot', reticle: 'dot', color: RED },
  smg4: { model: 'holo', reticle: 'circleDot', color: RED },
  lmg3: { model: 'kobra', reticle: 'kobra', color: RED },
  dmr1: { model: 'prism', reticle: 'chevron', color: AMBER },
  // Low-power variable with a throw lever, lit centre and drop marks.
  dmr2: {
    model: 'scope',
    reticle: 'bdc',
    color: RED,
    scope: { tube: 0.0135, objective: 0.0165, eyepiece: 0.019, length: 0.2, shade: 0, turrets: 'low', finish: 'black', lever: true, illum: true },
  },
  // PSO-style: side bracket, long eye cup, lit chevrons.
  dmr3: {
    model: 'scope',
    reticle: 'pso',
    color: AMBER,
    scope: { tube: 0.0125, objective: 0.0175, eyepiece: 0.017, length: 0.19, shade: 0, turrets: 'capped', finish: 'black', eyecup: true, sideMount: true, illum: true },
  },
  // Hunting-style tactical scope with target turrets and mil dots.
  sr1: {
    model: 'scope',
    reticle: 'mildot',
    color: RED,
    scope: { tube: 0.0145, objective: 0.023, eyepiece: 0.02, length: 0.29, shade: 0.03, turrets: 'tall', finish: 'black' },
  },
  // Big 56 mm objective, long sunshade, lit holdover tree.
  sr2: {
    model: 'scope',
    reticle: 'tree',
    color: RED,
    scope: { tube: 0.017, objective: 0.03, eyepiece: 0.021, length: 0.32, shade: 0.07, turrets: 'tall', finish: 'tan', illum: true },
  },
  sr3: {
    model: 'scope',
    reticle: 'duplex',
    color: RED,
    scope: { tube: 0.0135, objective: 0.02, eyepiece: 0.0185, length: 0.25, shade: 0, turrets: 'capped', finish: 'olive' },
  },
};

const DEFAULT_SCOPE: Optic = {
  model: 'scope',
  reticle: 'duplex',
  color: RED,
  scope: { tube: 0.0125, objective: 0.02, eyepiece: 0.019, length: 0.22, shade: 0, turrets: 'capped', finish: 'black' },
};

/** The sight a weapon carries. `scope` (from the weapon data) always gets a magnified optic. */
export function opticFor(def: { id: string; class: string; scope?: string }): Optic {
  const o = OPTICS[def.id];
  if (def.scope) return o?.scope ? o : DEFAULT_SCOPE;
  if (o) return o;
  if (def.class === 'sg') return { model: def.id === 'sg1' ? 'bead' : 'irons', reticle: 'dot', color: RED };
  if (def.class === 'smg') return { model: 'holo', reticle: 'circleDot', color: RED };
  if (def.class === 'ar' || def.class === 'dmr') return { model: 'reddot', reticle: 'dot', color: RED };
  return { model: 'irons', reticle: 'dot', color: RED };
}

// ---------------------------------------------------------------------------
// Scope reticles, drawn in a -100..100 box (the lens is the circle of radius 100).

const INK = '#0b0b0c';

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function lines(d: string, width: number, color = INK): string {
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="butt"/>`;
}

function dot(x: number, y: number, r: number, color = INK): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
}

/** Heavy outer posts from `from` to the lens edge on all four sides (or `sides`). */
function posts(from: number, width: number, sides = 'lrtb'): string {
  let d = '';
  if (sides.includes('l')) d += `M-100 0H${-from}`;
  if (sides.includes('r')) d += `M${from} 0H100`;
  if (sides.includes('t')) d += `M0 -100V${-from}`;
  if (sides.includes('b')) d += `M0 ${from}V100`;
  return lines(d, width);
}

/** SVG markup (inner content of a -100..100 viewBox) for a scope reticle. */
export function reticleSvg(kind: Reticle, color: number): string {
  const lit = hex(color);
  const parts: string[] = [];
  switch (kind) {
    case 'mildot': {
      parts.push(posts(62, 3), lines('M-62 0H62M0 -62V62', 0.45));
      for (let k = 1; k <= 5; k++) {
        const s = k * 10;
        parts.push(dot(-s, 0, 1.15), dot(s, 0, 1.15), dot(0, -s, 1.15), dot(0, s, 1.15));
      }
      break;
    }
    case 'tree': {
      parts.push(posts(60, 2.6), lines('M-60 0H60M0 -60V60', 0.38));
      // Hash marks every 6 (long every 5th) on both axes.
      let d = '';
      for (let k = 1; k * 6 < 58; k++) {
        const s = k * 6;
        const l = k % 5 === 0 ? 3.2 : 1.6;
        d += `M${s} ${-l}V${l}M${-s} ${-l}V${l}M${-l} ${-s}H${l}`;
      }
      parts.push(lines(d, 0.35));
      // Holdover tree below the centre: one more dot each side per row.
      for (let row = 1; row <= 7; row++) {
        const y = row * 6;
        for (let j = 1; j <= Math.min(row, 5); j++) parts.push(dot(-j * 6, y, 0.55), dot(j * 6, y, 0.55));
      }
      parts.push(dot(0, 0, 1.2, lit));
      break;
    }
    case 'bdc': {
      parts.push(posts(46, 3.2), lines('M-46 0H-4M4 0H46M0 -46V-4M0 4V46', 0.55));
      parts.push(`<circle cx="0" cy="0" r="22" stroke="${INK}" stroke-width="0.55" fill="none"/>`);
      // Drop marks for 300 / 400 / 500 / 600 m, narrower as they go down.
      let d = '';
      [9, 17, 26, 36].forEach((y, i) => {
        const w = 7 - i * 1.4;
        d += `M${-w} ${y}H${w}`;
      });
      parts.push(lines(d, 0.65));
      parts.push(`<circle cx="0" cy="0" r="22" stroke="${lit}" stroke-width="0.4" fill="none" opacity="0.55"/>`, dot(0, 0, 1.5, lit));
      break;
    }
    case 'pso': {
      // Main aiming chevron and three for longer ranges, lit.
      parts.push(lines('M-5 7L0 0L5 7', 1.1, lit));
      for (const y of [12, 19, 26]) parts.push(lines(`M-3.4 ${y + 5}L0 ${y}L3.4 ${y + 5}`, 0.9, lit));
      // Windage scale either side (long tick every 10).
      let d = 'M-62 0H-9M9 0H62';
      for (let x = 10; x <= 60; x += 5) {
        const l = x % 10 === 0 ? 3.5 : 1.8;
        d += `M${x} 0V${-l}M${-x} 0V${-l}`;
      }
      parts.push(lines(d, 0.6));
      // Range finder: a man's height (1.7 m) fits between the line and the curve at 200..1000 m.
      parts.push(lines('M-74 44H-20', 0.65), lines('M-74 22C-58 32 -40 39 -20 42.4', 0.65));
      const labels = ['10', '8', '6', '4', '2'];
      labels.forEach((t, i) => parts.push(`<text x="${-73 + i * 12.5}" y="52" font-size="4.6" fill="${INK}" font-family="sans-serif">${t}</text>`));
      break;
    }
    case 'duplex':
    default: {
      parts.push(posts(36, 3.6), lines('M-36 0H36M0 -36V36', 0.55));
      break;
    }
  }
  return parts.join('');
}
