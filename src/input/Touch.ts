import { t, type MessageKey } from '@/i18n';
import type { InputSource, InputState } from './InputState';

const LOOK_RAD_PER_PX = 0.006;
const STICK_RADIUS = 56;
/** Stick pushed this far forward sprints. */
const SPRINT_PUSH = 0.92;

type ButtonAction =
  | 'fire'
  | 'fire2'
  | 'ads'
  | 'jump'
  | 'reload'
  | 'crouch'
  | 'grenade'
  | 'switch'
  | 'melee'
  | 'inspect'
  | 'score'
  | 'pause'
  | 'medkit'
  | 'interact'
  | 'giveup'
  | 'build';

/** Button icons: 24x24 stroked paths (currentColor), drawn above the short label. */
const ICONS: Partial<Record<ButtonAction, string>> = {
  fire: '<path d="M9 21V10c0-4 3-7 3-7s3 3 3 7v11z"/><path d="M7.5 21h9"/>',
  fire2: '<path d="M9 21V10c0-4 3-7 3-7s3 3 3 7v11z"/><path d="M7.5 21h9"/>',
  ads: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v5h-5"/>',
  grenade: '<circle cx="11" cy="14.5" r="6"/><path d="M8.5 8.8V6.5h5v2.3M13.5 6.5l4-2.5"/>',
  switch: '<path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/>',
  jump: '<path d="M6 12l6-6 6 6M6 19l6-6 6 6"/>',
  crouch: '<path d="M6 6l6 6 6-6M5 19h14"/>',
  melee: '<path d="M4 20l5-5M7.5 12.5l4 4M10 14.5L20 4.5v2.5l-8 9.5"/>',
  inspect: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  medkit: '<rect x="3.5" y="6.5" width="17" height="13" rx="2"/><path d="M9 6.5V4.5h6v2M12 10v6M9 13h6"/>',
  interact: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/>',
  giveup: '<path d="M6 6l12 12M18 6L6 18"/>',
  build: '<path d="M14.5 4.5l5 5-3 3-5-5zM13 9l-8.5 8.5 2 2L15 11"/>',
};

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/**
 * Touch controls for phones in landscape: the left side is a floating move
 * stick (push it all the way forward to sprint), the right side drags the
 * view, plus action buttons. Both fire buttons also steer the view while held,
 * so you can shoot and aim with one thumb. Layout lives in CSS (sized by
 * screen height, clear of the notch).
 */
export class TouchControls implements InputSource {
  readonly root: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookTouches = new Map<number, { x: number; y: number }>();
  private lookDx = 0;
  private lookDy = 0;
  /** Touch ids holding a fire button. */
  private firing = new Set<number>();
  private pulses = new Set<ButtonAction>();
  /** Touches holding the interact / give-up buttons. */
  private interactHeld = 0;
  private giveUpHeld = 0;
  private adsToggled = false;
  private crouchToggled = false;
  private scoreOpen = false;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
  private restEl: HTMLDivElement;
  private readonly buttons = new Map<ButtonAction, HTMLDivElement>();

  constructor(
    parent: HTMLElement,
    private readonly getSensitivity: () => number,
    private readonly onPause: () => void = () => {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'touch-stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'touch-knob';
    this.stickEl.appendChild(this.knobEl);
    // Faint ring where the thumb usually lands, so a new player sees where to move from.
    this.restEl = document.createElement('div');
    this.restEl.className = 'touch-stick-rest';
    this.root.append(this.restEl, this.stickEl);

    const buttons: [ButtonAction, MessageKey | null][] = [
      ['fire', 'touch.fire'],
      ['fire2', null],
      ['ads', 'touch.ads'],
      ['jump', 'touch.jump'],
      ['reload', 'touch.reload'],
      ['crouch', 'touch.crouch'],
      ['grenade', 'touch.grenade'],
      ['switch', 'touch.switch'],
      ['melee', 'touch.melee'],
      ['medkit', 'touch.medkit'],
      // Shown only when there is something to do (revive, hand out a kit); the label says what.
      ['interact', null],
      // Shown while down: hold to give up.
      ['giveup', 'touch.giveUp'],
      // Build mode on / off: shown near build spots and while building (fire builds then).
      ['build', 'touch.build'],
      // Invisible, over the ammo counter (top right): tap it to inspect the weapon.
      ['inspect', null],
      // Invisible, over the zone / ticket bar (top center): tap to open or close the scoreboard.
      ['score', null],
      ['pause', null],
    ];
    for (const [action, label] of buttons) {
      const b = document.createElement('div');
      b.className = `touch-btn touch-${action}`;
      const icon = ICONS[action];
      if (icon) b.insertAdjacentHTML('beforeend', svg(icon));
      if (label) {
        const l = document.createElement('span');
        l.className = 'tb-label';
        l.textContent = t(label);
        b.appendChild(l);
      }
      b.addEventListener('touchstart', (e) => this.onButton(e, action, true), { passive: false });
      b.addEventListener('touchend', (e) => this.onButton(e, action, false), { passive: false });
      b.addEventListener('touchcancel', (e) => this.onButton(e, action, false), { passive: false });
      if (action === 'fire' || action === 'fire2') {
        b.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
      }
      this.root.appendChild(b);
      this.buttons.set(action, b);
    }

    this.root.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    this.root.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.root.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    this.root.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
    parent.appendChild(this.root);
  }

  private onButton(e: TouchEvent, action: ButtonAction, down: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    const touches = Array.from(e.changedTouches);
    const btn = this.buttons.get(action)!;
    if (action === 'fire' || action === 'fire2') {
      for (const tch of touches) {
        if (down) {
          if (this.firing.size === 0) this.pulses.add('fire');
          this.firing.add(tch.identifier);
          this.lookTouches.set(tch.identifier, { x: tch.clientX, y: tch.clientY });
        } else {
          this.firing.delete(tch.identifier);
          this.lookTouches.delete(tch.identifier);
        }
      }
      btn.classList.toggle('held', down);
      return;
    }
    if (action === 'interact' || action === 'giveup') {
      // Held actions (revive, give up): count the touches on the button.
      const n = down ? 1 : -1;
      if (action === 'interact') {
        this.interactHeld = Math.max(0, this.interactHeld + n * touches.length);
        if (down) this.pulses.add('interact');
      } else this.giveUpHeld = Math.max(0, this.giveUpHeld + n * touches.length);
      btn.classList.toggle('held', down);
      return;
    }
    btn.classList.toggle('held', down);
    if (!down) return;
    if (action === 'ads') {
      this.adsToggled = !this.adsToggled;
      btn.classList.toggle('on', this.adsToggled);
    } else if (action === 'crouch') {
      this.crouchToggled = !this.crouchToggled;
      btn.classList.toggle('on', this.crouchToggled);
    } else if (action === 'score') {
      this.scoreOpen = !this.scoreOpen;
    } else if (action === 'pause') {
      this.onPause();
    } else this.pulses.add(action);
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.clientX < window.innerWidth * 0.42 && this.stickId === null) {
        this.stickId = tch.identifier;
        this.stickOrigin = { x: tch.clientX, y: tch.clientY };
        this.stickVec = { x: 0, y: 0 };
        this.stickEl.style.display = 'block';
        this.restEl.style.display = 'none';
        this.stickEl.style.left = `${tch.clientX - STICK_RADIUS}px`;
        this.stickEl.style.top = `${tch.clientY - STICK_RADIUS}px`;
        this.knobEl.style.transform = 'translate(0px, 0px)';
      } else {
        this.lookTouches.set(tch.identifier, { x: tch.clientX, y: tch.clientY });
      }
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    e.stopPropagation();
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.identifier === this.stickId) {
        let dx = tch.clientX - this.stickOrigin.x;
        let dy = tch.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) {
          // Past the rim the stick follows the thumb, so a long drag doesn't strand it.
          const over = len - STICK_RADIUS;
          this.stickOrigin.x += (dx / len) * over;
          this.stickOrigin.y += (dy / len) * over;
          this.stickEl.style.left = `${this.stickOrigin.x - STICK_RADIUS}px`;
          this.stickEl.style.top = `${this.stickOrigin.y - STICK_RADIUS}px`;
          dx = (dx / len) * STICK_RADIUS;
          dy = (dy / len) * STICK_RADIUS;
        }
        this.stickVec = { x: dx / STICK_RADIUS, y: -dy / STICK_RADIUS };
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        this.stickEl.classList.toggle('sprint', this.stickVec.y > SPRINT_PUSH);
        continue;
      }
      const prev = this.lookTouches.get(tch.identifier);
      if (prev) {
        this.lookDx += tch.clientX - prev.x;
        this.lookDy += tch.clientY - prev.y;
        prev.x = tch.clientX;
        prev.y = tch.clientY;
      }
    }
  }

  private onEnd(e: TouchEvent): void {
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.identifier === this.stickId) {
        this.stickId = null;
        this.stickVec = { x: 0, y: 0 };
        this.stickEl.style.display = 'none';
        this.stickEl.classList.remove('sprint');
        this.restEl.style.display = '';
      }
      this.lookTouches.delete(tch.identifier);
      this.firing.delete(tch.identifier);
    }
  }

  apply(s: InputState): void {
    const { x, y } = this.stickVec;
    if (x || y) {
      s.moveX = x;
      s.moveY = y;
      s.sprint ||= y > SPRINT_PUSH;
    }
    const scale = LOOK_RAD_PER_PX * this.getSensitivity();
    s.lookYaw += -this.lookDx * scale;
    s.lookPitch += -this.lookDy * scale;
    this.lookDx = 0;
    this.lookDy = 0;
    s.fire ||= this.firing.size > 0;
    s.firePressed ||= this.pulses.has('fire');
    s.ads ||= this.adsToggled;
    s.crouch ||= this.crouchToggled;
    s.scoreboard ||= this.scoreOpen;
    s.jump ||= this.pulses.has('jump');
    s.reload ||= this.pulses.has('reload');
    s.throwGrenade ||= this.pulses.has('grenade');
    s.medkit ||= this.pulses.has('medkit');
    s.interactPressed ||= this.pulses.has('interact');
    s.interact ||= this.interactHeld > 0;
    s.jumpHeld ||= this.giveUpHeld > 0;
    if (this.pulses.has('switch')) s.weaponCycle = 1;
    s.melee ||= this.pulses.has('melee');
    s.inspect ||= this.pulses.has('inspect');
    s.buildMode ||= this.pulses.has('build');
    this.pulses.clear();
  }

  /** Shows the grenade type carried and how many are left on its button. */
  setGrenade(label: string, count: number): void {
    const b = this.buttons.get('grenade')!;
    const l = b.querySelector('.tb-label')!;
    const text = `${label} ${count}`;
    if (l.textContent !== text) l.textContent = text;
    b.classList.toggle('empty', count === 0);
  }

  /**
   * Situation-dependent buttons: the medkit (greyed while none is ready), the
   * interact button with what it would do (hidden when nothing is in reach)
   * and, while down, the give-up button instead of the fighting controls.
   */
  setContext(c: { medkit: string | null; interact: string | null; downed: boolean; build?: 'near' | 'on' | null }): void {
    const build = this.buttons.get('build')!;
    build.classList.toggle('show', !!c.build);
    build.classList.toggle('on', c.build === 'on');
    const kit = this.buttons.get('medkit')!;
    kit.classList.toggle('empty', c.medkit === null);
    const kl = kit.querySelector('.tb-label')!;
    const kt = c.medkit ?? '';
    if (kl.textContent !== kt) kl.textContent = kt;
    const act = this.buttons.get('interact')!;
    const text = c.interact ?? '';
    if (act.dataset.label !== text) {
      act.dataset.label = text;
      act.querySelector('.tb-label')?.remove();
      if (text) {
        const l = document.createElement('span');
        l.className = 'tb-label';
        l.textContent = text;
        act.appendChild(l);
      }
    }
    act.classList.toggle('off', !c.interact);
    if (!c.interact) this.interactHeld = 0;
    this.root.classList.toggle('downed', c.downed);
    if (!c.downed) this.giveUpHeld = 0;
  }

  /** Lights the reload button up when the magazine runs low. */
  setAmmo(ammo: number, magSize: number, reloading: boolean): void {
    const b = this.buttons.get('reload')!;
    b.classList.toggle('warn', !reloading && ammo <= Math.max(1, Math.floor(magSize * 0.25)));
    b.classList.toggle('on', reloading);
  }

  /** Drops toggles (after death / respawn) so the player doesn't spawn aiming or crouched. */
  reset(): void {
    this.adsToggled = false;
    this.crouchToggled = false;
    this.scoreOpen = false;
    this.buttons.get('ads')!.classList.remove('on');
    this.buttons.get('crouch')!.classList.remove('on');
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
