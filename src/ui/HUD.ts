import { t } from '@/i18n';
import { playerName } from '@/net/identity';
import { reticleSvg, type Reticle } from '@/weapons/optics';

export interface HudFrame {
  weaponName: string;
  ammo: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  health: number;
  /** Crosshair gap in CSS pixels. */
  crosshairGap: number;
  adsBlend: number;
  /**
   * Magnified scope of the current weapon: its reticle and how far the eye box
   * sits off centre (fractions of the lens radius, from sway and movement).
   */
  scope: { reticle: Reticle; color: number; shiftX: number; shiftY: number } | null;
  /**
   * Holding your breath: air left (0..1) and whether it is held, shown under
   * the scope with the key hint; null when not scoped.
   */
  breath: { air: number; holding: boolean; locked: boolean; hint: string } | null;
  /** 0..1 blackout from holding the breath too long. */
  dark: number;
  /** Squad RP line for squad leaders (bot matches), or null. */
  rp: string | null;
  grenadeLabel: string;
  /** Which throwable (frag / flash / smoke), for its icon. */
  grenadeType: string;
  grenadeCount: number;
  /** Class gadget: key hint ('4 · ' on PC), name, count left, in hand. Null: none (support, range). */
  gadget: { id: string; key: string; label: string; count: number; out: boolean } | null;
  /** 0..1 white-out from flashbangs. */
  flash: number;
  /** Seconds until respawn, or null while alive. */
  respawnIn: number | null;
  /** Who killed the player (bot matches), shown on the death screen. */
  killedBy: string | null;
  /** Team kill counts (bot matches), or null on the range. */
  score: { allies: number; enemies: number } | null;
  /** Zone modes: score, zone states and the mode line from the player's point of view. */
  zone: ZoneHud | null;
  /** The player's squad (bot matches). */
  squad: SquadHud | null;
  /** Medkit state beside the health bar ('1', '0', '12s'), or null when not in play. */
  medkit: { text: string; ready: boolean } | null;
  /** Down and waiting for a revive. */
  down: { left: number; giveUp: number; reviver: string | null; revive: number } | null;
  /** What E would do here, with progress while holding it. */
  prompt: { text: string; progress: number | null } | null;
  fps: number | null;
  debug: string | null;
}

export type Side = 'ally' | 'enemy';

export interface ZoneHud {
  /** Beside the bar: domination points or tickets ('∞' for a side without), and how full each side's gauge is (0..1). */
  score: { allies: string; enemies: string; fill: { allies: number; enemies: number } };
  /** Our side of the map first; locked zones can't be taken right now. */
  zones: { id: string; owner: Side | null; progress: number; pushing: Side | null; contested: boolean; locked: boolean }[];
  /** Under the bar: the mode, its target or attack timer. */
  status: { text: string; tone: Side | 'neutral'; urgent: boolean } | null;
  /** The zone the player stands in, with a status line. */
  here: { id: string; text: string; progress: number; tone: Side | 'neutral' } | null;
}

export interface SquadHud {
  name: string;
  members: { name: string; state: 'ok' | 'combat' | 'down' | 'dead'; you: boolean }[];
}

export interface KillEntry {
  attacker: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  attackerTeam?: 'blue' | 'red' | null;
  victimTeam?: 'blue' | 'red' | null;
}

interface DamageArc {
  el: HTMLDivElement;
  /** World-space yaw pointing towards the damage source. */
  worldYaw: number;
  life: number;
}

/** Line icons for the kit (24-unit boxes, stroked in the text colour). */
const KIT_ICON: Record<string, string> = {
  frag: '<circle cx="11" cy="14" r="6"/><path d="M11 8V5h4l3 3"/><path d="M8.5 12.5h5"/>',
  flash: '<rect x="8" y="7" width="8" height="13" rx="1"/><path d="M8 11h8M8 15h8M10 7V4h4v3"/>',
  smoke: '<rect x="7" y="8" width="10" height="12" rx="1.5"/><path d="M9 8V5h6v3M7 12h10"/><path d="M15 4c1.5-1.2 3-1 4 0"/>',
  panzerfaust: '<path d="M2 15l12-4.5"/><path d="M14 10.5l4.5-2 3 2.5-4.5 2z"/><path d="M6 13.5l1.2 4.5M10 12l1 2.8"/>',
  riflesmoke: '<path d="M12 3l3 4v8l-3 2.5L9 15V7z"/><path d="M12 17.5V21M9 11h6"/>',
  beacon: '<path d="M12 21V10M8 21h8"/><path d="M8.5 7.5a5 5 0 0 1 7 0M5.5 4.5a9 9 0 0 1 13 0"/>',
  mine: '<path d="M4 17h16l-2.5-5h-11z"/><path d="M12 12V9M10 9h4"/>',
  medkit: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M12 10v6M9 13h6M9 7V5h6v2"/>',
};

/** An equipment chip: [key] icon ×count (no cap on touch screens); the name is the tooltip. */
function chip(box: HTMLElement, key: string, label: string, count: number | string, icon: string): void {
  box.replaceChildren();
  box.title = label;
  if (key) el('span', 'keycap', box).textContent = key;
  const path = KIT_ICON[icon];
  if (path) {
    const i = el('span', 'chip-icon', box);
    i.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${path}</svg>`;
  } else el('span', 'chip-label', box).textContent = label;
  el('span', 'chip-count', box).textContent = typeof count === 'number' ? `×${count}` : count;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const ARC_LIFE = 1.6;
const FEED_LIFE = 6;
const FEED_MAX = 5;

/** DOM heads-up display. Only touches the DOM when values change. */
export class HUD {
  readonly root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private ammo: HTMLDivElement;
  private ammoMag: HTMLSpanElement;
  private ammoRes: HTMLSpanElement;
  private weapon: HTMLDivElement;
  private grenade: HTMLDivElement;
  private gadgetEl: HTMLDivElement;
  private rpEl: HTMLDivElement;
  private magBar: HTMLDivElement;
  private magFill: HTMLDivElement;
  private health: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private fps: HTMLDivElement;
  private scope: HTMLDivElement;
  private scopeReticle: SVGSVGElement;
  private breathEl: HTMLDivElement;
  private breathFill: HTMLDivElement;
  private breathText: HTMLDivElement;
  private blackEl: HTMLDivElement;
  private hurt: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private damageRing: HTMLDivElement;
  private feed: HTMLDivElement;
  private death: HTMLDivElement;
  private score: HTMLDivElement;
  private deathText: HTMLDivElement;
  private zoneBar: HTMLDivElement;
  /** Score bars under the minimap (Modern Warfare style; the zone bar keeps its numbers on touch screens). */
  private mscore: HTMLDivElement;
  private xp: HTMLDivElement;
  private xpItems: { el: HTMLDivElement; life: number }[] = [];
  private zoneHere: HTMLDivElement;
  private zoneHereFill: HTMLDivElement;
  private zoneHereText: HTMLDivElement;
  private squadEl: HTMLDivElement;
  private notices: HTMLDivElement;
  private medkit: HTMLDivElement;
  private downEl: HTMLDivElement;
  private downText: HTMLDivElement;
  private downBar: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private promptText: HTMLDivElement;
  private promptFill: HTMLDivElement;
  private noticeItems: { el: HTMLDivElement; life: number }[] = [];
  private arcs: DamageArc[] = [];
  private feedItems: { el: HTMLDivElement; life: number }[] = [];
  private hitTimer = 0;
  private hurtPulse = 0;
  private last: Record<string, string> = {};
  private readonly touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.hurt = el('div', 'hud-hurt', this.root);
    this.scope = el('div', 'scope', this.root);
    const lens = el('div', 'scope-lens', this.scope);
    this.scopeReticle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.scopeReticle.setAttribute('viewBox', '-100 -100 200 200');
    lens.appendChild(this.scopeReticle);
    el('div', 'scope-glare', lens);
    el('div', 'scope-mask', this.scope);
    this.breathEl = el('div', 'scope-breath', this.scope);
    this.breathFill = el('div', 'scope-breath-fill', el('div', 'scope-breath-track', this.breathEl));
    this.breathText = el('div', 'scope-breath-text', this.breathEl);
    this.crosshair = el('div', 'crosshair', this.root);
    for (const side of ['t', 'b', 'l', 'r']) el('div', `ch ch-${side}`, this.crosshair);
    el('div', 'ch-dot', this.crosshair);
    this.hitmarker = el('div', 'hitmarker', this.root);
    this.damageRing = el('div', 'damage-ring', this.root);
    this.feed = el('div', 'killfeed', this.root);

    // Weapon block: name, magazine over reserve, a magazine gauge (reload
    // progress while reloading), then the throwables / gadget as key chips.
    const bottomRight = el('div', 'hud-br', this.root);
    this.weapon = el('div', 'hud-weapon', bottomRight);
    this.ammo = el('div', 'hud-ammo', bottomRight);
    this.ammoMag = el('span', 'ammo-mag', this.ammo);
    this.ammoRes = el('span', 'ammo-res', this.ammo);
    this.magBar = el('div', 'hud-magbar', bottomRight);
    this.magFill = el('div', 'hud-magbar-fill', this.magBar);
    const kit = el('div', 'hud-kit', bottomRight);
    this.gadgetEl = el('div', 'hud-chip hud-gadget', kit);
    this.grenade = el('div', 'hud-chip hud-grenade', kit);
    this.rpEl = el('div', 'hud-rp', bottomRight);

    // Soldier block: squad, health number and bar, medkit.
    const bottomLeft = el('div', 'hud-bl', this.root);
    const vitals = el('div', 'hud-vitals', bottomLeft);
    this.health = el('div', 'hud-health', vitals);
    const bar = el('div', 'hud-healthbar', vitals);
    this.healthFill = el('div', 'hud-healthbar-fill', bar);
    this.medkit = el('div', 'hud-chip hud-medkit', bottomLeft);
    this.fps = el('div', 'hud-fps', this.root);
    this.death = el('div', 'hud-death', this.root);
    this.score = el('div', 'hud-score', this.root);
    this.deathText = el('div', 'hud-death-text', this.death);
    this.squadEl = el('div', 'hud-squad', bottomLeft);
    bottomLeft.prepend(this.squadEl);
    this.zoneBar = el('div', 'zone-bar', this.root);
    this.mscore = el('div', 'hud-mscore', this.root);
    this.xp = el('div', 'hud-xp', this.root);
    this.zoneHere = el('div', 'zone-here', this.root);
    this.zoneHereText = el('div', 'zone-here-text', this.zoneHere);
    this.zoneHereFill = el('div', 'zone-here-fill', el('div', 'zone-here-track', this.zoneHere));
    this.notices = el('div', 'hud-notices', this.root);
    this.downEl = el('div', 'hud-down', this.root);
    this.downText = el('div', 'hud-down-text', this.downEl);
    this.downBar = el('div', 'hud-down-fill', el('div', 'hud-down-track', this.downEl));
    this.promptEl = el('div', 'hud-prompt', this.root);
    this.promptText = el('div', 'hud-prompt-text', this.promptEl);
    this.promptFill = el('div', 'hud-prompt-fill', el('div', 'hud-prompt-track', this.promptEl));
    this.blackEl = el('div', 'hud-black', this.root);
    this.flashEl = el('div', 'hud-flash', this.root);
  }

  private set(key: string, value: string, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  showHit(headshot: boolean, killed: boolean): void {
    this.hitmarker.className = `hitmarker show${headshot ? ' head' : ''}${killed ? ' kill' : ''}`;
    this.hitTimer = killed ? 0.35 : 0.15;
  }

  /** Registers incoming damage from a world-space direction (yaw where 0 = -Z), or null for undirected. */
  showDamage(worldYaw: number | null, amount: number): void {
    this.hurtPulse = Math.min(1, this.hurtPulse + 0.25 + amount / 80);
    if (worldYaw === null) return;
    const arcEl = el('div', 'damage-arc', this.damageRing);
    this.arcs.push({ el: arcEl, worldYaw, life: ARC_LIFE });
  }

  addKill(k: KillEntry): void {
    const row = el('div', 'killfeed-row', this.feed);
    // Team colors: allies blue, enemies red; the player is highlighted.
    const cls = (name: string, team?: 'blue' | 'red' | null) => (name === 'You' ? 'kf-you' : team ? `kf-name kf-${team}` : 'kf-name');
    const a = el('span', cls(k.attacker, k.attackerTeam), row);
    a.textContent = k.attacker === 'You' ? playerName(t('feed.you')) : k.attacker;
    if (k.attacker === 'You' || k.victim === 'You') row.classList.add('mine');
    if (k.weapon) el('span', 'kf-weapon', row).textContent = k.weapon;
    if (k.headshot) el('span', 'kf-hs', row).textContent = '◎';
    el('span', cls(k.victim, k.victimTeam), row).textContent = k.victim === 'You' ? playerName(t('feed.you')) : k.victim;
    this.feedItems.push({ el: row, life: FEED_LIFE });
    while (this.feedItems.length > FEED_MAX) this.feedItems.shift()!.el.remove();
  }

  /** Short centered message (zone captured / lost ...). */
  notify(text: string, tone: Side | 'neutral'): void {
    const row = el('div', `hud-notice n-${tone}`, this.notices);
    row.textContent = text;
    this.noticeItems.push({ el: row, life: 3 });
    while (this.noticeItems.length > 3) this.noticeItems.shift()!.el.remove();
  }

  /** "+100 Kill" under the crosshair (the player's own points, Modern Warfare style). */
  scorePopup(points: number, label: string): void {
    const row = el('div', 'xp-row', this.xp);
    el('span', 'xp-pts', row).textContent = `+${points}`;
    el('span', 'xp-what', row).textContent = label;
    this.xpItems.push({ el: row, life: 1.8 });
    while (this.xpItems.length > 3) this.xpItems.shift()!.el.remove();
  }

  clearDamage(): void {
    for (const a of this.arcs) a.el.remove();
    this.arcs = [];
    this.hurtPulse = 0;
  }

  update(f: HudFrame, dt: number, viewYaw: number): void {
    this.hitTimer -= dt;
    if (this.hitTimer <= 0 && this.hitmarker.classList.contains('show')) this.hitmarker.className = 'hitmarker';

    const gap = Math.round(f.crosshairGap);
    this.set('gap', String(gap), () => this.crosshair.style.setProperty('--gap', `${gap}px`));
    const dead = f.respawnIn !== null || f.down !== null;
    const chOpacity = dead ? '0' : (1 - f.adsBlend).toFixed(2);
    this.set('chOp', chOpacity, () => (this.crosshair.style.opacity = chOpacity));
    // Scope: fades in over the last part of aiming, the eye box shadow drifts with sway.
    const sc = f.scope && !dead ? f.scope : null;
    const scopeIn = sc ? Math.min(1, Math.max(0, (f.adsBlend - 0.82) / 0.14)) : 0;
    this.set('scope', scopeIn.toFixed(2), () => {
      this.scope.style.opacity = scopeIn.toFixed(2);
      this.scope.style.setProperty('--zoom', (1.12 - scopeIn * 0.12).toFixed(3));
    });
    if (sc) {
      this.set('reticle', `${sc.reticle}:${sc.color}`, () => (this.scopeReticle.innerHTML = reticleSvg(sc.reticle, sc.color)));
      const shift = `${sc.shiftX.toFixed(3)},${sc.shiftY.toFixed(3)}`;
      this.set('scopeShift', shift, () => {
        this.scope.style.setProperty('--kx', sc.shiftX.toFixed(3));
        this.scope.style.setProperty('--ky', sc.shiftY.toFixed(3));
      });
    }
    const br = f.breath;
    this.set('breathOn', String(!!br), () => (this.breathEl.style.display = br ? '' : 'none'));
    if (br) {
      const air = Math.round(br.air * 100);
      this.set('breath', `${air}:${br.holding}:${br.locked}`, () => {
        this.breathFill.style.width = `${air}%`;
        this.breathEl.classList.toggle('holding', br.holding);
        this.breathEl.classList.toggle('low', br.locked || br.air < 0.45);
      });
      this.set('breathHint', br.hint, () => (this.breathText.textContent = br.hint));
    }
    // Blackout: closes in from the edges, then the middle goes too.
    const dk = f.dark.toFixed(2);
    this.set('dark', dk, () => {
      const d = f.dark;
      this.blackEl.style.opacity = Math.min(1, d * 2.5).toFixed(2);
      this.blackEl.style.setProperty('--hole', `${((1 - d) * 40).toFixed(1)}vmin`);
      this.blackEl.style.setProperty('--fill', Math.max(0, (d - 0.7) / 0.3).toFixed(2));
    });

    this.set('weapon', f.weaponName, () => (this.weapon.textContent = f.weaponName));
    const empty = f.ammo === 0 && f.reserve === 0;
    const reserve = Number.isFinite(f.reserve) ? String(f.reserve) : '∞';
    const ammoKey = empty ? 'empty' : `${f.ammo}/${reserve}`;
    this.set('ammo', ammoKey, () => {
      this.ammoMag.textContent = empty ? t('hud.noAmmo') : String(f.ammo);
      this.ammoRes.textContent = empty ? '' : reserve;
      this.ammo.classList.toggle('low', f.ammo <= Math.ceil(f.magSize * 0.25));
      this.ammo.classList.toggle('empty', empty);
    });
    // The gauge: rounds left in the magazine, or the reload's progress.
    const gauge = f.reloading ? f.reloadProgress : f.magSize > 0 ? f.ammo / f.magSize : 0;
    this.set('magbar', `${f.reloading}:${Math.round(gauge * 60)}`, () => {
      this.magBar.classList.toggle('reloading', f.reloading);
      this.magFill.style.width = `${Math.round(gauge * 100)}%`;
    });
    this.set('grenade', `${f.grenadeType}:${f.grenadeCount}`, () => {
      chip(this.grenade, this.touch ? '' : 'G', f.grenadeLabel, f.grenadeCount, f.grenadeType);
      this.grenade.classList.toggle('empty', f.grenadeCount === 0);
    });
    const gd = f.gadget;
    this.set('gadget', gd ? `${gd.key}${gd.label}:${gd.count}:${gd.out}` : '', () => {
      this.gadgetEl.style.display = gd ? '' : 'none';
      if (!gd) return;
      chip(this.gadgetEl, gd.key.replace(/\s*·\s*$/, ''), gd.label, gd.count, gd.id);
      this.gadgetEl.classList.toggle('empty', gd.count === 0);
      this.gadgetEl.classList.toggle('on', gd.out);
    });

    this.set('rp', f.rp ?? '', () => {
      this.rpEl.style.display = f.rp ? '' : 'none';
      this.rpEl.replaceChildren();
      if (!f.rp) return;
      // "Squad RP 550 · B": the key goes in a cap.
      const m = /^(.*) · (\S+)$/.exec(f.rp);
      el('span', 'rp-text', this.rpEl).textContent = m ? m[1]! : f.rp;
      if (m) el('span', 'keycap', this.rpEl).textContent = m[2]!;
    });

    const hp = Math.ceil(f.health);
    this.set('hp', String(hp), () => {
      this.health.replaceChildren();
      el('span', 'hp-num', this.health).textContent = String(hp);
      el('span', 'hp-label', this.health).textContent = t('hud.hp');
      this.healthFill.style.width = `${hp}%`;
      this.root.classList.toggle('hp-low', hp <= 35);
    });

    // Hurt vignette: persistent with low health plus a pulse on each hit.
    this.hurtPulse = Math.max(0, this.hurtPulse - dt * 1.6);
    const lowHp = Math.pow(Math.max(0, 1 - f.health / 100), 1.6);
    const hurt = Math.min(1, lowHp * 0.8 + this.hurtPulse * 0.6).toFixed(2);
    this.set('hurt', hurt, () => (this.hurt.style.opacity = hurt));

    const flash = f.flash.toFixed(2);
    this.set('flash', flash, () => (this.flashEl.style.opacity = flash));

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]!;
      a.life -= dt;
      if (a.life <= 0) {
        a.el.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      // Screen angle: 0 = ahead (top of ring), clockwise positive.
      const rel = viewYaw - a.worldYaw;
      a.el.style.transform = `rotate(${rel}rad)`;
      a.el.style.opacity = Math.min(1, a.life / (ARC_LIFE * 0.5)).toFixed(2);
    }

    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const item = this.feedItems[i]!;
      item.life -= dt;
      if (item.life <= 0) {
        item.el.remove();
        this.feedItems.splice(i, 1);
      } else if (item.life < 1) item.el.style.opacity = item.life.toFixed(2);
    }

    const killer = f.killedBy ? `\n${t('hud.killedBy')} ${f.killedBy}` : '';
    const gone = f.respawnIn !== null;
    const deathText = gone ? `${t('hud.dead')}${killer}\n${t('hud.respawnIn')} ${Math.ceil(f.respawnIn!)}` : '';
    this.set('death', deathText, () => {
      this.deathText.textContent = deathText;
      this.death.classList.toggle('on', gone);
    });
    this.updateDown(f.down, killer);
    const kitKey = f.medkit ? `${f.medkit.text}|${f.medkit.ready}` : '';
    this.set('medkit', kitKey, () => {
      this.medkit.style.display = f.medkit ? '' : 'none';
      if (!f.medkit) return;
      chip(this.medkit, this.touch ? '' : 'Q', t('hud.medkit'), f.medkit.text, 'medkit');
      this.medkit.classList.toggle('ready', f.medkit.ready);
    });
    const pr = f.prompt;
    const prKey = pr ? `${pr.text}|${pr.progress === null ? '' : Math.round(pr.progress * 50)}` : '';
    this.set('prompt', prKey, () => {
      this.promptEl.classList.toggle('on', !!pr);
      if (!pr) return;
      // "E · Get in: jeep" / "E (hold) · Revive ...": the key in a cap.
      this.promptText.replaceChildren();
      const keyed = [t('act.holdE'), t('act.pressE')].find((k) => pr.text.startsWith(`${k} · `));
      if (keyed) el('span', 'keycap', this.promptText).textContent = keyed;
      el('span', 'prompt-what', this.promptText).textContent = keyed ? pr.text.slice(keyed.length + 3) : pr.text;
      this.promptEl.classList.toggle('holding', pr.progress !== null);
      this.promptFill.style.width = `${Math.round((pr.progress ?? 0) * 100)}%`;
    });
    this.updateZone(f.zone, dead);
    this.updateSquad(f.squad);

    for (let i = this.xpItems.length - 1; i >= 0; i--) {
      const x = this.xpItems[i]!;
      x.life -= dt;
      if (x.life <= 0) {
        x.el.remove();
        this.xpItems.splice(i, 1);
      } else if (x.life < 0.5) x.el.style.opacity = (x.life / 0.5).toFixed(2);
    }
    for (let i = this.noticeItems.length - 1; i >= 0; i--) {
      const n = this.noticeItems[i]!;
      n.life -= dt;
      if (n.life <= 0) {
        n.el.remove();
        this.noticeItems.splice(i, 1);
      } else if (n.life < 0.6) n.el.style.opacity = (n.life / 0.6).toFixed(2);
    }

    const scoreText = f.score && !f.zone ? `${t('hud.allies')} ${f.score.allies} : ${f.score.enemies} ${t('hud.enemies')}` : '';
    this.set('score', scoreText, () => {
      this.score.textContent = scoreText;
      this.score.style.display = scoreText ? 'block' : 'none';
    });

    const fpsText = f.fps === null ? '' : `${f.fps} FPS${f.debug ? ` · ${f.debug}` : ''}`;
    this.set('fps', fpsText, () => (this.fps.textContent = fpsText));
  }

  /** Down: grey screen, bleed-out countdown, who is coming to help, give-up progress. */
  private updateDown(d: HudFrame['down'], killer: string): void {
    const text = d
      ? [
          `${t('hud.down')}${killer}`,
          d.reviver ? `${d.reviver} ${t('hud.beingRevived')}` : `${t('hud.bleedOut')} ${Math.ceil(d.left)}`,
          this.touch ? t('hud.giveUpTouch') : t('hud.giveUp'),
        ].join('\n')
      : '';
    const bar = d ? Math.round((d.reviver ? d.revive : d.giveUp) * 50) : 0;
    this.set('down', `${text}|${bar}|${d?.reviver ? 1 : 0}`, () => {
      this.downEl.classList.toggle('on', !!d);
      this.root.classList.toggle('is-down', !!d);
      this.downText.textContent = text;
      this.downEl.classList.toggle('reviving', !!d?.reviver);
      this.downBar.style.width = `${bar * 2}%`;
    });
  }

  private updateZone(z: ZoneHud | null, dead: boolean): void {
    const st = z?.status ?? null;
    const barKey = z
      ? `${z.score.allies}|${z.score.enemies}|${Math.round(z.score.fill.allies * 100)}|${Math.round(z.score.fill.enemies * 100)}|${st ? `${st.text}${st.tone}${st.urgent}` : ''}|${z.zones.map((s) => `${s.id}${s.owner}${s.pushing}${s.contested}${s.locked}${Math.round(s.progress * 20)}`).join()}`
      : '';
    this.set('zoneBar', barKey, () => {
      this.zoneBar.style.display = z ? 'flex' : 'none';
      this.root.classList.toggle('has-zone-status', !!st);
      if (!z) return;
      this.zoneBar.replaceChildren();
      // Score blocks: the number over a gauge that drains (tickets) or fills (points) toward the middle.
      const score = (side: 'ally' | 'enemy', text: string, fill: number) => {
        const box = el('div', `zb-tickets zb-${side}`, this.zoneBar);
        el('div', 'zb-num', box).textContent = text;
        el('i', '', el('div', 'zb-gauge', box)).style.width = `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`;
      };
      score('ally', z.score.allies, z.score.fill.allies);
      const zones = el('div', 'zb-zones', this.zoneBar);
      for (const s of z.zones) {
        const cell = el('div', `zb-zone own-${s.owner ?? 'none'}${s.contested ? ' contested' : ''}${s.locked ? ' locked' : ''}${s.pushing ? ` pushing push-by-${s.pushing}` : ''}`, zones);
        // Capture progress runs round the badge (Modern Warfare style).
        if (s.pushing) cell.style.setProperty('--p', s.progress.toFixed(3));
        el('span', 'zb-id', cell).textContent = s.id;
      }
      score('enemy', z.score.enemies, z.score.fill.enemies);
      if (st) el('div', `zb-status tone-${st.tone}${st.urgent ? ' urgent' : ''}`, this.zoneBar).textContent = st.text;
      // Score bars under the minimap: ours over theirs.
      this.mscore.replaceChildren();
      const row = (side: 'ally' | 'enemy', label: string, text: string, fill: number) => {
        const r = el('div', `ms-row ms-${side}`, this.mscore);
        el('span', 'ms-name', r).textContent = label;
        el('i', '', el('div', 'ms-bar', r)).style.width = `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`;
        el('span', 'ms-num', r).textContent = text;
      };
      row('ally', t('hud.allies'), z.score.allies, z.score.fill.allies);
      row('enemy', t('hud.enemies'), z.score.enemies, z.score.fill.enemies);
    });
    this.mscore.style.display = z ? '' : 'none';
    const here = z?.here && !dead ? z.here : null;
    const hereKey = here ? `${here.id}|${here.text}|${here.tone}|${Math.round(here.progress * 100)}` : '';
    this.set('zoneHere', hereKey, () => {
      this.zoneHere.className = here ? `zone-here on tone-${here.tone}` : 'zone-here';
      if (!here) return;
      this.zoneHereText.textContent = `${here.id} · ${here.text}`;
      this.zoneHereFill.style.width = `${Math.round(here.progress * 100)}%`;
    });
  }

  private updateSquad(sq: SquadHud | null): void {
    const key = sq ? `${sq.name}|${sq.members.map((m) => m.name + m.state).join()}` : '';
    this.set('squad', key, () => {
      this.squadEl.replaceChildren();
      if (!sq) return;
      el('div', 'hs-title', this.squadEl).textContent = `${t('squad.label')} ${sq.name}`;
      for (const m of sq.members) {
        const row = el('div', `hs-member m-${m.state}${m.you ? ' you' : ''}`, this.squadEl);
        el('span', 'dot', row);
        el('span', 'name', row).textContent = m.name;
      }
    });
  }
}
