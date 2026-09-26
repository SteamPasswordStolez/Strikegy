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
  fps: number | null;
  debug: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** DOM heads-up display. Only touches the DOM when values change. */
export class HUD {
  readonly root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private ammo: HTMLDivElement;
  private weapon: HTMLDivElement;
  private reloadBar: HTMLDivElement;
  private reloadFill: HTMLDivElement;
  private health: HTMLDivElement;
  private fps: HTMLDivElement;
  private scope: HTMLDivElement;
  private hitTimer = 0;
  private last: Record<string, string> = {};

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.crosshair = el('div', 'crosshair', this.root);
    for (const side of ['t', 'b', 'l', 'r']) el('div', `ch ch-${side}`, this.crosshair);
    el('div', 'ch-dot', this.crosshair);
    this.hitmarker = el('div', 'hitmarker', this.root);
    this.scope = el('div', 'scope', this.root);

    const bottomRight = el('div', 'hud-br', this.root);
    this.weapon = el('div', 'hud-weapon', bottomRight);
    this.ammo = el('div', 'hud-ammo', bottomRight);
    this.reloadBar = el('div', 'hud-reload', bottomRight);
    this.reloadFill = el('div', 'hud-reload-fill', this.reloadBar);

    const bottomLeft = el('div', 'hud-bl', this.root);
    this.health = el('div', 'hud-health', bottomLeft);
    this.fps = el('div', 'hud-fps', this.root);
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

  update(f: HudFrame, dt: number): void {
    this.hitTimer -= dt;
    if (this.hitTimer <= 0 && this.hitmarker.classList.contains('show')) this.hitmarker.className = 'hitmarker';

    const gap = Math.round(f.crosshairGap);
    this.set('gap', String(gap), () => this.crosshair.style.setProperty('--gap', `${gap}px`));
    const chOpacity = (1 - f.adsBlend).toFixed(2);
    this.set('chOp', chOpacity, () => (this.crosshair.style.opacity = chOpacity));
    const scoped = f.scoped && f.adsBlend > 0.95;
    this.set('scope', String(scoped), () => this.scope.classList.toggle('on', scoped));

    this.set('weapon', f.weaponName, () => (this.weapon.textContent = f.weaponName));
    const ammoText =
      f.ammo === 0 && f.reserve === 0 ? t('hud.noAmmo') : `${f.ammo} / ${f.reserve}`;
    this.set('ammo', ammoText, () => {
      this.ammo.textContent = ammoText;
      this.ammo.classList.toggle('low', f.ammo <= Math.ceil(f.magSize * 0.25));
    });
    this.set('reloading', String(f.reloading), () => this.reloadBar.classList.toggle('on', f.reloading));
    if (f.reloading) this.reloadFill.style.width = `${Math.round(f.reloadProgress * 100)}%`;

    const hp = `${t('hud.hp')} ${Math.ceil(f.health)}`;
    this.set('hp', hp, () => (this.health.textContent = hp));

    const fpsText = f.fps === null ? '' : `${f.fps} FPS${f.debug ? ` · ${f.debug}` : ''}`;
    this.set('fps', fpsText, () => (this.fps.textContent = fpsText));
  }
}
