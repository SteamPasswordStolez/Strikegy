/**
 * Every cosmetic the progression hands out or sells (progression step 5;
 * progression.md 3-5 / 3-10 / 3-11, progression-data.md B / H / L): shared
 * camouflage for every gun, player cards, emblems and name plate colours.
 * All drawn in code from the parameters here (no picture files): camo by the
 * gun shader (`camoMaterial`), cards and emblems on a canvas / SVG
 * (`ui/cosmetics.ts`). Gun skins, vehicle skins, kill effects and charms come
 * in step 6. Import-free (the server reads it).
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export type ItemKind = 'camo' | 'card' | 'emblem' | 'plate';
export type Source = 'level' | 'box' | 'weekly' | 'challenge';

/** A camo pattern for the gun shader. */
export interface CamoLook {
  pattern: 'solid' | 'blotch' | 'bands' | 'stripes' | 'digital' | 'tiger' | 'net' | 'metal' | 'obsidian' | 'scales' | 'waves' | 'flow';
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
}

/** Prices (supply tickets) by rarity: the week's shop; the depot asks 120 %. */
export const PRICE: Record<Rarity, number> = { common: 400, uncommon: 800, rare: 1500, epic: 3000, legendary: 6000 };
export const DEPOT_MARKUP = 1.2;
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
box('lighthouse', 'card', 'uncommon', '등대', 'Lighthouse', { card: { bg: [0x1a2a4a, 0x05080f], motif: 'lighthouse', ink: 0xf0e0a0 } });
box('squall', 'card', 'uncommon', '스콜', 'Squall', { card: { bg: [0x3a4450, 0x0c0f12], motif: 'storm', ink: 0xd8e0e8 } });
box('trident', 'emblem', 'uncommon', '삼지창', 'Trident', { emblem: { shape: 'shield', glyph: 'trident', colors: [0x153246, 0xd8b052, 0x05101a] } });
box('seahorse', 'emblem', 'uncommon', '해마', 'Seahorse', { emblem: { shape: 'hex', glyph: 'seahorse', colors: [0x1f6a6a, 0xf0d090, 0x08201f] } });
// Rare 6.
box('shark', 'camo', 'rare', '상어', 'Shark', { camo: camo('tiger', [0x6a7480, 0x2a3038, 0xe8ecef], 5) });
box('dazzle', 'camo', 'rare', '다즐', 'Dazzle', { camo: camo('stripes', [0xe8ecef, 0x1a1e24, 0x6a8aa8], 3) });
box('coralflow', 'camo', 'rare', '흐르는 산호', 'Flowing coral', { camo: camo('waves', [0xd9826a, 0x8a3a2a, 0xf0c0a0], 6, { flow: 0.3 }) });
box('fleet', 'card', 'rare', '파도 위 함대', 'Fleet at sea', { card: { bg: [0x1f4a6a, 0x05101a], motif: 'ship', ink: 0x05101a, animated: true } });
box('kraken', 'emblem', 'rare', '크라켄', 'Kraken', { emblem: { shape: 'diamond', glyph: 'kraken', colors: [0x2a1a3a, 0xc890e0, 0x0a0610] } });
box('gold', 'plate', 'rare', '심해 금', 'Deep gold', { plate: 0xc89a2a });
// Epic 3.
box('ink', 'camo', 'epic', '먹물', 'Ink', { camo: camo('flow', [0x101014, 0x02020a, 0x3a3a8a], 4, { flow: 0.5, metal: 0.4 }) });
box('typhoon', 'card', 'epic', '태풍의 눈', 'Eye of the typhoon', { card: { bg: [0x1a2a3a, 0x020508], motif: 'storm', ink: 0x8ad0f0, animated: true } });
box('goldanchor', 'emblem', 'epic', '황금 닻', 'Golden anchor', { emblem: { shape: 'star', glyph: 'anchor', colors: [0x0a1a26, 0xe0b84a, 0x020608], animated: true } });
// Legendary 1.
box('sniper', 'camo', 'legendary', '산호 저격수', 'Coral marksman', { camo: camo('flow', [0xe8826a, 0x2a8a9a, 0xfff0d0], 5, { flow: 0.6, metal: 0.6 }) });

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

/** Week-shop bundles: a theme's camo, card and emblem together at 75 %. */
export const BUNDLES: { id: string; name: [string, string]; items: string[] }[] = [
  { id: 'night', name: ['야간 작전 묶음', 'Night ops bundle'], items: ['camo.wk.night', 'card.wk.jets', 'emblem.wk.blackwolf'] },
  { id: 'fire', name: ['불의 묶음', 'Fire bundle'], items: ['camo.wk.ember', 'card.wk.sunrise', 'emblem.wk.phoenix'] },
  { id: 'tiger', name: ['호랑이 묶음', 'Tiger bundle'], items: ['camo.wk.tigerstripe', 'emblem.wk.redtiger', 'plate.wk.crimson'] },
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
