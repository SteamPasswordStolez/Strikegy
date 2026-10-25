import { WEAPONS, type WeaponClass, type WeaponDef, type WeaponId } from '@/weapons/weaponData';
import { attachmentsFor, withAttachments, type AttachSet } from '@/weapons/attachments';
import type { ClassId } from '@/data/classes';

/**
 * Fighting styles. Every bot rolls one on creation so a team is a mix of
 * people who rush, people who hold, and people who shoot from afar, instead
 * of a column of identical soldiers.
 */
export type Archetype = 'rusher' | 'rifleman' | 'anchor' | 'marksman';

export interface Personality {
  archetype: Archetype;
  /** 0..1: pushes, chases and trades rather than waiting. */
  aggression: number;
  /** 0..1: fights from cover, approaches carefully, retreats sooner. */
  caution: number;
  /** Multiplier on the time to notice an enemy. */
  reaction: number;
  /** Multiplier on aim error. */
  aim: number;
  /** Multiplier on the weapon's preferred fighting distance. */
  range: number;
  /** Walk / sprint speed multiplier. */
  pace: number;
  /** Side of the path this bot keeps to (-1..1), so a group spreads out instead of walking single file. */
  lane: number;
  /** 0..1: how readily grenades and smoke come out. */
  grenades: number;
}

interface Style {
  weight: number;
  aggression: [number, number];
  caution: [number, number];
  range: [number, number];
  pace: [number, number];
  grenades: [number, number];
}

const STYLES: Record<Archetype, Style> = {
  rusher: {
    weight: 25,
    aggression: [0.7, 1],
    caution: [0, 0.3],
    range: [0.7, 0.9],
    pace: [1, 1.05],
    grenades: [0.5, 0.9],
  },
  rifleman: {
    weight: 45,
    aggression: [0.35, 0.65],
    caution: [0.3, 0.6],
    range: [0.9, 1.1],
    pace: [0.95, 1.02],
    grenades: [0.4, 0.8],
  },
  anchor: {
    weight: 20,
    aggression: [0.1, 0.4],
    caution: [0.6, 0.9],
    range: [1, 1.25],
    pace: [0.9, 0.97],
    grenades: [0.3, 0.6],
  },
  marksman: {
    weight: 10,
    aggression: [0.05, 0.3],
    caution: [0.6, 1],
    range: [1.1, 1.4],
    pace: [0.9, 0.97],
    grenades: [0.1, 0.4],
  },
};

/**
 * What each class carries, by fighting style (only the styles a class rolls
 * are listed). Bots take one primary per life.
 */
const CLASS_WEAPONS: Record<ClassId, Partial<Record<Archetype, [WeaponId, number][]>>> = {
  assault: {
    rusher: [['smg1', 3], ['smg2', 2], ['smg4', 1], ['sg1', 2], ['sg3', 1], ['ar4', 2]],
    rifleman: [['ar1', 3], ['ar2', 2], ['ar3', 1], ['ar4', 1], ['lmg3', 1]],
  },
  medic: {
    rusher: [['smg1', 2], ['smg2', 3], ['smg3', 1], ['ar4', 2]],
    rifleman: [['ar1', 3], ['ar4', 2], ['smg2', 1], ['dmr1', 1]],
  },
  support: {
    anchor: [['lmg1', 3], ['lmg2', 2], ['lmg3', 2], ['ar2', 1]],
    rifleman: [['ar1', 2], ['ar2', 1], ['lmg3', 2]],
  },
  recon: {
    marksman: [['dmr1', 3], ['dmr2', 2], ['dmr3', 1], ['sr3', 2], ['sr1', 1]],
  },
};

const CLASS_STYLES: Record<ClassId, [Archetype, number][]> = {
  assault: [['rusher', 45], ['rifleman', 55]],
  medic: [['rifleman', 70], ['rusher', 30]],
  support: [['anchor', 80], ['rifleman', 20]],
  recon: [['marksman', 1]],
};

/** Every weapon a bot can carry (for model prewarming). */
export const BOT_WEAPONS: WeaponId[] = [
  ...new Set(Object.values(CLASS_WEAPONS).flatMap((byStyle) => Object.values(byStyle).flatMap((list) => list.map(([id]) => id)))),
];

/**
 * A team's class mix by roster position: every run of four has a medic, an
 * assault, a support and (every other time) a recon, so each squad of four
 * gets one of each and the team comes out ~3:2:2:1.
 */
export function botClass(index: number): ClassId {
  const k = index % 4;
  return k === 0 ? 'medic' : k === 1 ? 'assault' : k === 2 ? 'support' : index % 8 < 4 ? 'recon' : 'assault';
}

function pick<T>(items: [T, number][], rand: () => number): T {
  let r = rand() * items.reduce((a, [, w]) => a + w, 0);
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[0]![0];
}

const between = ([lo, hi]: [number, number], rand: () => number) => lo + (hi - lo) * rand();

export function rollPersonality(rand: () => number = Math.random, cls?: ClassId): Personality {
  const archetype = cls
    ? pick(CLASS_STYLES[cls], rand)
    : pick(
        (Object.keys(STYLES) as Archetype[]).map((a) => [a, STYLES[a].weight] as [Archetype, number]),
        rand,
      );
  const s = STYLES[archetype];
  return {
    archetype,
    aggression: between(s.aggression, rand),
    caution: between(s.caution, rand),
    reaction: 0.85 + rand() * 0.35,
    aim: 0.85 + rand() * 0.35,
    range: between(s.range, rand),
    pace: between(s.pace, rand),
    lane: rand() * 2 - 1,
    grenades: between(s.grenades, rand),
  };
}

/** A weapon of the bot's class that suits its style (re-rolled on every respawn). */
export function weaponFor(cls: ClassId, p: Personality, rand: () => number = Math.random): WeaponId {
  const byStyle = CLASS_WEAPONS[cls];
  const list = byStyle[p.archetype] ?? Object.values(byStyle)[0]!;
  return pick(list, rand);
}

/** The style a weapon is fitted for when a bot carries it (one build a weapon: one soldier model each). */
const BUILD_STYLE: Record<WeaponClass, Archetype> = { ar: 'rifleman', smg: 'rusher', sg: 'rusher', lmg: 'anchor', dmr: 'marksman', sr: 'marksman', pistol: 'rusher' };

/**
 * A bot's attachments for a gun (progression step 4), from everything the gun
 * takes (bots have no weapon levels), in the style that kind of gun is used:
 * marksman rifles the strongest scope and a bipod; SMGs and shotguns a 1x
 * sight, a stubby or angled grip, a laser, a suppressor and a bigger magazine;
 * rifles a prism, a vertical grip and a muzzle brake; machine guns a bipod and
 * the biggest magazine. One build a weapon, so the game server and a browser
 * running the bot agree and every bot gun stays one soldier model.
 */
export function botBuild(id: WeaponId): AttachSet {
  const all = attachmentsFor(WEAPONS[id]);
  const has = (a: string) => all.some((x) => x.id === a);
  const first = (...ids: string[]) => ids.find(has);
  const sight = all.find((a) => a.slot === 'optic' && a.effect.zoom === 1)?.id;
  const set: AttachSet = {};
  const put = (slot: keyof AttachSet, a: string | undefined) => {
    if (a) set[slot] = a;
  };
  switch (BUILD_STYLE[WEAPONS[id].class]) {
    case 'marksman':
      put('optic', first('scope12', 'scope8', 'scope4', 'prism25'));
      put('under', first('bipod', 'vgrip'));
      put('mag', first('fastmag', 'shellholder'));
      break;
    case 'rusher':
      put('optic', sight);
      put('under', first('sgrip', 'agrip'));
      put('muzzle', first('suppressor', 'choke'));
      put('mag', first('extmag', 'fastmag'));
      put('laser', first('laser'));
      break;
    case 'rifleman':
      put('optic', first('prism25') ?? sight);
      put('under', first('vgrip'));
      put('muzzle', first('brake', 'comp'));
      put('mag', first('fastmag'));
      break;
    case 'anchor':
      put('optic', first('prism25') ?? sight);
      put('under', first('bipod', 'vgrip'));
      put('muzzle', first('flashhider', 'comp'));
      put('mag', first('drum', 'extmag'));
      put('laser', first('taclaser'));
      break;
  }
  return set;
}

/** The gun a bot carries, fitted (`botBuild`). */
export function botWeapon(id: WeaponId): WeaponDef {
  return withAttachments(WEAPONS[id], botBuild(id));
}

/** Every gun as bots carry it: the soldier models made ahead. */
export function botGuns(): WeaponDef[] {
  return BOT_WEAPONS.map(botWeapon);
}
