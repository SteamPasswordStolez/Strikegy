import { t } from '@/i18n';

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
  scoped: boolean;
  grenadeLabel: string;
  grenadeCount: number;
  /** 0..1 white-out from flashbangs. */
  flash: number;
  /** Seconds until respawn, or null while alive. */
  respawnIn: number | null;
  /** Who killed the player (bot matches), shown on the death screen. */
  killedBy: string | null;
  /** Team kill counts (bot matches), or null on the range. */
  score: { allies: number; enemies: number } | null;
  /** Zone mode: tickets and zone states from the player's point of view. */
  zone: ZoneHud | null;
  fps: number | null;
  debug: string | null;
}

export type Side = 'ally' | 'enemy';

export interface ZoneHud {
  tickets: { allies: number; enemies: number };
  zones: { id: string; owner: Side | null; progress: number; pushing: Side | null; contested: boolean }[];
  /** The zone the player stands in, with a status line. */
  here: { id: string; text: string; progress: number; tone: Side | 'neutral' } | null;
  /** While dead: spawn choices (labels) and the selected index. */
  spawn: { options: { label: string; warn: boolean }[]; selected: number } | null;
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
  private weapon: HTMLDivElement;
  private grenade: HTMLDivElement;
  private reloadBar: HTMLDivElement;
  private reloadFill: HTMLDivElement;
  private health: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private fps: HTMLDivElement;
  private scope: HTMLDivElement;
  private hurt: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private damageRing: HTMLDivElement;
  private feed: HTMLDivElement;
  private death: HTMLDivElement;
  private score: HTMLDivElement;
  private deathText: HTMLDivElement;
  private zoneBar: HTMLDivElement;
  private zoneHere: HTMLDivElement;
  private zoneHereFill: HTMLDivElement;
  private zoneHereText: HTMLDivElement;
  private spawnList: HTMLDivElement;
  private notices: HTMLDivElement;
  private noticeItems: { el: HTMLDivElement; life: number }[] = [];
  private arcs: DamageArc[] = [];
  private feedItems: { el: HTMLDivElement; life: number }[] = [];
  private hitTimer = 0;
  private hurtPulse = 0;
  private last: Record<string, string> = {};

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.hurt = el('div', 'hud-hurt', this.root);
    this.scope = el('div', 'scope', this.root);
    this.crosshair = el('div', 'crosshair', this.root);
    for (const side of ['t', 'b', 'l', 'r']) el('div', `ch ch-${side}`, this.crosshair);
    el('div', 'ch-dot', this.crosshair);
    this.hitmarker = el('div', 'hitmarker', this.root);
    this.damageRing = el('div', 'damage-ring', this.root);
    this.feed = el('div', 'killfeed', this.root);

    const bottomRight = el('div', 'hud-br', this.root);
    this.weapon = el('div', 'hud-weapon', bottomRight);
    this.ammo = el('div', 'hud-ammo', bottomRight);
    this.reloadBar = el('div', 'hud-reload', bottomRight);
    this.reloadFill = el('div', 'hud-reload-fill', this.reloadBar);
    this.grenade = el('div', 'hud-grenade', bottomRight);

    const bottomLeft = el('div', 'hud-bl', this.root);
    this.health = el('div', 'hud-health', bottomLeft);
    const bar = el('div', 'hud-healthbar', bottomLeft);
    this.healthFill = el('div', 'hud-healthbar-fill', bar);
    this.fps = el('div', 'hud-fps', this.root);
    this.death = el('div', 'hud-death', this.root);
    this.score = el('div', 'hud-score', this.root);
    this.deathText = el('div', 'hud-death-text', this.death);
    this.spawnList = el('div', 'spawn-list', this.death);
    this.zoneBar = el('div', 'zone-bar', this.root);
    this.zoneHere = el('div', 'zone-here', this.root);
    this.zoneHereText = el('div', 'zone-here-text', this.zoneHere);
    this.zoneHereFill = el('div', 'zone-here-fill', el('div', 'zone-here-track', this.zoneHere));
    this.notices = el('div', 'hud-notices', this.root);
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
    a.textContent = k.attacker === 'You' ? t('feed.you') : k.attacker;
    if (k.weapon || k.headshot) el('span', 'kf-weapon', row).textContent = `${k.weapon ? `[${k.weapon}]` : ''}${k.headshot ? ' ◎' : ''}`;
    el('span', cls(k.victim, k.victimTeam), row).textContent = k.victim === 'You' ? t('feed.you') : k.victim;
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
    const dead = f.respawnIn !== null;
    const chOpacity = dead ? '0' : (1 - f.adsBlend).toFixed(2);
    this.set('chOp', chOpacity, () => (this.crosshair.style.opacity = chOpacity));
    const scoped = f.scoped && f.adsBlend > 0.95 && !dead;
    this.set('scope', String(scoped), () => this.scope.classList.toggle('on', scoped));

    this.set('weapon', f.weaponName, () => (this.weapon.textContent = f.weaponName));
    const ammoText = f.ammo === 0 && f.reserve === 0 ? t('hud.noAmmo') : `${f.ammo} / ${f.reserve}`;
    this.set('ammo', ammoText, () => {
      this.ammo.textContent = ammoText;
      this.ammo.classList.toggle('low', f.ammo <= Math.ceil(f.magSize * 0.25));
    });
    this.set('reloading', String(f.reloading), () => this.reloadBar.classList.toggle('on', f.reloading));
    if (f.reloading) this.reloadFill.style.width = `${Math.round(f.reloadProgress * 100)}%`;
    const gText = `${f.grenadeLabel} ×${f.grenadeCount}`;
    this.set('grenade', gText, () => {
      this.grenade.textContent = gText;
      this.grenade.classList.toggle('empty', f.grenadeCount === 0);
    });

    const hp = Math.ceil(f.health);
    this.set('hp', String(hp), () => {
      this.health.textContent = `${t('hud.hp')} ${hp}`;
      this.healthFill.style.width = `${hp}%`;
      this.healthFill.classList.toggle('low', hp <= 35);
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
    const deathText = dead ? `${t('hud.dead')}${killer}\n${t('hud.respawnIn')} ${Math.ceil(f.respawnIn!)}` : '';
    this.set('death', deathText, () => {
      this.deathText.textContent = deathText;
      this.death.classList.toggle('on', dead);
    });
    this.updateZone(f.zone, dead);

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

  private updateZone(z: ZoneHud | null, dead: boolean): void {
    const barKey = z
      ? `${z.tickets.allies}|${z.tickets.enemies}|${z.zones.map((s) => `${s.id}${s.owner}${s.pushing}${s.contested}${Math.round(s.progress * 20)}`).join()}`
      : '';
    this.set('zoneBar', barKey, () => {
      this.zoneBar.style.display = z ? 'flex' : 'none';
      if (!z) return;
      this.zoneBar.replaceChildren();
      el('div', 'zb-tickets zb-ally', this.zoneBar).textContent = String(z.tickets.allies);
      for (const s of z.zones) {
        const cell = el('div', `zb-zone own-${s.owner ?? 'none'}${s.contested ? ' contested' : ''}`, this.zoneBar);
        if (s.pushing) el('div', `zb-fill push-${s.pushing}`, cell).style.height = `${Math.round(s.progress * 100)}%`;
        el('span', 'zb-id', cell).textContent = s.id;
      }
      el('div', 'zb-tickets zb-enemy', this.zoneBar).textContent = String(z.tickets.enemies);
    });
    const here = z?.here && !dead ? z.here : null;
    const hereKey = here ? `${here.id}|${here.text}|${here.tone}|${Math.round(here.progress * 100)}` : '';
    this.set('zoneHere', hereKey, () => {
      this.zoneHere.className = here ? `zone-here on tone-${here.tone}` : 'zone-here';
      if (!here) return;
      this.zoneHereText.textContent = `${here.id} · ${here.text}`;
      this.zoneHereFill.style.width = `${Math.round(here.progress * 100)}%`;
    });
    const spawn = dead && z?.spawn ? z.spawn : null;
    const spawnKey = spawn ? `${spawn.selected}|${spawn.options.map((o) => `${o.label}${o.warn}`).join()}` : '';
    this.set('spawn', spawnKey, () => {
      this.spawnList.replaceChildren();
      if (!spawn) return;
      el('div', 'spawn-title', this.spawnList).textContent = t('spawn.choose');
      spawn.options.forEach((o, i) => {
        const row = el('div', `spawn-opt${i === spawn.selected ? ' sel' : ''}${o.warn ? ' warn' : ''}`, this.spawnList);
        row.textContent = `${i + 1}  ${o.label}${o.warn ? ` · ${t('spawn.underAttack')}` : ''}`;
      });
    });
  }
}
