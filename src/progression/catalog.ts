/**
 * Every cosmetic the progression hands out or sells (progression step 5;
 * progression.md 3-5 / 3-10 / 3-11, progression-data.md B / H / L): shared
 * camouflage for every gun, player cards, emblems and name plate colours.
 * All drawn in code from the parameters here (no picture files): camo by the
 * gun shader (`camoMaterial`), cards and emblems on a canvas / SVG
 * (`ui/cosmetics.ts`); step 6 adds gun skins (`weapons/gunSkins.ts`), charms,
 * vehicle skins (`vehicles/vehicleLooks.ts`) and kill effects
 * (`render/killEffects.ts`). Import-free (the server reads it).
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export type ItemKind = 'camo' | 'card' | 'emblem' | 'plate' | 'skin' | 'charm' | 'vskin' | 'kfx';
/** Where an item comes from; `vault`: no longer sold (owners keep it). */
export type Source = 'level' | 'box' | 'weekly' | 'challenge' | 'vault';

/** A camo pattern for the gun shader. */
export interface CamoLook {
  pattern: 'solid' | 'blotch' | 'bands' | 'stripes' | 'digital' | 'tiger' | 'net' | 'metal' | 'obsidian' | 'scales' | 'waves' | 'flow' | 'wrap' | 'carbon' | 'hex' | 'splinter';
  colors: [number, number, number];
  /** Pattern size (cells a metre). */
  scale: number;
  /** 0 matte .. 1 metal. */
  metal?: number;
  /** Flowing patterns: how fast (0 still). */
  flow?: number;
}

export interface CardLook {
  bg: [number, number];
  motif: 'sun' | 'ship' | 'carrier' | 'boat' | 'palm' | 'waves' | 'peaks' | 'stars' | 'chevrons' | 'rays' | 'grid' | 'moon' | 'smoke' | 'wings' | 'lighthouse' | 'storm';
  ink: number;
  animated?: boolean;
}

export interface EmblemLook {
  shape: 'shield' | 'circle' | 'diamond' | 'hex' | 'star' | 'square';
  glyph: 'anchor' | 'wave' | 'gull' | 'palm' | 'coral' | 'compass' | 'trident' | 'seahorse' | 'kraken' | 'skull' | 'eagle' | 'wolf' | 'tiger' | 'bear' | 'hawk' | 'star' | 'bolt' | 'sword' | 'arrow' | 'crown' | 'flame' | 'leaf' | 'mountain' | 'letter';
  colors: [number, number, number];
  letter?: string;
  animated?: boolean;
}

/**
 * A gun skin (CoD's "blueprint"): the whole gun's finish — metal, steel,
 * furniture as a colour, a pattern or wood, engraving — on the same model
 * (same numbers, sights and outline). Others see it too.
 */
export interface GunSkinLook {
  /** Receiver and metal parts: colour, metalness, roughness. */
  metal?: [number, number, number];
  /** Barrel and small steel parts. */
  steel?: [number, number, number];
  /** Furniture (polymer, painted parts): a plain colour, metalness, roughness. */
  furniture?: [number, number, number];
  /** Furniture in a pattern (the camo shader). */
  pattern?: CamoLook;
  /** Furniture as wood, this tint. */
  wood?: number;
  /** Engraving over the metal, glowing on the top skins. */
  engrave?: { color: number; glow?: boolean };
  /** How the finish wears and shines (all 0..1; see `GunFinish`). */
  finish?: GunFinish;
  /** Legendary blueprints: their own muzzle device (shown unless one is fitted; numbers unchanged). */
  muzzle?: BlueprintMuzzle;
}

export type BlueprintMuzzle = 'dragon' | 'crystal' | 'crown' | 'fin';

/**
 * The finish over a skin's colours (2026-10-27, BM quality): what makes a
 * skin read as a material rather than a colour.
 */
export interface GunFinish {
  /** Clear lacquer over everything (a wet, deep shine). */
  coat?: number;
  /** Heat-tinted / anodised rainbow sheen on the metal. */
  irid?: number;
  /** Paint rubbed through to bare steel along the edges. */
  wear?: number;
  /** Fine scratches breaking up the shine. */
  scratch?: number;
}

/** A charm on the gun: a small shape on a cord. */
export interface CharmLook {
  shape: 'tag' | 'die' | 'bullet' | 'coin' | 'leaf' | 'star' | 'skull' | 'heart' | 'bolt' | 'ball' | 'fish' | 'bear' | 'grenade' | 'ring' | 'cube';
  color: number;
  accent: number;
  glow?: boolean;
}

/** A vehicle skin: the pattern and the tones of the side's own camouflage colours (friend or foe still reads the same). */
export interface VehicleSkinLook {
  pattern: 'blotch' | 'bands' | 'stripes' | 'digital' | 'clouds' | 'tiger' | 'dazzle' | 'splinter';
  /** Pattern size against the side's default. */
  scale: number;
  /** Each of the side's three colours lightened (> 1) or darkened (< 1). */
  tones: [number, number, number];
  /** A dark band round the hull (command vehicles, aces). */
  band?: boolean;
}

/** A kill effect: a short burst of small pieces round the body, no light (progression-data.md I). */
export interface KillFxLook {
  motion: 'burst' | 'rise' | 'fall' | 'swirl' | 'ring' | 'wrap';
  shape: 'shard' | 'spark' | 'petal' | 'star' | 'flake' | 'scale' | 'tag' | 'leaf';
  colors: [number, number];
  count: number;
  /** Piece size (m). */
  size: number;
}

export interface Item {
  id: string;
  kind: ItemKind;
  rarity: Rarity;
  name: [ko: string, en: string];
  source: Source;
  /** Level rewards: the level that gives it. */
  level?: number;
  /** Box items: the series. */
  series?: string;
  camo?: CamoLook;
  card?: CardLook;
  emblem?: EmblemLook;
  plate?: number;
  /** Gun skins: the gun it is for (a weapon id). */
  weapon?: string;
  skin?: GunSkinLook;
  charm?: CharmLook;
  /** Vehicle skins: the family it shows on. */
  vclass?: VehicleClass;
  vskin?: VehicleSkinLook;
  kfx?: KillFxLook;
  /** Other items that come with this one (a legendary skin's own kill effect). */
  grants?: string[];
}

/**
 * Prices (supply tickets) by rarity in the week's shop. Launch preparation 1
 * (owner, 2026-10-26): raised 10-75 % by rarity from 400 / 800 / 1,500 /
 * 3,000 / 6,000 (x1.1 / 1.25 / 1.4 / 1.55 / 1.75), and the depot from 120 %
 * to 200 % (+80 percentage points); then (owner, 2026-10-27) the depot became
 * 50 random pieces a week at 150 %.
 */
export const PRICE: Record<Rarity, number> = { common: 440, uncommon: 1000, rare: 2100, epic: 4650, legendary: 10500 };
export const DEPOT_MARKUP = 1.5;
/** The depot's stock: this many pieces of the pool a week, drawn afresh each Monday (owner, 2026-10-27). */
export const DEPOT_SIZE = 50;
/** Parts a duplicate turns into, and what the exchange asks to make one. */
export const DUP_PARTS: Record<Rarity, number> = { common: 20, uncommon: 50, rare: 150, epic: 400, legendary: 1200 };
export const CRAFT_PARTS: Record<Rarity, number> = { common: 100, uncommon: 250, rare: 750, epic: 2000, legendary: 6000 };

const items: Item[] = [];
const add = (it: Item) => items.push(it);

// ---------------------------------------------------------------------------
// Level rewards (progression.md 3-10, progression-data.md H).

const camo = (pattern: CamoLook['pattern'], colors: [number, number, number], scale = 6, extra: Partial<CamoLook> = {}): CamoLook => ({ pattern, colors, scale, ...extra });

const LEVEL_CAMOS: [number, string, string, CamoLook][] = [
  [10, '숲', 'Woodland', camo('bands', [0x4a5230, 0x2d331f, 0x6b5b3a])],
  [20, '사막', 'Desert', camo('blotch', [0xc2a878, 0x9a7f52, 0xd9c49a])],
  [30, '설원', 'Snowfield', camo('blotch', [0xe8ecef, 0xb7bec4, 0x8d959c], 5)],
  [40, '도시 회색', 'Urban grey', camo('blotch', [0x8a8d90, 0x5d6064, 0xb1b3b5], 7)],
  [50, '갈대', 'Reeds', camo('stripes', [0x8c7f52, 0x5e5534, 0xb3a46d], 9)],
  [60, '디지털 숲', 'Digital woodland', camo('digital', [0x4f5a36, 0x2f3622, 0x7a6a45], 14)],
  [70, '디지털 사막', 'Digital desert', camo('digital', [0xc8b080, 0x9c8458, 0xe0d0a6], 14)],
  [80, '야간 청색', 'Night blue', camo('blotch', [0x283247, 0x161c2a, 0x3d4a66], 6)],
  [90, '위장망', 'Camo net', camo('net', [0x56603c, 0x30361f, 0x8a7b52], 10)],
  // NCOs, every 10 levels from 하사.
  [100, '정글 잎', 'Jungle leaf', camo('blotch', [0x355a2a, 0x1f3a19, 0x6b8a3a], 8)],
  [110, '해병 디지털', 'Marine digital', camo('digital', [0x5c6b3f, 0x3a4428, 0x8f8a5c], 18)],
  [120, '붉은 사막', 'Red desert', camo('blotch', [0xb06a3e, 0x7d4426, 0xd49a6a])],
  [130, '툰드라', 'Tundra', camo('bands', [0xa7ab9a, 0x6f7462, 0xd3d5c8])],
  [140, '늪', 'Swamp', camo('blotch', [0x3f4628, 0x262b17, 0x5f5a33], 7)],
  [150, '가을 숲', 'Autumn forest', camo('bands', [0x8a5a2b, 0x4f3a1f, 0xb98a3a])],
  [160, '화산재', 'Volcanic ash', camo('blotch', [0x3a3836, 0x1f1e1d, 0x6a5f55], 6)],
  [170, '산호', 'Coral', camo('blotch', [0xd9826a, 0xa65544, 0xf0b9a0])],
  [180, '모래 폭풍', 'Sandstorm', camo('stripes', [0xb59a6a, 0x8c7448, 0xd8c39a], 4)],
  [190, '비 내린 도시', 'Rain city', camo('digital', [0x6a7480, 0x444c56, 0x9aa3ad], 16)],
  [200, '철모 녹색', 'Helmet green', camo('solid', [0x4b5a3a, 0x3a4630, 0x5d6b48])],
  // Officers, every 50 from 250.
  [250, '의장 청색', 'Ceremonial blue', camo('metal', [0x1f3a7a, 0x0f1f45, 0xc9a646], 3, { metal: 0.5 })],
  [300, '의장 흑색', 'Ceremonial black', camo('metal', [0x16161a, 0x050506, 0xc9a646], 3, { metal: 0.55 })],
  [350, '해군 백색', 'Navy white', camo('metal', [0xe9ecef, 0xb9c0c8, 0x1f3a7a], 3, { metal: 0.35 })],
  [400, '공수 적색', 'Airborne maroon', camo('metal', [0x6a1f2a, 0x3d0f16, 0xd9b45b], 3, { metal: 0.45 })],
  [450, '해병 적황', 'Marine scarlet', camo('metal', [0x9e1f1f, 0x5a0f0f, 0xe0b23a], 3, { metal: 0.45 })],
  // Generals, one a star.
  [500, '은빛 결', 'Silver grain', camo('metal', [0xc8cdd2, 0x8a9096, 0xffffff], 9, { metal: 0.9 })],
  [600, '금빛 결', 'Gold grain', camo('metal', [0xd8b052, 0x9a7a2a, 0xfff0b0], 9, { metal: 0.95 })],
  [700, '백금 결', 'Platinum grain', camo('metal', [0xe3e6ea, 0xa9b0b8, 0xffffff], 12, { metal: 1 })],
  [800, '흑금', 'Black gold', camo('obsidian', [0x111013, 0x050506, 0xd8b052], 6, { metal: 0.9, flow: 0.2 })],
  [1000, '원수', 'Marshal', camo('flow', [0x15204a, 0x0b1028, 0xe0b84a], 5, { metal: 0.85, flow: 0.4 })],
];
for (const [level, ko, en, look] of LEVEL_CAMOS) {
  const rarity: Rarity = level >= 1000 ? 'legendary' : level >= 500 ? 'epic' : level >= 250 ? 'rare' : level >= 100 ? 'uncommon' : 'common';
  add({ id: `camo.lv${level}`, kind: 'camo', rarity, name: [ko, en], source: 'level', level, camo: look });
}

const CARD_NAMES: [string, string, CardLook['motif']][] = [
  ['새벽 순찰', 'Dawn patrol', 'sun'],
  ['포연', 'Gunsmoke', 'smoke'],
  ['능선', 'Ridgeline', 'peaks'],
  ['별빛 행군', 'Starlight march', 'stars'],
  ['갈매기 편대', 'Gull flight', 'wings'],
  ['달빛 경계', 'Moon watch', 'moon'],
  ['계급장', 'Insignia', 'chevrons'],
  ['함대', 'The fleet', 'ship'],
  ['폭풍 전야', 'Before the storm', 'storm'],
  ['작전 지도', 'Op map', 'grid'],
];
const CARD_COLORS: [number, number][] = [
  [0x2a3a4f, 0x0e1520],
  [0x4a4036, 0x15120e],
  [0x34452e, 0x0f150c],
  [0x1b2140, 0x060812],
  [0x3d5468, 0x111b24],
  [0x23263a, 0x090a12],
  [0x5a4a22, 0x1a150a],
  [0x22384d, 0x0a121a],
  [0x3a3f48, 0x0c0e11],
  [0x3f4a36, 0x10140d],
];
for (let i = 0; i < 10; i++) {
  const level = 5 + i * 10;
  const [ko, en, motif] = CARD_NAMES[i]!;
  add({ id: `card.lv${level}`, kind: 'card', rarity: 'common', name: [ko, en], source: 'level', level, card: { bg: CARD_COLORS[i]!, motif, ink: 0xefebe2 } });
}
const PLATES: [string, string, number][] = [
  ['올리브', 'Olive', 0x6b7a3a],
  ['모래', 'Sand', 0xc2a878],
  ['강철', 'Steel', 0x8a96a3],
  ['해군 청', 'Navy', 0x2f5a9e],
  ['적토', 'Red earth', 0xa0522d],
  ['청록', 'Teal', 0x2a9a8f],
  ['보라', 'Purple', 0x7a4fa0],
  ['황금', 'Gold', 0xd8b052],
  ['백설', 'Snow', 0xe8ecef],
  ['칠흑', 'Pitch', 0x222226],
];
for (let i = 0; i < 10; i++) {
  const level = 7 + i * 10;
  const [ko, en, color] = PLATES[i]!;
  add({ id: `plate.lv${level}`, kind: 'plate', rarity: 'common', name: [ko, en], source: 'level', level, plate: color });
}

/** Levels the weapon unlocks and (step 7) gadget variants take; no item there. */
const OTHER_REWARD_LEVELS = new Set([1, 4, 8, 14, 22, 32, 48, 68, 88]);
const GLYPHS: [EmblemLook['glyph'], string, string][] = [
  ['eagle', '독수리', 'Eagle'],
  ['wolf', '늑대', 'Wolf'],
  ['tiger', '호랑이', 'Tiger'],
  ['bear', '곰', 'Bear'],
  ['hawk', '매', 'Hawk'],
  ['star', '별', 'Star'],
  ['bolt', '번개', 'Bolt'],
  ['sword', '검', 'Sword'],
  ['arrow', '화살', 'Arrow'],
  ['crown', '왕관', 'Crown'],
  ['flame', '불꽃', 'Flame'],
  ['leaf', '잎', 'Leaf'],
  ['mountain', '산', 'Mountain'],
  ['skull', '해골', 'Skull'],
  ['anchor', '닻', 'Anchor'],
  ['compass', '나침반', 'Compass'],
];
const SHAPES: [EmblemLook['shape'], string, string][] = [
  ['shield', '방패', 'shield'],
  ['circle', '원', 'roundel'],
  ['diamond', '마름모', 'diamond'],
  ['hex', '육각', 'hex'],
  ['star', '별꼴', 'star'],
  ['square', '사각', 'square'],
];
const EMBLEM_COLORS: [number, number, number][] = [
  [0x3a4a2a, 0xd8c890, 0x15190e],
  [0x2a3a5a, 0xe0e4ea, 0x0c1220],
  [0x5a2a2a, 0xe8c070, 0x1a0c0c],
  [0x4a4a4a, 0xf0d060, 0x141414],
  [0x2a4a4a, 0xa8e0d0, 0x0c1616],
  [0x4a3a2a, 0xe8d8b0, 0x16110c],
];
let emblemN = 0;
for (let level = 2; level <= 99; level++) {
  if (OTHER_REWARD_LEVELS.has(level) || level % 10 === 0 || level % 10 === 5 || level % 10 === 7) continue;
  const g = GLYPHS[emblemN % GLYPHS.length]!;
  const sh = SHAPES[Math.floor(emblemN / GLYPHS.length) % SHAPES.length]!;
  const colors = EMBLEM_COLORS[(emblemN * 5 + Math.floor(emblemN / GLYPHS.length)) % EMBLEM_COLORS.length]!;
  add({ id: `emblem.lv${level}`, kind: 'emblem', rarity: 'common', name: [`${g[1]} ${sh[1]}`, `${g[2]} ${sh[2]}`], source: 'level', level, emblem: { shape: sh[0], glyph: g[0], colors } });
  emblemN++;
}
// NCO cards and emblems, every 10 from 105 (cards and emblems in turn).
for (let level = 105, i = 0; level <= 205; level += 10, i++) {
  if (i % 2 === 0) {
    const [ko, en, motif] = CARD_NAMES[(i + 3) % CARD_NAMES.length]!;
    add({ id: `card.lv${level}`, kind: 'card', rarity: 'uncommon', name: [`${ko} II`, `${en} II`], source: 'level', level, card: { bg: [0x3a2f1a, 0x0d0b06], motif, ink: 0xd8b052 } });
  } else {
    const g = GLYPHS[(i * 3) % GLYPHS.length]!;
    add({ id: `emblem.lv${level}`, kind: 'emblem', rarity: 'uncommon', name: [`부사관 ${g[1]}`, `NCO ${g[2]}`], source: 'level', level, emblem: { shape: 'shield', glyph: g[0], colors: [0x2a2a2a, 0xd8b052, 0x0a0a0a] } });
  }
}
// Officers' cards every 10 from 210 (bronze up to 대위, silver from 소령), generals' every 25.
for (let level = 210; level < 500; level += 10) {
  if (level % 50 === 0 && level >= 250) continue;
  const silver = level >= 300;
  const [ko, en, motif] = CARD_NAMES[(level / 10) % CARD_NAMES.length]!;
  add({ id: `card.lv${level}`, kind: 'card', rarity: 'rare', name: [`${ko} · ${silver ? '영관' : '위관'}`, `${en} · ${silver ? 'field' : 'company'}`], source: 'level', level, card: { bg: silver ? [0x3a4048, 0x0c0e10] : [0x4a3220, 0x120c08], motif, ink: silver ? 0xd8dde3 : 0xc8925a } });
}
for (let level = 525; level < 1000; level += 25) {
  if (level % 100 === 0) continue;
  const [ko, en, motif] = CARD_NAMES[(level / 25) % CARD_NAMES.length]!;
  add({ id: `card.lv${level}`, kind: 'card', rarity: 'epic', name: [`${ko} · 장성`, `${en} · general`], source: 'level', level, card: { bg: [0x14182a, 0x05060c], motif, ink: 0xe0b84a } });
}
add({ id: 'card.lv1000', kind: 'card', rarity: 'legendary', name: ['원수', 'Marshal'], source: 'level', level: 1000, card: { bg: [0x15204a, 0x05060c], motif: 'rays', ink: 0xe0b84a, animated: true } });
add({ id: 'emblem.lv1000', kind: 'emblem', rarity: 'legendary', name: ['원수 지휘봉', "Marshal's baton"], source: 'level', level: 1000, emblem: { shape: 'star', glyph: 'crown', colors: [0x15204a, 0xe0b84a, 0x05060c], animated: true } });

// ---------------------------------------------------------------------------
// The first box series: "Pacific Fleet" (progression-data.md L; its gun / vehicle
// skins, charms and kill effects arrive with step 6, in their place here camo,
// cards and emblems of the same theme).

export const SERIES = { id: 'pacific', name: ['태평양 함대', 'Pacific Fleet'] as [string, string] };

const box = (id: string, kind: ItemKind, rarity: Rarity, ko: string, en: string, look: Partial<Item>) =>
  add({ id: `${kind}.pac.${id}`, kind, rarity, name: [ko, en], source: 'box', series: SERIES.id, ...look });
/** Items first made for the series and moved to the week pool when step 6 brought the real ones (their ids stay: people own them). */
const moved = (id: string, kind: ItemKind, rarity: Rarity, ko: string, en: string, look: Partial<Item>) =>
  add({ id: `${kind}.pac.${id}`, kind, rarity, name: [ko, en], source: 'weekly', ...look });
// Common 12.
for (const [g, ko, en] of [
  ['anchor', '닻', 'Anchor'],
  ['wave', '파도', 'Wave'],
  ['gull', '갈매기', 'Gull'],
  ['palm', '야자수', 'Palm'],
  ['coral', '산호', 'Coral'],
  ['compass', '나침반', 'Compass'],
] as const)
  box(g, 'emblem', 'common', ko, en, { emblem: { shape: 'circle', glyph: g, colors: [0x1f4a6a, 0xe8f0f0, 0x0a1a26] } });
box('teal', 'plate', 'common', '바다 청록', 'Sea teal', { plate: 0x1f8a8f });
box('sand', 'plate', 'common', '모래 베이지', 'Sand beige', { plate: 0xd9c49a });
box('horizon', 'card', 'common', '수평선', 'Horizon', { card: { bg: [0x2a5a7a, 0x0a1a26], motif: 'sun', ink: 0xf0d090 } });
box('carrier', 'card', 'common', '항모 실루엣', 'Carrier silhouette', { card: { bg: [0x3a4a5a, 0x0c1218], motif: 'carrier', ink: 0x0c1218 } });
box('lcvp', 'card', 'common', '상륙정', 'Landing craft', { card: { bg: [0x4a5a4a, 0x10160f], motif: 'boat', ink: 0x10160f } });
box('island', 'card', 'common', '야자수 섬', 'Palm island', { card: { bg: [0x2a7a8a, 0x0a2026], motif: 'palm', ink: 0x0a2026 } });
// Uncommon 8.
box('waves', 'camo', 'uncommon', '파도', 'Waves', { camo: camo('waves', [0x2a5a7a, 0x153246, 0x7ab0c8], 5) });
box('reef', 'camo', 'uncommon', '산호초', 'Reef', { camo: camo('blotch', [0x2a8a8a, 0xd9826a, 0x153246], 7) });
box('leaf', 'camo', 'uncommon', '열대 잎', 'Tropical leaf', { camo: camo('blotch', [0x2f6a2a, 0x173a14, 0x8ab04a], 6) });
box('deep', 'camo', 'uncommon', '짙은 바다', 'Deep sea', { camo: camo('bands', [0x14304a, 0x08182a, 0x2a5a7a], 5) });
moved('lighthouse', 'card', 'uncommon', '등대', 'Lighthouse', { card: { bg: [0x1a2a4a, 0x05080f], motif: 'lighthouse', ink: 0xf0e0a0 } });
moved('squall', 'card', 'uncommon', '스콜', 'Squall', { card: { bg: [0x3a4450, 0x0c0f12], motif: 'storm', ink: 0xd8e0e8 } });
moved('trident', 'emblem', 'uncommon', '삼지창', 'Trident', { emblem: { shape: 'shield', glyph: 'trident', colors: [0x153246, 0xd8b052, 0x05101a] } });
moved('seahorse', 'emblem', 'uncommon', '해마', 'Seahorse', { emblem: { shape: 'hex', glyph: 'seahorse', colors: [0x1f6a6a, 0xf0d090, 0x08201f] } });
// Rare 6.
moved('shark', 'camo', 'rare', '상어', 'Shark', { camo: camo('tiger', [0x6a7480, 0x2a3038, 0xe8ecef], 5) });
moved('dazzle', 'camo', 'rare', '다즐', 'Dazzle', { camo: camo('stripes', [0xe8ecef, 0x1a1e24, 0x6a8aa8], 3) });
moved('coralflow', 'camo', 'rare', '흐르는 산호', 'Flowing coral', { camo: camo('waves', [0xd9826a, 0x8a3a2a, 0xf0c0a0], 6, { flow: 0.3 }) });
box('fleet', 'card', 'rare', '파도 위 함대', 'Fleet at sea', { card: { bg: [0x1f4a6a, 0x05101a], motif: 'ship', ink: 0x05101a, animated: true } });
moved('kraken', 'emblem', 'rare', '크라켄', 'Kraken', { emblem: { shape: 'diamond', glyph: 'kraken', colors: [0x2a1a3a, 0xc890e0, 0x0a0610] } });
moved('gold', 'plate', 'rare', '심해 금', 'Deep gold', { plate: 0xc89a2a });
// Epic 3.
moved('ink', 'camo', 'epic', '먹물', 'Ink', { camo: camo('flow', [0x101014, 0x02020a, 0x3a3a8a], 4, { flow: 0.5, metal: 0.4 }) });
moved('typhoon', 'card', 'epic', '태풍의 눈', 'Eye of the typhoon', { card: { bg: [0x1a2a3a, 0x020508], motif: 'storm', ink: 0x8ad0f0, animated: true } });
moved('goldanchor', 'emblem', 'epic', '황금 닻', 'Golden anchor', { emblem: { shape: 'star', glyph: 'anchor', colors: [0x0a1a26, 0xe0b84a, 0x020608], animated: true } });
// Step 6: the series as planned (progression-data.md L).
box('lcvp', 'vskin', 'uncommon', '상륙정 줄무늬', 'Landing craft stripes', { vclass: 'car', vskin: { pattern: 'stripes', scale: 1.2, tones: [1.1, 0.85, 0.7] } });
box('shark', 'vskin', 'uncommon', '보트 상어 이빨', 'Boat shark mouth', { vclass: 'car', vskin: { pattern: 'tiger', scale: 1, tones: [1.2, 0.7, 0.55] } });
box('shell', 'charm', 'uncommon', '조개 부적', 'Shell charm', { charm: { shape: 'coin', color: 0xf0d8c0, accent: 0xd9826a } });
box('anchortag', 'charm', 'uncommon', '닻 인식표', 'Anchor tag', { charm: { shape: 'tag', color: 0x8a9aa8, accent: 0x1f4a6a } });
box('deckhand', 'skin', 'rare', '갑판수', 'Deckhand', { weapon: 'sg1', skin: { metal: [0x2a3440, 0.5, 0.6], pattern: { pattern: 'waves', colors: [0x2a5a7a, 0x153246, 0x7ab0c8], scale: 5 } } });
box('diver', 'skin', 'rare', '잠수 대원', 'Combat diver', { weapon: 'smg3', skin: { metal: [0x14181c, 0.6, 0.5], furniture: [0x1a2a30, 0, 0.6], engrave: { color: 0x2a8a9a } } });
box('recon', 'skin', 'rare', '해병 정찰', 'Marine recon', { weapon: 'ar4', skin: { metal: [0x3a3f2a, 0.4, 0.7], pattern: { pattern: 'digital', colors: [0x5c6b3f, 0x3a4428, 0x8f8a5c], scale: 18 } } });
box('noseart', 'vskin', 'rare', '상어 기수 그림', 'Shark nose art', { vclass: 'air', vskin: { pattern: 'tiger', scale: 0.8, tones: [1.25, 0.6, 0.5], band: true } });
box('lightning', 'vskin', 'rare', '번개 꼬리 띠', 'Lightning tail', { vclass: 'air', vskin: { pattern: 'splinter', scale: 1, tones: [1.15, 0.8, 0.6], band: true } });
box('landing', 'skin', 'epic', '해병 상륙', 'Marine landing', { weapon: 'lmg1', skin: { metal: [0x3a3f2a, 0.4, 0.7], pattern: { pattern: 'wrap', colors: [0x2a5a3a, 0x15301e, 0x7ab07a], scale: 7 } } });
box('ink', 'kfx', 'epic', '먹물', 'Ink', { kfx: { motion: 'wrap', shape: 'shard', colors: [0x06060a, 0x2a2a4a], count: 36, size: 0.06 } });
box('dazzle', 'vskin', 'epic', '구축함 다즐', 'Destroyer dazzle', { vclass: 'ship', vskin: { pattern: 'dazzle', scale: 1, tones: [1.4, 0.65, 0.45] } });
box('coral', 'skin', 'legendary', '산호 저격수', 'Coral marksman', { weapon: 'sr2', grants: ['kfx.pac.splash'], skin: { metal: [0x2a1a18, 0.7, 0.4], pattern: { pattern: 'flow', colors: [0xe8826a, 0x2a8a9a, 0xfff0d0], scale: 5, flow: 0.6, metal: 0.6 }, engrave: { color: 0xffd0b0, glow: true } } });
add({ id: 'kfx.pac.splash', kind: 'kfx', rarity: 'legendary', name: ['물보라', 'Sea spray'], source: 'box', kfx: { motion: 'burst', shape: 'flake', colors: [0x8ad0f0, 0xffffff], count: 40, size: 0.05 } });
// Legendary 1.
moved('sniper', 'camo', 'legendary', '산호 저격수', 'Coral marksman', { camo: camo('flow', [0xe8826a, 0x2a8a9a, 0xfff0d0], 5, { flow: 0.6, metal: 0.6 }) });

// ---------------------------------------------------------------------------
// The week's shop pool (its own set; eight a week, `weeklyOffer`).

const wk = (id: string, kind: ItemKind, rarity: Rarity, ko: string, en: string, look: Partial<Item>) =>
  add({ id: `${kind}.wk.${id}`, kind, rarity, name: [ko, en], source: 'weekly', ...look });
wk('tigerstripe', 'camo', 'uncommon', '호랑이 띠', 'Tiger stripe', { camo: camo('tiger', [0x5a5a32, 0x1e1e12, 0x8a7a42], 6) });
wk('ash', 'camo', 'common', '잿빛', 'Ashen', { camo: camo('blotch', [0x5a5856, 0x353331, 0x807c78]) });
wk('olive', 'camo', 'common', '진한 올리브', 'Deep olive', { camo: camo('solid', [0x4a5230, 0x3a4024, 0x5a6238]) });
wk('arctic', 'camo', 'uncommon', '북극 디지털', 'Arctic digital', { camo: camo('digital', [0xdfe6ea, 0xa8b2ba, 0x6a7680], 18) });
wk('blood', 'camo', 'rare', '핏빛 강철', 'Blood steel', { camo: camo('metal', [0x6a1a1a, 0x2a0a0a, 0xc04040], 8, { metal: 0.8 }) });
wk('night', 'camo', 'rare', '야간 작전', 'Night ops', { camo: camo('digital', [0x1a1e2a, 0x0a0c12, 0x3a4a6a], 22) });
wk('ember', 'camo', 'epic', '잉걸불', 'Embers', { camo: camo('obsidian', [0x1a1210, 0x080504, 0xff6a2a], 5, { flow: 0.35 }) });
wk('dragon', 'camo', 'legendary', '황룡', 'Yellow dragon', { camo: camo('scales', [0xc89a2a, 0x5a3a0a, 0xfff0a0], 8, { metal: 0.7, flow: 0.4 }) });
wk('dmz', 'card', 'common', '비무장지대', 'DMZ', { card: { bg: [0x3a4a2a, 0x10140a], motif: 'grid', ink: 0xd8c890 } });
wk('jets', 'card', 'uncommon', '편대 비행', 'Formation', { card: { bg: [0x2a3a5a, 0x080c16], motif: 'wings', ink: 0xe8ecef } });
wk('sunrise', 'card', 'rare', '해돋이 돌격', 'Sunrise charge', { card: { bg: [0x8a4a2a, 0x1a0a05], motif: 'rays', ink: 0xffe0a0, animated: true } });
wk('blackwolf', 'emblem', 'uncommon', '검은 늑대', 'Black wolf', { emblem: { shape: 'shield', glyph: 'wolf', colors: [0x141414, 0xe8e8e8, 0x050505] } });
wk('redtiger', 'emblem', 'rare', '붉은 호랑이', 'Red tiger', { emblem: { shape: 'circle', glyph: 'tiger', colors: [0x5a1a1a, 0xf0c060, 0x1a0505] } });
wk('phoenix', 'emblem', 'epic', '불사조', 'Phoenix', { emblem: { shape: 'star', glyph: 'flame', colors: [0x3a0a05, 0xff9a3a, 0x0a0201], animated: true } });
wk('crimson', 'plate', 'uncommon', '진홍', 'Crimson', { plate: 0xb0202a });
wk('ice', 'plate', 'common', '얼음', 'Ice', { plate: 0xa8d8e8 });

// ---------------------------------------------------------------------------
// Step 6 (progression.md 3-12, progression-data.md I / J / L): gun skins,
// charms, vehicle skins, kill effects; and a week pool big enough that the
// shop rotates through it for months (owner, 2026-10-25: "as varied as
// possible, a random rotation every week").

/** The guns a skin can be for (weapon ids; names come from the game's weapon data). */
export const SKIN_WEAPONS = [
  'ar1', 'ar2', 'ar3', 'ar4', 'smg1', 'smg2', 'smg3', 'smg4', 'lmg1', 'lmg2', 'lmg3',
  'sg1', 'sg2', 'sg3', 'dmr1', 'dmr2', 'dmr3', 'sr1', 'sr2', 'sr3', 'pistol1', 'pistol2', 'pistol3',
] as const;

/** Vehicle skin families: the driver's skin shows on any vehicle of the family, inside its side's colours. */
export type VehicleClass = 'armor' | 'car' | 'air' | 'ship';
export const VEHICLE_CLASSES: readonly VehicleClass[] = ['armor', 'car', 'air', 'ship'];

// One theme a gun skin; every gun gets each theme the week pool offers.
const S = (metal?: [number, number, number], furniture?: [number, number, number], extra: Partial<GunSkinLook> = {}): GunSkinLook => ({ ...(metal ? { metal } : {}), ...(furniture ? { furniture } : {}), ...extra });
const SKIN_THEMES: [id: string, ko: string, en: string, rarity: Rarity, look: GunSkinLook][] = [
  // Rare: colour and finish.
  ['night', '야간 작전', 'Night ops', 'rare', S([0x16171a, 0.35, 0.85], [0x0e0f11, 0, 0.92], { steel: [0x121315, 0.5, 0.8] })],
  ['hunter', '사냥꾼', 'Hunter', 'rare', S([0x2a2522, 0.6, 0.5], undefined, { wood: 0x8a5a32 })],
  ['police', '경찰 특공', 'Police tactical', 'rare', S([0x1b1f26, 0.5, 0.6], [0x101318, 0, 0.8])],
  ['urban', '도시 회색', 'Urban grey', 'rare', S([0x55585c, 0.45, 0.7], undefined, { pattern: camo('digital', [0x7a7e83, 0x4a4d52, 0xa9adb2], 18) })],
  ['jungle', '정글', 'Jungle', 'rare', S(undefined, undefined, { pattern: camo('blotch', [0x355a2a, 0x1f3a19, 0x6b8a3a], 9) })],
  ['olive', '올리브 드랩', 'Olive drab', 'rare', S([0x3a3f26, 0.4, 0.75], [0x4b5320, 0, 0.85])],
  ['fde', '사막 탄', 'Flat dark earth', 'rare', S([0x5e5242, 0.4, 0.7], [0x9c8460, 0, 0.85])],
  ['arctic', '설원 흰색', 'Arctic white', 'rare', S([0xd8dadc, 0.3, 0.6], [0xe6e8ea, 0, 0.85])],
  ['navy', '해군 청색', 'Navy blue', 'rare', S([0x1a2436, 0.5, 0.55], [0x1d2f4a, 0, 0.8])],
  ['crimson', '진홍', 'Crimson', 'rare', S([0x24181a, 0.5, 0.6], [0x6a1418, 0, 0.75])],
  ['sage', '세이지', 'Sage', 'rare', S([0x4a5048, 0.4, 0.7], [0x7d8a72, 0, 0.85])],
  ['plum', '자두', 'Plum', 'rare', S([0x2a1e2a, 0.5, 0.6], [0x4a2a4a, 0, 0.8])],
  // Epic: material and pattern.
  ['desertsof', '사막 특수전', 'Desert operator', 'epic', S([0x8a7a5a, 0.4, 0.6], undefined, { pattern: camo('splinter', [0xb59a6a, 0x8c7448, 0xd8c39a], 7), finish: { wear: 0.5, scratch: 0.5 } })],
  ['titanium', '티타늄', 'Titanium', 'epic', S([0x9aa0a6, 0.95, 0.35], [0x2a2c30, 0, 0.8], { steel: [0x7a8086, 0.95, 0.3], finish: { wear: 0.25, scratch: 0.8, irid: 0.25 } })],
  ['marine', '해병 상륙', 'Marine landing', 'epic', S([0x3a3f2a, 0.4, 0.7], undefined, { pattern: camo('wrap', [0x5c6b3f, 0x3a4428, 0x8f8a5c], 7), finish: { wear: 0.6, scratch: 0.4 } })],
  ['winter', '설원 저격수', 'Winter marksman', 'epic', S([0xc8ccd0, 0.3, 0.6], undefined, { pattern: camo('wrap', [0xe8ecef, 0xb7bec4, 0x8d959c], 7), finish: { wear: 0.45, scratch: 0.3 } })],
  ['carbon', '카본', 'Carbon', 'epic', S([0x1a1b1d, 0.6, 0.45], undefined, { pattern: camo('carbon', [0x2a2b2e, 0x101113, 0x3c3e42], 60), finish: { coat: 0.9, scratch: 0.2 } })],
  ['tiger', '호랑이', 'Tiger', 'epic', S([0x1a1612, 0.5, 0.6], undefined, { pattern: camo('tiger', [0xd8822a, 0x120c08, 0xf0b060], 6), finish: { coat: 0.5, wear: 0.3 } })],
  ['officer', '장교', 'Officer', 'epic', S([0x2a2c30, 0.8, 0.4], [0xe8dcc0, 0, 0.5], { engrave: { color: 0xd8dde3 }, finish: { coat: 0.6, scratch: 0.3 } })],
  ['ghost', '유령', 'Ghost', 'epic', S([0x1e2a2c, 0.5, 0.6], undefined, { pattern: camo('hex', [0x2a4a4e, 0x0e1a1c, 0x5aa0a8], 14), finish: { coat: 0.3, wear: 0.2, scratch: 0.4 } })],
  ['rust', '녹슨 강철', 'Rusted steel', 'epic', S([0x6a3a20, 0.7, 0.8], undefined, { pattern: camo('blotch', [0x8a4a22, 0x4a2410, 0xb07040], 12, { metal: 0.5 }), finish: { wear: 0.9, scratch: 0.6 } })],
  ['bone', '뼈', 'Bone', 'epic', S([0xc8b898, 0.3, 0.6], [0xe0d4b8, 0, 0.6], { engrave: { color: 0x5a4a32 }, finish: { wear: 0.4, scratch: 0.5 } })],
  // Legendary: moving patterns, engraving that glows.
  ['walnut', '호두나무 각인', 'Engraved walnut', 'legendary', S([0x2a2420, 0.85, 0.35], undefined, { wood: 0x5a3218, engrave: { color: 0xd8b052 }, finish: { coat: 0.7, wear: 0.15 } })],
  ['gold', '황금', 'Gold', 'legendary', S([0xd4a440, 1, 0.25], [0x161618, 0, 0.6], { steel: [0xb08a3e, 1, 0.3], engrave: { color: 0x5a3a0a }, finish: { coat: 0.8, scratch: 0.25 } })],
  ['reddragon', '붉은 용', 'Red dragon', 'legendary', S([0x2a0a0a, 0.7, 0.4], undefined, { pattern: camo('scales', [0xb0201a, 0x3a0505, 0xffb060], 28, { metal: 0.6, flow: 0.5 }), engrave: { color: 0xff6a3a, glow: true }, finish: { coat: 1, irid: 0.3 }, muzzle: 'dragon' })],
  ['aurora', '오로라', 'Aurora', 'legendary', S([0x101820, 0.6, 0.4], undefined, { pattern: camo('flow', [0x2ad0a0, 0x0a1430, 0xb060ff], 5, { flow: 0.6, metal: 0.4 }), engrave: { color: 0x6af0ff, glow: true }, finish: { coat: 1, irid: 0.8 }, muzzle: 'fin' })],
  ['blackflame', '흑염', 'Black flame', 'legendary', S([0x0e0c0c, 0.6, 0.5], undefined, { pattern: camo('obsidian', [0x141010, 0x050404, 0xff4a1a], 6, { flow: 0.4 }), engrave: { color: 0xff7a2a, glow: true }, finish: { coat: 0.8, irid: 0.2 }, muzzle: 'crown' })],
  ['frost', '서리', 'Frost', 'legendary', S([0xb8d0e0, 0.9, 0.3], undefined, { pattern: camo('flow', [0xe0f4ff, 0x6a9ac8, 0xffffff], 6, { flow: 0.3, metal: 0.7 }), engrave: { color: 0x9ae0ff, glow: true }, finish: { coat: 1, irid: 0.5, scratch: 0.2 }, muzzle: 'crystal' })],
];
/**
 * Which theme / gun pairs the shop sells (owner, 2026-10-27: "fewer, each made
 * with care"): plain colour finishes on every gun, each epic theme on the
 * three guns it suits, each legendary on one gun. The other pairs stay
 * defined (players who bought them keep them) but are in the vault. Pattern
 * themes stay off the bolt rifles and pistols: in first person those are
 * scanned models, which wear a skin's colours but not its pattern.
 */
const SOLD_ON: Record<string, readonly string[] | 'all'> = {
  night: 'all', hunter: 'all', urban: 'all', jungle: 'all', olive: 'all', fde: 'all', arctic: 'all', navy: 'all',
  desertsof: ['ar1', 'ar4', 'smg4'],
  titanium: ['sg3', 'dmr2', 'pistol1'],
  marine: ['lmg3', 'ar3', 'sg1'],
  winter: ['dmr3', 'dmr2', 'lmg1'],
  carbon: ['smg2', 'smg1', 'smg3'],
  tiger: ['ar2', 'smg4', 'lmg3'],
  officer: ['pistol1', 'pistol2', 'dmr1'],
  ghost: ['smg1', 'smg3', 'ar4'],
  rust: ['ar2', 'lmg2', 'sg2'],
  bone: ['sr3', 'dmr3', 'lmg1'],
  reddragon: ['ar2'],
  gold: ['pistol2'],
  aurora: ['dmr1'],
  frost: ['lmg2'],
  walnut: ['sr1'],
  blackflame: ['smg4'],
};
const sold = (theme: string, w: string) => {
  const on = SOLD_ON[theme];
  return on === 'all' || !!on?.includes(w);
};
for (const [theme, ko, en, rarity, look] of SKIN_THEMES)
  for (const w of SKIN_WEAPONS) add({ id: `skin.${theme}.${w}`, kind: 'skin', rarity, name: [ko, en], source: sold(theme, w) ? 'weekly' : 'vault', weapon: w, skin: look });

// Charms: hung off the left of the receiver (the first-person gun and the pictures).
const CHARMS: [id: string, ko: string, en: string, rarity: Rarity, look: CharmLook][] = [
  ['tag', '인식표', 'Dog tag', 'common', { shape: 'tag', color: 0xb8bcc0, accent: 0x2a2c30 }],
  ['die', '주사위', 'Lucky die', 'common', { shape: 'die', color: 0xe8e4dc, accent: 0x1a1a1a }],
  ['shell', '탄피', 'Spent casing', 'common', { shape: 'bullet', color: 0xb08a3e, accent: 0x6a4a1a }],
  ['coin', '행운 동전', 'Lucky coin', 'common', { shape: 'coin', color: 0xc8a050, accent: 0x6a4a1a }],
  ['clover', '네잎클로버', 'Four-leaf clover', 'uncommon', { shape: 'leaf', color: 0x3a8a3a, accent: 0x1a3a1a }],
  ['star', '붉은 별', 'Red star', 'uncommon', { shape: 'star', color: 0xc0201a, accent: 0xf0d060 }],
  ['skull', '해골', 'Skull', 'uncommon', { shape: 'skull', color: 0xe8e0cc, accent: 0x1a1a1a }],
  ['heart', '하트', 'Heart', 'uncommon', { shape: 'heart', color: 0xd02a4a, accent: 0x6a0a1a }],
  ['bolt', '번개', 'Lightning', 'uncommon', { shape: 'bolt', color: 0xf0c020, accent: 0x5a4008 }],
  ['ball', '야구공', 'Baseball', 'uncommon', { shape: 'ball', color: 0xf0ece4, accent: 0xc0201a }],
  ['fish', '물고기', 'Fish', 'uncommon', { shape: 'fish', color: 0x4a8ac0, accent: 0x1a3a5a }],
  ['bear', '곰 인형', 'Teddy bear', 'rare', { shape: 'bear', color: 0x8a5a32, accent: 0x2a1a0a }],
  ['grenade', '수류탄 모형', 'Mini grenade', 'rare', { shape: 'grenade', color: 0x4a5230, accent: 0x2a2c20 }],
  ['ring', '반지', 'Ring', 'rare', { shape: 'ring', color: 0xd8b052, accent: 0x6af0ff }],
  ['cube', '수정 큐브', 'Crystal cube', 'rare', { shape: 'cube', color: 0x8ad0f0, accent: 0xffffff }],
  ['goldskull', '황금 해골', 'Gold skull', 'epic', { shape: 'skull', color: 0xd8b052, accent: 0x3a2a0a }],
  ['diamond', '다이아몬드', 'Diamond', 'epic', { shape: 'cube', color: 0xe0f4ff, accent: 0x9ad0ff }],
  ['goldtag', '황금 인식표', 'Gold dog tag', 'epic', { shape: 'tag', color: 0xd8b052, accent: 0x5a3a0a }],
  ['dragoneye', '용의 눈', "Dragon's eye", 'legendary', { shape: 'ball', color: 0xff5a1a, accent: 0xffe08a, glow: true }],
  ['starheart', '별의 심장', 'Star heart', 'legendary', { shape: 'star', color: 0x8ae0ff, accent: 0xffffff, glow: true }],
];
for (const [id, ko, en, rarity, look] of CHARMS) add({ id: `charm.${id}`, kind: 'charm', rarity, name: [ko, en], source: 'weekly', charm: look });

// Vehicle skins: a family (armor, cars and boats, aircraft, warships), a pattern and tones inside the side's colours.
const V = (pattern: VehicleSkinLook['pattern'], scale: number, tones: [number, number, number], band = false): VehicleSkinLook => ({ pattern, scale, tones, ...(band ? { band } : {}) });
const VSKINS: [id: string, ko: string, en: string, rarity: Rarity, look: VehicleSkinLook][] = [
  ['bands', '띠무늬', 'Bands', 'uncommon', V('bands', 1, [1, 1, 1])],
  ['clouds', '구름무늬', 'Clouds', 'uncommon', V('clouds', 0.8, [1.05, 0.95, 1])],
  ['stripes', '줄무늬', 'Stripes', 'uncommon', V('stripes', 1, [1, 0.9, 1.1])],
  ['digital', '디지털', 'Digital', 'rare', V('digital', 1.4, [1, 1, 0.9])],
  ['splinter', '파편무늬', 'Splinter', 'rare', V('splinter', 1, [1.1, 0.9, 0.85])],
  ['tiger', '호랑이 무늬', 'Tiger', 'rare', V('tiger', 1, [1.1, 0.8, 0.7])],
  ['shadow', '그림자', 'Shadow', 'rare', V('blotch', 0.7, [0.75, 0.7, 0.6])],
  ['sun', '햇빛 바랜', 'Sun-bleached', 'rare', V('blotch', 0.9, [1.3, 1.2, 1.15])],
  ['dazzle', '다즐', 'Dazzle', 'epic', V('dazzle', 1, [1.35, 0.7, 0.5])],
  ['banded', '지휘차 띠', "Commander's band", 'epic', V('clouds', 1, [1, 1, 1], true)],
  ['ace', '에이스', 'Ace', 'epic', V('splinter', 1.2, [1.2, 0.75, 0.55], true)],
];
for (const cls of VEHICLE_CLASSES)
  for (const [id, ko, en, rarity, look] of VSKINS) add({ id: `vskin.${id}.${cls}`, kind: 'vskin', rarity, name: [ko, en], source: 'weekly', vclass: cls, vskin: look });

// Kill effects (progression-data.md I): short, small, no light; drawn by `render/killEffects.ts`.
const K = (motion: KillFxLook['motion'], shape: KillFxLook['shape'], colors: [number, number], count = 28, size = 0.06): KillFxLook => ({ motion, shape, colors, count, size });
const KFX: [id: string, ko: string, en: string, rarity: Rarity, source: Source, level: number | undefined, look: KillFxLook][] = [
  ['ash', '재', 'Ash', 'epic', 'level', 500, K('fall', 'shard', [0x4a4846, 0x9a9690], 40)],
  ['silverfall', '은빛 별똥', 'Silver streaks', 'epic', 'level', 600, K('rise', 'spark', [0xd8dde3, 0xffffff], 18, 0.09)],
  ['laurel', '금빛 월계', 'Golden laurel', 'epic', 'level', 700, K('ring', 'leaf', [0xd8b052, 0xfff0b0], 24, 0.07)],
  ['dogtags', '인식표', 'Dog tags', 'epic', 'level', 800, K('fall', 'tag', [0xb8bcc0, 0xe8ecef], 10, 0.08)],
  ['starlight', '별빛', 'Starlight', 'legendary', 'level', 1000, K('burst', 'star', [0xe0b84a, 0xffffff], 5, 0.14)],
  ['sparks', '불티', 'Sparks', 'epic', 'weekly', undefined, K('burst', 'spark', [0xff7a2a, 0xffd060], 36, 0.04)],
  ['electric', '전기', 'Electric', 'legendary', 'weekly', undefined, K('wrap', 'spark', [0x4ab0ff, 0xd0f0ff], 40, 0.05)],
  ['confetti', '금빛 조각', 'Gold confetti', 'epic', 'weekly', undefined, K('rise', 'shard', [0xd8b052, 0xfff0b0], 40, 0.05)],
  ['petals', '꽃잎', 'Petals', 'rare', 'weekly', undefined, K('fall', 'petal', [0xf0a0b8, 0xffe0e8], 16, 0.06)],
  ['frost', '얼음', 'Frost', 'epic', 'weekly', undefined, K('wrap', 'flake', [0xc8ecff, 0xffffff], 30, 0.05)],
  ['leaves', '낙엽', 'Falling leaves', 'rare', 'weekly', undefined, K('fall', 'leaf', [0xb06a2a, 0xe0a040], 14, 0.07)],
  ['embers', '잉걸불', 'Embers', 'rare', 'weekly', undefined, K('rise', 'spark', [0xff4a1a, 0xffa040], 26, 0.035)],
  ['smokepuff', '연기 고리', 'Smoke ring', 'rare', 'weekly', undefined, K('ring', 'shard', [0x5a5a5a, 0xa0a0a0], 30, 0.06)],
  ['bubbles', '거품', 'Bubbles', 'rare', 'weekly', undefined, K('rise', 'flake', [0x8ad0f0, 0xe0f8ff], 22, 0.05)],
  ['hearts', '하트', 'Hearts', 'epic', 'weekly', undefined, K('rise', 'petal', [0xff4a7a, 0xffb0c8], 12, 0.08)],
  ['void', '공허', 'Void', 'legendary', 'weekly', undefined, K('swirl', 'shard', [0x2a0a4a, 0xb060ff], 40, 0.05)],
  ['goldrush', '황금 소나기', 'Gold rush', 'legendary', 'weekly', undefined, K('burst', 'star', [0xffd060, 0xfff8d0], 14, 0.08)],
];
for (const [id, ko, en, rarity, source, level, look] of KFX) add({ id: `kfx.${id}`, kind: 'kfx', rarity, name: [ko, en], source, ...(level ? { level } : {}), kfx: look });
// The blue dragon challenge (all 23 guns in obsidian) brings its own effect.
add({ id: 'kfx.dragonscale', kind: 'kfx', rarity: 'legendary', name: ['청룡 비늘', 'Dragon scales'], source: 'challenge', kfx: K('swirl', 'scale', [0x1a5aa8, 0x8ae0ff], 30, 0.07) });

// Level rewards (progression.md 3-12): a gun skin every 50 levels from 100 (+ the officer's M1911 at 210), a vehicle skin every 50 from 250.
const LEVEL_SKIN_ORDER: [theme: string, weapon: string][] = [
  ['olive', 'ar1'], ['fde', 'smg1'], ['hunter', 'sr1'], ['urban', 'lmg1'], ['night', 'pistol1'], ['jungle', 'ar2'], ['navy', 'dmr1'], ['sage', 'sg1'],
  ['police', 'smg2'], ['crimson', 'ar3'], ['arctic', 'sr3'], ['desertsof', 'ar4'], ['marine', 'lmg3'], ['carbon', 'smg4'], ['titanium', 'dmr2'],
  ['ghost', 'sg2'], ['tiger', 'ar1'], ['winter', 'dmr3'],
];
LEVEL_SKIN_ORDER.forEach(([theme, w], i) => {
  const level = 100 + i * 50;
  if (level > 950) return;
  const look = SKIN_THEMES.find((x) => x[0] === theme)!;
  add({ id: `skin.lv${level}`, kind: 'skin', rarity: look[3], name: [look[1], look[2]], source: 'level', level, weapon: w, skin: look[4] });
});
add({ id: 'skin.lv210', kind: 'skin', rarity: 'legendary', name: ['장교 권총', "Officer's sidearm"], source: 'level', level: 210, weapon: 'pistol2', skin: S([0x2a2c30, 0.85, 0.35], [0xe8dcc0, 0, 0.45], { engrave: { color: 0xd8b052 } }) });
add({ id: 'skin.lv1000', kind: 'skin', rarity: 'legendary', name: ['원수의 총', "Marshal's rifle"], source: 'level', level: 1000, weapon: 'ar1', skin: S([0x15204a, 0.9, 0.3], undefined, { pattern: camo('flow', [0x15204a, 0x0b1028, 0xe0b84a], 5, { metal: 0.85, flow: 0.4 }), engrave: { color: 0xe0b84a, glow: true } }) });
for (let level = 250, i = 0; level <= 950; level += 50, i++) {
  const [id, ko, en, rarity, look] = VSKINS[i % VSKINS.length]!;
  const cls = VEHICLE_CLASSES[i % VEHICLE_CLASSES.length]!;
  add({ id: `vskin.lv${level}`, kind: 'vskin', rarity, name: [`${ko} (${level})`, `${en} (${level})`], source: 'level', level, vclass: cls, vskin: look });
  void id;
}

// More of the week pool: camos, cards, emblems and name plates by combination (seeded, so every build has the same ids).
const WK_PALETTES: [string, string, [number, number, number]][] = [
  ['가을', 'Autumn', [0x8a5a2b, 0x4f3a1f, 0xb98a3a]],
  ['해안', 'Coastal', [0x8a9a8a, 0x4a5a5a, 0xc8c8b0]],
  ['황무지', 'Badlands', [0x9a6a4a, 0x5a3a2a, 0xc89a70]],
  ['소나무', 'Pine', [0x2f4a2a, 0x18261a, 0x5a6a3a]],
  ['석탄', 'Coal', [0x2a2a2c, 0x121214, 0x4a4a4e]],
  ['라벤더', 'Lavender', [0x7a6a9a, 0x4a3a6a, 0xb0a0d0]],
  ['산호초', 'Reef', [0x2a8a8a, 0xd9826a, 0x153246]],
  ['사바나', 'Savanna', [0xb89a5a, 0x7a6a3a, 0xd8c890]],
  ['빙하', 'Glacier', [0xc8e0ea, 0x7aa0b8, 0xf0f8ff]],
  ['화산', 'Volcano', [0x3a1a14, 0x120806, 0xc0401a]],
  ['이끼', 'Moss', [0x4a5a2a, 0x2a3418, 0x7a8a4a]],
  ['황혼', 'Dusk', [0x5a3a5a, 0x2a1a2a, 0xd88a5a]],
  ['청동', 'Bronze', [0x8a6a3a, 0x4a3418, 0xc8a060]],
  ['안개', 'Mist', [0x9aa0a6, 0x6a7076, 0xc8ccd0]],
  ['적설', 'Red snow', [0xe8e0dc, 0xb04a3a, 0x8a8a8a]],
  ['밀림', 'Rainforest', [0x1f4a2a, 0x0a2014, 0x4a8a3a]],
];
const WK_PATTERNS: [CamoLook['pattern'], string, string, Rarity, number][] = [
  ['blotch', '얼룩', 'blotch', 'common', 7],
  ['bands', '띠', 'bands', 'common', 6],
  ['digital', '디지털', 'digital', 'uncommon', 16],
  ['stripes', '줄', 'stripes', 'uncommon', 5],
  ['splinter', '파편', 'splinter', 'uncommon', 7],
  ['hex', '육각', 'hex', 'rare', 12],
  ['tiger', '호랑이', 'tiger', 'rare', 6],
  ['waves', '물결', 'waves', 'rare', 5],
];
WK_PALETTES.forEach(([pko, pen, colors], i) => {
  // Three patterns a palette, stepping through the list so the pool covers every pattern.
  for (let k = 0; k < 3; k++) {
    const [pat, ko, en, rarity, scale] = WK_PATTERNS[(i * 3 + k) % WK_PATTERNS.length]!;
    add({ id: `camo.wk.${pat}${i}`, kind: 'camo', rarity, name: [`${pko} ${ko}`, `${pen} ${en}`], source: 'weekly', camo: camo(pat, colors, scale) });
  }
});
const WK_MOTIFS: CardLook['motif'][] = ['sun', 'ship', 'carrier', 'boat', 'palm', 'waves', 'peaks', 'stars', 'chevrons', 'rays', 'grid', 'moon', 'smoke', 'wings', 'lighthouse', 'storm'];
const WK_MOTIF_NAMES: Record<CardLook['motif'], [string, string]> = {
  sun: ['노을', 'Sunset'], ship: ['호위함', 'Escort'], carrier: ['기동 함대', 'Task force'], boat: ['상륙', 'Landing'], palm: ['남쪽 섬', 'South isle'],
  waves: ['파고', 'Swell'], peaks: ['고지', 'High ground'], stars: ['밤하늘', 'Night sky'], chevrons: ['돌격', 'Charge'], rays: ['여명', 'First light'],
  grid: ['좌표', 'Grid ref'], moon: ['달밤', 'Moonlit'], smoke: ['포격', 'Barrage'], wings: ['제공권', 'Air cover'], lighthouse: ['등대지기', 'Keeper'], storm: ['뇌우', 'Thunder'],
};
WK_PALETTES.slice(0, 12).forEach(([pko, pen, c], i) => {
  for (let k = 0; k < 2; k++) {
    const motif = WK_MOTIFS[(i * 2 + k) % WK_MOTIFS.length]!;
    const [mko, men] = WK_MOTIF_NAMES[motif];
    const rarity: Rarity = k === 1 && i % 3 === 0 ? 'rare' : i % 2 ? 'uncommon' : 'common';
    add({ id: `card.wk.${motif}${i}`, kind: 'card', rarity, name: [`${mko} · ${pko}`, `${men} · ${pen}`], source: 'weekly', card: { bg: [c[0], c[1]], motif, ink: c[2], ...(rarity === 'rare' ? { animated: true } : {}) } });
  }
});
const WK_GLYPHS = GLYPHS.concat([
  ['trident', '삼지창', 'Trident'],
  ['seahorse', '해마', 'Seahorse'],
  ['kraken', '크라켄', 'Kraken'],
  ['wave', '파도', 'Wave'],
  ['gull', '갈매기', 'Gull'],
  ['palm', '야자수', 'Palm'],
  ['coral', '산호', 'Coral'],
]);
WK_GLYPHS.forEach(([glyph, ko, en], i) => {
  for (let k = 0; k < 2; k++) {
    const sh = SHAPES[(i + k * 3) % SHAPES.length]!;
    const p = WK_PALETTES[(i * 2 + k) % WK_PALETTES.length]!;
    const rarity: Rarity = (i + k) % 7 === 0 ? 'rare' : (i + k) % 3 === 0 ? 'uncommon' : 'common';
    add({ id: `emblem.wk.${glyph}${k}`, kind: 'emblem', rarity, name: [`${p[0]} ${ko}`, `${p[1]} ${en}`], source: 'weekly', emblem: { shape: sh[0], glyph, colors: [p[2][1], p[2][2], 0x0a0a0a], ...(rarity === 'rare' ? { animated: true } : {}) } });
  }
});
WK_PALETTES.forEach(([ko, en, c], i) => {
  add({ id: `plate.wk.p${i}`, kind: 'plate', rarity: i % 4 === 0 ? 'uncommon' : 'common', name: [ko, en], source: 'weekly', plate: c[2] });
});

/** Week-shop bundles: a theme's pieces together at 75 %. */
export const BUNDLES: { id: string; name: [string, string]; items: string[] }[] = [
  { id: 'night', name: ['야간 작전 묶음', 'Night ops bundle'], items: ['camo.wk.night', 'card.wk.jets', 'emblem.wk.blackwolf'] },
  { id: 'fire', name: ['불의 묶음', 'Fire bundle'], items: ['camo.wk.ember', 'card.wk.sunrise', 'emblem.wk.phoenix'] },
  { id: 'tiger', name: ['호랑이 묶음', 'Tiger bundle'], items: ['camo.wk.tigerstripe', 'emblem.wk.redtiger', 'plate.wk.crimson'] },
  { id: 'operator', name: ['특수전 묶음', 'Operator bundle'], items: ['skin.desertsof.ar1', 'charm.skull', 'kfx.smokepuff'] },
  { id: 'arctic', name: ['북극 묶음', 'Arctic bundle'], items: ['skin.winter.dmr3', 'kfx.frost', 'vskin.sun.armor'] },
  { id: 'gold', name: ['황금 묶음', 'Gold bundle'], items: ['skin.gold.pistol2', 'charm.goldtag', 'kfx.goldrush'] },
  { id: 'dragon', name: ['붉은 용 묶음', 'Red dragon bundle'], items: ['skin.reddragon.ar2', 'charm.dragoneye', 'kfx.embers'] },
  { id: 'ghost', name: ['유령 묶음', 'Ghost bundle'], items: ['skin.ghost.smg1', 'kfx.void', 'vskin.shadow.car'] },
  { id: 'carbon', name: ['카본 묶음', 'Carbon bundle'], items: ['skin.carbon.smg2', 'charm.cube', 'vskin.digital.armor'] },
  { id: 'hunter', name: ['사냥꾼 묶음', 'Hunter bundle'], items: ['skin.hunter.sr3', 'charm.bear', 'kfx.leaves'] },
  { id: 'officer', name: ['장교 묶음', "Officer's bundle"], items: ['skin.officer.pistol1', 'charm.ring', 'kfx.confetti'] },
  { id: 'aurora', name: ['오로라 묶음', 'Aurora bundle'], items: ['skin.aurora.dmr1', 'charm.starheart', 'kfx.electric'] },
  { id: 'ace', name: ['에이스 묶음', 'Ace bundle'], items: ['vskin.ace.air', 'vskin.banded.armor', 'charm.star'] },
  { id: 'navy', name: ['해군 묶음', 'Navy bundle'], items: ['skin.navy.sg2', 'vskin.dazzle.ship', 'charm.fish'] },
  { id: 'frost', name: ['서리 묶음', 'Frost bundle'], items: ['skin.frost.lmg2', 'kfx.bubbles', 'charm.diamond'] },
];
export const BUNDLE_SHARE = 0.75;

// ---------------------------------------------------------------------------

export const ITEMS: readonly Item[] = items;
const BY_ID = new Map(items.map((i) => [i.id, i]));

export function item(id: string): Item | undefined {
  return BY_ID.get(id);
}

/** The items a level gives (an empty list for most levels above 99). */
export function levelRewards(level: number): Item[] {
  return items.filter((i) => i.source === 'level' && i.level === level);
}

/** The current box series' items. */
export function seriesItems(series = SERIES.id): Item[] {
  return items.filter((i) => i.series === series);
}

export function weeklyPool(): Item[] {
  return items.filter((i) => i.source === 'weekly');
}

/** A bundle's price (75 % of its items). */
export function bundlePrice(b: (typeof BUNDLES)[number]): number {
  return Math.round(b.items.reduce((a, id) => a + PRICE[item(id)!.rarity], 0) * BUNDLE_SHARE);
}
