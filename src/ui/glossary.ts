import { getLocale } from '@/i18n';
import './glossary.css';

/**
 * Words a newcomer may not know (owner, 2026-11-01: "a ? button and a tooltip
 * on the English words beginners don't know, on hover or press"): short
 * plain-language explanations, shown by a small "?" next to the word.
 */
export type Term =
  | 'RP'
  | 'XP'
  | 'Lv'
  | 'weaponLv'
  | 'KD'
  | 'HP'
  | 'FPS'
  | 'FOV'
  | 'AO'
  | 'AA'
  | 'bloom'
  | 'filtering'
  | 'MVP'
  | 'booster';

const GLOSSARY: Record<Term, { name: [string, string]; text: [string, string] }> = {
  RP: {
    name: ['RP (보급 점수)', 'RP (requisition points)'],
    text: [
      '분대원들이 얻은 점수를 모은 것입니다. 분대장이 이 점수로 박격포, 포격, 보급 투하, 정찰기 같은 지원을 부릅니다(기본 키 B). 쓰면 줄어들고, 싸우고 거점을 잡을수록 다시 쌓입니다.',
      'Your squad’s points put together. The squad leader spends them on call-ins such as mortars, artillery, supply drops and the recon plane (default key B). They go down when spent and build up again as the squad fights and takes zones.',
    ],
  },
  XP: {
    name: ['XP (경험치)', 'XP (experience)'],
    text: [
      '경기에서 얻는 경험치입니다. 점수의 10배가 쌓이고, 경기를 끝까지 하거나 이기면 더 받습니다. 모이면 레벨이 오르고 계급이 진급합니다.',
      'Experience earned in matches: ten times your score, plus bonuses for finishing and winning. It raises your level and your rank.',
    ],
  },
  Lv: {
    name: ['Lv (레벨)', 'Lv (level)'],
    text: [
      '계정의 레벨입니다. XP가 쌓이면 오르고, 레벨에 따라 계급(이병, 일병…)이 바뀌며 무기와 보상이 열립니다.',
      'Your account level. It rises with XP; your rank follows it, and new weapons and rewards open as it goes up.',
    ],
  },
  weaponLv: {
    name: ['무기 Lv (무기 레벨)', 'Weapon Lv (weapon level)'],
    text: [
      '그 무기로 적을 쓰러뜨릴 때마다 오르는 무기별 레벨입니다. 레벨이 오를수록 조준경, 손잡이, 탄창 같은 부착물이 하나씩 열립니다.',
      'A level for each weapon, raised by kills with it. Each level opens attachments such as sights, grips and magazines.',
    ],
  },
  KD: {
    name: ['K/D (처치/사망 비율)', 'K/D (kills per death)'],
    text: [
      '쓰러뜨린 적의 수를 죽은 횟수로 나눈 값입니다. 1보다 크면 죽은 것보다 더 많이 쓰러뜨렸다는 뜻입니다.',
      'Kills divided by deaths. Above 1 means you took down more than you lost.',
    ],
  },
  HP: {
    name: ['HP (체력)', 'HP (health)'],
    text: [
      '병사의 체력입니다. 0이 되면 쓰러지고, 동료가 살려 주거나 시간이 지나면 다시 배치합니다. 맞지 않고 잠시 있으면 저절로 찹니다.',
      'Your soldier’s health. At 0 you go down until a teammate revives you or you redeploy. It refills by itself after a few seconds without being hit.',
    ],
  },
  FPS: {
    name: ['FPS (초당 프레임)', 'FPS (frames per second)'],
    text: [
      '화면이 1초에 몇 번 새로 그려지는지입니다. 높을수록 부드럽고, 60 이상이면 대체로 매끄럽습니다. 낮으면 그래픽 설정을 내려 보세요.',
      'How many times a second the screen is drawn. Higher is smoother; 60 or more usually feels fluid. If it is low, try lower graphics settings.',
    ],
  },
  FOV: {
    name: ['FOV (시야각)', 'FOV (field of view)'],
    text: [
      '화면에 담기는 시야의 넓이(도)입니다. 넓히면 옆이 더 보이지만 멀리 있는 것이 작아지고, 좁히면 가운데가 크게 보입니다.',
      'How wide a view the screen shows, in degrees. Wider shows more to the sides but makes distant things smaller; narrower makes the middle bigger.',
    ],
  },
  AO: {
    name: ['AO (주변광 차폐)', 'AO (ambient occlusion)'],
    text: [
      '벽 구석, 물건이 바닥에 닿은 곳처럼 빛이 덜 드는 곳을 살짝 어둡게 해서 입체감을 주는 효과입니다. 켜면 그래픽 카드가 조금 더 일합니다.',
      'Darkens corners and the spots where things touch the ground, where less light reaches, so the scene looks more solid. Costs some GPU time.',
    ],
  },
  AA: {
    name: ['안티앨리어싱 (FXAA / MSAA)', 'Anti-aliasing (FXAA / MSAA)'],
    text: [
      '사물 가장자리의 계단처럼 깨진 선을 부드럽게 다듬는 기능입니다. FXAA는 가볍고 조금 흐릿하고, MSAA는 더 선명하지만 조금 무겁습니다.',
      'Smooths the jagged, stair-step edges of things. FXAA is light and a little soft; MSAA is sharper but costs a little more.',
    ],
  },
  bloom: {
    name: ['블룸 (Bloom)', 'Bloom'],
    text: [
      '해, 총구 섬광, 불처럼 아주 밝은 것 주위로 빛이 번져 보이게 하는 효과입니다.',
      'Makes very bright things such as the sun, muzzle flashes and fire glow softly around their edges.',
    ],
  },
  filtering: {
    name: ['텍스처 필터링 (2x~16x)', 'Texture filtering (2x-16x)'],
    text: [
      '비스듬히 보이는 땅과 벽의 무늬가 멀리까지 또렷하게 보이게 하는 기능입니다. 숫자가 클수록 선명하지만 조금 무거워집니다.',
      'Keeps the patterns on ground and walls seen at an angle sharp further away. Higher numbers are sharper and cost a little more.',
    ],
  },
  MVP: {
    name: ['MVP (최우수 병사)', 'MVP (most valuable player)'],
    text: ['경기에서 가장 높은 점수를 낸 병사입니다. 보급표를 더 받습니다.', 'The soldier with the top score in the match. Earns extra supply tickets.'],
  },
  booster: {
    name: ['부스터', 'Booster'],
    text: [
      '정해진 시간 동안 얻는 XP나 보급표를 늘려 주는 아이템입니다. 경기 중에만 시간이 흐릅니다.',
      'Raises the XP or supply tickets you earn for a set time. Its clock only runs during matches.',
    ],
  },
};

/** Every term as [name, explanation] in the current language (the controls page's 용어 list). */
export function glossaryList(): [string, string][] {
  const i = getLocale() === 'ko' ? 0 : 1;
  return (Object.keys(GLOSSARY) as Term[]).map((k) => [GLOSSARY[k].name[i], GLOSSARY[k].text[i]]);
}

/** The terms named in a text (a settings label, a stat's name...). */
export function termsIn(text: string): Term[] {
  const found: Term[] = [];
  const add = (t: Term, re: RegExp) => {
    if (re.test(text)) found.push(t);
  };
  add('RP', /\bRP\b/);
  add('XP', /\bXP\b/);
  add('KD', /\bK\/D\b/);
  add('HP', /\bHP\b/);
  add('FPS', /\bFPS\b/);
  add('FOV', /\bFOV\b/);
  add('AO', /\bAO\b|주변광 차폐|ambient occlusion/i);
  add('AA', /안티앨리어싱|anti-aliasing|\bFXAA\b|\bMSAA\b/i);
  add('bloom', /블룸|\bbloom\b/i);
  add('filtering', /텍스처 필터링|texture filtering/i);
  add('MVP', /\bMVP\b/);
  if (/무기 Lv|weapon lv/i.test(text)) found.push('weaponLv');
  else add('Lv', /\bLv\b/);
  add('booster', /부스터|\bbooster/i);
  return found;
}

let tip: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let pinned = false;

function close(): void {
  if (!tip) return;
  tip.classList.remove('on');
  owner?.setAttribute('aria-expanded', 'false');
  owner = null;
  pinned = false;
}

function open(btn: HTMLElement, term: Term): void {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'gl-tip';
    tip.setAttribute('role', 'tooltip');
    tip.id = 'gl-tip';
    document.body.appendChild(tip);
    document.addEventListener('pointerdown', (e) => {
      if (owner && !owner.contains(e.target as Node) && !tip!.contains(e.target as Node)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && owner) close();
    });
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
  }
  const ko = getLocale() === 'ko' ? 0 : 1;
  const g = GLOSSARY[term];
  tip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'gl-name';
  head.textContent = g.name[ko];
  const body = document.createElement('div');
  body.className = 'gl-text';
  body.textContent = g.text[ko];
  tip.append(head, body);
  owner?.setAttribute('aria-expanded', 'false');
  owner = btn;
  btn.setAttribute('aria-expanded', 'true');
  tip.classList.add('on');
  // Under the button, kept on screen (above it when there is no room below).
  const r = btn.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + h < window.innerHeight - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
}

/**
 * A small "?" that explains `term`: shown while the pointer is on it (or it has
 * focus), held open by a click / tap, closed by another tap, a tap elsewhere or
 * Esc. Never put it inside another button.
 */
export function helpTip(term: Term): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gl-q';
  b.textContent = '?';
  b.setAttribute('aria-label', `${getLocale() === 'ko' ? '용어 설명' : 'What is'}: ${GLOSSARY[term].name[getLocale() === 'ko' ? 0 : 1]}`);
  b.setAttribute('aria-describedby', 'gl-tip');
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' && !pinned) open(b, term);
  });
  b.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pinned && owner === b) close();
  });
  b.addEventListener('focus', () => {
    if (!pinned) open(b, term);
  });
  b.addEventListener('blur', () => {
    if (!pinned && owner === b) close();
  });
  // The row / card it sits in must not take the click (open a page, buy, pick).
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (owner === b && pinned) {
      close();
      return;
    }
    open(b, term);
    pinned = true;
  });
  return b;
}

/** Adds a "?" after `el` for every term its text names (none when it names none). */
export function addHelp(el: HTMLElement, text = el.textContent ?? ''): void {
  for (const term of termsIn(text)) el.appendChild(helpTip(term));
}
