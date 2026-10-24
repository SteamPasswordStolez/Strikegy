/**
 * Progress notices during a match (progression plan 3-1-1, progression-data.md O):
 * a level reached, a promotion, a one-off bonus. Under the objective bar, one at
 * a time for 1.5 s, promotions before anything else, levels that pile up shown
 * as one ("레벨 업 ×2 · Lv 44"); weapons opened by a level and weapon levels
 * (step 3) after them. Its own `ds-root` over the HUD and the deploy
 * screen, so it is seen while dead too. The setting "진행 알림" can turn it off.
 */
import { levelOf, rankAt, type RankId } from '@/progression/levels';
import { weaponLevelOf } from '@/progression/unlocks';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { t } from '@/i18n';
import { icon } from './icons';
import { weaponPortraitNow } from './weaponPortraits';
import { insigniaAt, insigniaSvg, rankName, rankTitle } from './rankInsignia';
import './progress.css';

export type NoticeSetting = 'all' | 'levels' | 'off';

interface Notice {
  kind: 'level' | 'promo' | 'bonus' | 'weapon' | 'unlock';
  /** weapon / unlock: the gun (unlock: the first of those opened). */
  weapon?: WeaponId;
  level: number;
  /** Levels folded into this one. */
  count: number;
  rank?: RankId;
  title?: string;
  text?: string;
  /** XP total after it (the bar under the text). */
  xp: number;
}

const SHOW_S = 1.5;
const PROMO_S = 1.9;

export class ProgressToast {
  readonly root: HTMLDivElement;
  private readonly queue: Notice[] = [];
  private current: Notice | null = null;
  private left = 0;

  constructor(
    parent: HTMLElement,
    private setting: NoticeSetting,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'pt ds-root';
    this.root.dataset.dsTheme = 'bfv';
    parent.appendChild(this.root);
  }

  setSetting(s: NoticeSetting): void {
    this.setting = s;
    if (s === 'off') this.clear();
  }

  /** A level reached (`xp`: the live total, for the bar). */
  level(level: number, promoted: RankId | null, xp: number): void {
    if (this.setting === 'off') return;
    if (promoted) {
      // Promotions go first; levels still waiting are folded into it (it names the level).
      for (let i = this.queue.length - 1; i >= 0; i--)
        if (this.queue[i]!.kind === 'level') this.queue.splice(i, 1);
      this.queue.unshift({ kind: 'promo', level, count: 1, rank: promoted, xp });
      return;
    }
    const last = this.queue[this.queue.length - 1];
    if (last?.kind === 'level') {
      last.level = level;
      last.count++;
      last.xp = xp;
      return;
    }
    this.queue.push({ kind: 'level', level, count: 1, xp });
  }

  /** Weapons a level just opened. */
  unlock(ids: WeaponId[], level: number): void {
    if (this.setting === 'off' || !ids.length) return;
    this.queue.push({ kind: 'unlock', level, count: ids.length, weapon: ids[0], text: ids.map((id) => WEAPONS[id].name).join(', '), xp: 0 });
  }

  /** A weapon's level reached (`xp`: that weapon's live XP). */
  weaponLevel(id: WeaponId, level: number, xp: number): void {
    if (this.setting === 'off') return;
    const last = this.queue[this.queue.length - 1];
    if (last?.kind === 'weapon' && last.weapon === id) {
      last.level = level;
      last.count++;
      last.xp = xp;
      return;
    }
    this.queue.push({ kind: 'weapon', level, count: 1, weapon: id, xp });
  }

  /** Something else (the tutorial's bonus): a title and a line. */
  bonus(title: string, text: string, xp: number): void {
    if (this.setting !== 'all') return;
    this.queue.push({ kind: 'bonus', level: levelOf(xp).level, count: 1, title, text, xp });
  }

  clear(): void {
    this.queue.length = 0;
    this.current = null;
    this.root.classList.remove('on');
    this.root.replaceChildren();
  }

  update(dt: number): void {
    if (this.current) {
      this.left -= dt;
      if (this.left > 0) return;
      this.current = null;
      this.root.classList.remove('on');
    }
    const n = this.queue.shift();
    if (!n) return;
    this.current = n;
    this.left = n.kind === 'promo' ? PROMO_S : SHOW_S;
    this.draw(n);
  }

  private draw(n: Notice): void {
    const r = this.root;
    r.replaceChildren();
    r.className = `pt ds-root on ${n.kind}`;
    const pic = document.createElement('div');
    pic.className = 'pt-pic';
    if (n.weapon) {
      const url = weaponPortraitNow(n.weapon);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        pic.appendChild(img);
      } else pic.innerHTML = icon(n.kind === 'unlock' ? 'lock' : 'star');
    } else pic.innerHTML = n.kind === 'promo' ? insigniaSvg(rankAt(n.level)) : insigniaAt(n.level);
    const body = document.createElement('div');
    body.className = 'pt-body';
    const title = document.createElement('div');
    title.className = 'pt-title';
    const text = document.createElement('div');
    text.className = 'pt-text';
    if (n.kind === 'promo') {
      title.textContent = `${t('prog.promoted')} · ${rankName(n.level)}`;
      text.textContent = `${rankTitle(n.rank!)} · Lv ${n.level}`;
    } else if (n.kind === 'level') {
      title.textContent =
        n.count > 1 ? t('prog.levelUpN').replace('{n}', String(n.count)) : t('prog.levelUp');
      text.textContent = `${rankName(n.level)} · Lv ${n.level}`;
    } else if (n.kind === 'unlock') {
      title.textContent = t('prog.unlocked');
      text.textContent = `${n.text} · Lv ${n.level}`;
    } else if (n.kind === 'weapon') {
      title.textContent = n.count > 1 ? t('prog.weaponLevelN').replace('{n}', String(n.count)) : t('prog.weaponLevel');
      text.textContent = `${WEAPONS[n.weapon!].name} · Lv ${n.level}`;
    } else {
      title.textContent = n.title ?? '';
      text.textContent = n.text ?? '';
    }
    const bar = document.createElement('div');
    bar.className = 'pt-bar';
    const fill = document.createElement('i');
    if (n.kind === 'weapon') {
      const at = weaponLevelOf(n.xp);
      fill.style.setProperty('--p', at.need ? (at.into / at.need).toFixed(3) : '1');
    } else if (n.kind === 'unlock') fill.style.setProperty('--p', '1');
    else {
      const at = levelOf(n.xp);
      fill.style.setProperty('--p', (at.into / at.need).toFixed(3));
    }
    bar.appendChild(fill);
    body.append(title, text, bar);
    r.append(pic, body);
  }
}
