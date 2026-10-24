// Writes the level table of the progression plan (docs/design/progression.md 3-1, 3-10):
// XP to the next level, cumulative XP, the rank, the estimated time (multiplayer and bot
// matches) and the rewards at every level from 1 to 1,100. The game will compute the same
// numbers from `xpToNext` when progression is built; this table is the plan to read.
//   node scripts/progression-table.mjs  ->  docs/design/progression-levels.md + .csv
import { writeFileSync } from 'node:fs';

/**
 * The XP curve, MapleStory-like (owner, 2026-10-24: "plain steps, flat at the top, every
 * number ending in 0: use logs and exponents, messy is fine"; then "Maple-style booms from 하사
 * on, milder there"; then "하사 in about 10 hours", "keep the booms, 1,900 h is fine", "halve it all so
 * bot matches take ~1,900 h"). Floored to whole XP, so the numbers come
 * out uneven:
 *   100 · e^(0.27 · (ln min(level, 99))^1.5)   the soldiers' climb: 일병 in the first match,
 *                                              하사 in ~5 h (bot matches ~10 h)
 *   × 1.0003^(level − 100)                     from 하사 on a slow creep, so no stretch is flat
 *   × the promotion walls so far               (`WALLS`)
 *   × the booms so far                         (`BOOMS`: bigger and rarer up the ranks — ×1.5
 *                                              every 50 levels for NCOs up to ×2 every 20 past 원수)
 * 원수 in ~960 h of multiplayer, ~1,920 h of bot matches (bot-match XP is half).
 */
const WALLS = { 10: 1.05, 30: 1.05, 60: 1.05, 100: 1.2, 210: 1.1, 500: 1.1, 1000: 1.12 };
const BOOMS = [
  { from: 100, to: 209, every: 50, x: 1.5 }, // 부사관: 150, 200
  { from: 200, to: 499, every: 100, x: 1.6 }, // 장교: 300, 400
  { from: 500, to: 999, every: 200, x: 1.7 }, // 장성: 700, 900
  { from: 1000, to: Infinity, every: 20, x: 2 }, // 원수 뒤: 1020, 1040 … (Maple's 260-300)
];
const CLIMB = { base: 100, k: 0.27, p: 1.5, creep: 1.0003 };

/** XP from `level` to the next one. */
export function xpToNext(level) {
  let walls = 1;
  for (const [at, x] of Object.entries(WALLS)) if (Number(at) <= level) walls *= x;
  let booms = 1;
  for (const b of BOOMS)
    booms *= b.x ** Math.max(0, Math.floor((Math.min(level, b.to) - b.from) / b.every));
  const climb = CLIMB.base * Math.exp(CLIMB.k * Math.log(Math.min(level, 99)) ** CLIMB.p);
  const creep = CLIMB.creep ** Math.max(0, level - 100);
  return Math.floor(climb * creep * walls * booms);
}

/** Korean military ranks by first level (owner, 2026-10-19), with insignia and title. */
const RANKS = [
  [1, '이병', '작대기 1', '갓 전입한 이병'],
  [10, '일병', '작대기 2', '손이 빠른 일병'],
  [30, '상병', '작대기 3', '믿음직한 상병'],
  [60, '병장', '작대기 4', '분대의 기둥'],
  [100, '하사', '부사관 1', '첫 분대장'],
  [130, '중사', '부사관 2', '노련한 분대장'],
  [160, '상사', '부사관 3', '소대의 버팀목'],
  [200, '원사', '부사관 4', '부대의 살아 있는 기록'],
  [210, '소위', '다이아 1', '갓 임관한 소위'],
  [230, '중위', '다이아 2', '앞장서는 중위'],
  [250, '대위', '다이아 3', '중대장'],
  [300, '소령', '무궁화 1', '작전 참모'],
  [350, '중령', '무궁화 2', '대대장'],
  [400, '대령', '무궁화 3', '연대장'],
  [500, '준장', '별 1', '별을 단 지휘관'],
  [600, '소장', '별 2', '사단장'],
  [700, '중장', '별 3', '군단장'],
  [800, '대장', '별 4', '야전군 사령관'],
  [1000, '원수', '별 5', '원수'],
];
const rankOf = (level) => RANKS.filter(([l]) => l <= level).at(-1);

const WEAPONS = { 4: 'MP5SD', 8: 'M1014', 14: 'M60E4', 22: 'L115A3', 32: 'APS' };
const GADGETS = {
  48: '대전차 지뢰 (돌격)',
  68: '의료 가방 (의무)',
  88: '수리 공구 (지원)',
  108: '동작 감지기 (정찰)',
};
const CAMO_PRIVATE = [
  '숲',
  '사막',
  '설원',
  '도시 회색',
  '갈대',
  '디지털 숲',
  '디지털 사막',
  '야간 청색',
  '위장망',
];
const CAMO_NCO = [
  '정글 잎',
  '해병 디지털',
  '붉은 사막',
  '툰드라',
  '늪',
  '가을 숲',
  '화산재',
  '산호',
  '모래 폭풍',
  '비 내린 도시',
  '철모 녹색',
];
const CAMO_OFFICER = {
  250: '의장 청색',
  300: '의장 흑색',
  350: '해군 백색',
  400: '공수 적색',
  450: '해병 적황',
};
const CAMO_GENERAL = { 500: '은빛 결', 600: '금빛 결', 700: '백금 결', 800: '흑금', 1000: '원수' };
const KILL_FX = { 500: '재', 600: '은빛 별똥', 700: '금빛 월계', 800: '인식표', 1000: '별빛' };
const GUN_SKINS = {
  100: 'M4A1 「부사관」',
  150: 'MP7 「야간 순찰」',
  200: 'M249 「원사의 기관총」',
  210: 'M1911 「장교 권총」',
  250: 'Mk 12 SPR 「정찰 대위」',
  300: 'AKM 「영관 각인」',
  350: 'M870 「대대 경비」',
  400: 'SVD 「연대 저격수」',
  450: 'UMP45 「참모」',
  500: 'M24 「은성」',
  550: 'M110 「장성 경호」',
  600: 'Mk 18 「금성」',
  650: 'PP-19 「북풍」',
  700: 'M60E4 「백금 탄띠」',
  750: 'M16A4 「의장대」',
  800: 'L115A3 「흑금」',
  850: 'MP5SD 「그림자」',
  900: 'M1014 「사령관」',
  950: 'M590 「마지막 전선」',
};
const VEHICLE_SKINS = {
  250: '지프 「소대 연락」',
  300: '장갑차 「영관 수송」',
  350: '전차 「대대 선두」',
  400: '전투기 「연대 에이스」',
  450: '구축함 「호위」',
  500: '근접지원기 「은성」',
  550: '자주포 「포병 장성」',
  600: '전차 「금성」',
  650: '항모 「기함」',
  700: '대전차 자주포 「백금」',
  750: '전함 「의장 함대」',
  800: '전투기 「흑금」',
  850: '잠수함 「심해」',
  900: '로켓 트럭 「사령부」',
  950: '함재 전투기 「마지막 비행」',
};
const FRAMES = {
  100: '부사관 휘장',
  210: '장교 청동',
  300: '영관 은',
  500: '금 · 별 1',
  600: '금 · 별 2',
  700: '금 · 별 3',
  800: '금 · 별 4',
  1000: '금 · 별 5',
};

let card = 0;
let emblem = 0;
let tag = 0;
let ncoAlt = 0;
/** What `level` gives (level 1 is the start: nothing). */
function rewards(level) {
  const out = [];
  const promo = RANKS.find(([l]) => l === level && l > 1);
  if (promo) out.push(`**진급: ${promo[1]}** — 진급 카드, 칭호 "${promo[3]}"`);
  if (FRAMES[level]) out.push(`이름표 테두리 "${FRAMES[level]}"`);
  if (WEAPONS[level]) out.push(`무기: ${WEAPONS[level]}`);
  if (GADGETS[level]) out.push(`가젯 변형: ${GADGETS[level]}`);
  if (GUN_SKINS[level]) out.push(`총 스킨: ${GUN_SKINS[level]}`);
  if (VEHICLE_SKINS[level]) out.push(`차량 스킨: ${VEHICLE_SKINS[level]}`);
  if (KILL_FX[level]) out.push(`킬 효과: ${KILL_FX[level]}`);
  if (level === 1000) out.push('원수 카드(움직임), 지휘봉 엠블럼');
  if (level < 100) {
    if (level % 10 === 0) out.push(`위장: ${CAMO_PRIVATE[level / 10 - 1]}`);
    else if (level % 10 === 5) out.push(`카드 ${++card}`);
    else if (level % 10 === 7) out.push(`이름표 색 ${++tag}`);
    else if (level > 1 && !out.length) out.push(`엠블럼 ${++emblem}`);
  } else if (level < 210) {
    if (level % 10 === 0) out.push(`위장: ${CAMO_NCO[(level - 100) / 10]}`);
    else if (level % 10 === 5)
      out.push(ncoAlt++ % 2 === 0 ? `카드 ${++card}` : `엠블럼 ${++emblem}`);
  } else if (level < 500) {
    if (CAMO_OFFICER[level]) out.push(`위장: ${CAMO_OFFICER[level]}`);
    if (level % 10 === 0)
      out.push(`카드 ${++card} (${level < 300 ? '위관 청동' : '영관 은'} 테두리)`);
  } else if (level < 1000) {
    if (CAMO_GENERAL[level]) out.push(`위장: ${CAMO_GENERAL[level]}`);
    if (level % 25 === 0) out.push(`카드 ${++card} (별 ${rankOf(level)[2].slice(-1)})`);
  } else {
    if (level === 1000) out.push(`위장: ${CAMO_GENERAL[1000]} (모든 총)`);
    else if (level % 20 === 0) out.push(`원수 카드 변형 ${(level - 1000) / 20} (XP ×2 벽)`);
  }
  return out;
}

const PER_HOUR = 18000;
const n = (x) => x.toLocaleString('en-US');
const hours = (xp, rate) => {
  const h = xp / rate;
  return h < 1 ? `${Math.round(h * 60)}분` : `${h < 10 ? h.toFixed(1) : n(Math.round(h))}시간`;
};

const rows = [];
let cum = 0;
for (let level = 1; level <= 1100; level++) {
  const [, rank, insignia] = rankOf(level);
  rows.push({
    level,
    rank,
    insignia,
    next: xpToNext(level),
    cum,
    multi: hours(cum, PER_HOUR),
    solo: hours(cum, PER_HOUR / 2),
    rewards: rewards(level),
  });
  cum += xpToNext(level);
}

const md = [];
md.push('# 경험치표 (레벨 1-1,100)');
md.push('');
md.push(
  '`node scripts/progression-table.mjs`로 만든 표(손으로 고치지 말고 스크립트를 고친다). 기획: `progression.md` 3-1(레벨과 계급), 3-10(레벨 보상), `progression-data.md`.',
);
md.push('');
md.push(
  '- **다음까지**: 그 레벨에서 다음 레벨로 가는 데 필요한 XP. **누적**: 그 레벨에 처음 닿을 때까지 모은 XP.',
);
md.push(
  '- 필요 XP 식(메이플식, 오너 2026-10-24): `⌊ 100 · e^(0.27 · (ln min(레벨, 99))^1.5) × 1.0003^(레벨−100) × 진급 벽 × 뻥튀기 ⌋`. 진급 벽: 일병·상병·병장 ×1.05, 하사 ×1.2, 소위 ×1.1, 준장 ×1.1, 원수 ×1.12. 뻥튀기(위로 갈수록 크고 드물게): 부사관 50레벨마다 ×1.5(150, 200), 장교 100레벨마다 ×1.6(300, 400), 장성 200레벨마다 ×1.7(700, 900), 원수 뒤 20레벨마다 ×2(1020, 1040 …). 수치는 스크립트의 `WALLS` / `BOOMS` / `CLIMB`.',
);
md.push(
  `- **시간**은 추정: 멀티 한 시간 약 ${n(PER_HOUR)} XP(10분 경기 한 판 약 3,000), 봇전(보통 난이도)은 XP 절반이라 두 배. 봇전 쉬움(×0.66)은 봇전 칸의 약 1.5배, 어려움(×1.2)은 약 0.83배. 부스터 없이. 실측은 만들 때.`,
);
md.push(
  '- 보상: 레벨 1은 시작(보상 없음). 1-99는 매 레벨 하나 이상, 그 위로는 드물게 크게. 이름은 [제안].',
);
md.push('');
md.push('## 계급 한눈에');
md.push('');
md.push('| 계급 | 계급장 | 첫 레벨 | 누적 XP | 멀티 | 봇전 |');
md.push('|---|---|---|---|---|---|');
for (const [l, rank, ins] of RANKS) {
  const r = rows[l - 1];
  md.push(`| ${rank} | ${ins} | ${l} | ${n(r.cum)} | ${r.multi} | ${r.solo} |`);
}
md.push('');
md.push('## 전체 표');
md.push('');
md.push('| 레벨 | 계급 | 다음까지 | 누적 XP | 멀티 | 봇전 | 보상 |');
md.push('|---|---|---|---|---|---|---|');
for (const r of rows)
  md.push(
    `| ${r.level} | ${r.rank} | ${n(r.next)} | ${n(r.cum)} | ${r.multi} | ${r.solo} | ${r.rewards.join(' · ') || '–'} |`,
  );
md.push('');
writeFileSync(new URL('../docs/design/progression-levels.md', import.meta.url), md.join('\n'));

const csv = ['level,rank,insignia,xp_to_next,cumulative_xp,hours_multi,hours_bots,rewards'];
for (const r of rows) {
  const cell = (s) => `"${String(s).replace(/"/g, '""').replace(/\*\*/g, '')}"`;
  csv.push(
    [
      r.level,
      r.rank,
      r.insignia,
      r.next,
      r.cum,
      (r.cum / PER_HOUR).toFixed(2),
      (r.cum / (PER_HOUR / 2)).toFixed(2),
      cell(r.rewards.join(' / ')),
    ].join(','),
  );
}
writeFileSync(
  new URL('../docs/design/progression-levels.csv', import.meta.url),
  '﻿' + csv.join('\n') + '\n',
);
console.log(`progression table: ${rows.length} levels, marshal at ${n(rows[999].cum)} XP`);
