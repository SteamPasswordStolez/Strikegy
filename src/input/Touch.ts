import { t, type MessageKey } from '@/i18n';
import type { InputSource, InputState } from './InputState';

const LOOK_RAD_PER_PX = 0.006;
const STICK_RADIUS = 56;
/** Holding the grenade button this long switches grenade type instead of throwing. */
const LONG_PRESS_MS = 420;
/** Stick pushed this far forward sprints. */
const SPRINT_PUSH = 0.92;

type ButtonAction = 'fire' | 'fire2' | 'ads' | 'jump' | 'reload' | 'crouch' | 'grenade' | 'switch' | 'melee' | 'inspect' | 'pause';

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
  private pulses = new Set<ButtonAction | 'cycleGrenade'>();
  private adsToggled = false;
  private crouchToggled = false;
  private grenadeDown: { id: number; at: number; timer: number } | null = null;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
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
    this.root.appendChild(this.stickEl);

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
      // Invisible, over the ammo counter (top right): tap it to inspect the weapon.
      ['inspect', null],
      ['pause', null],
    ];
    for (const [action, label] of buttons) {
      const b = document.createElement('div');
      b.className = `touch-btn touch-${action}`;
      if (label) b.textContent = t(label);
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
    if (action === 'grenade') {
      // Tap throws; a long press switches the grenade type.
      if (down && !this.grenadeDown) {
        const id = touches[0]!.identifier;
        const timer = window.setTimeout(() => {
          if (this.grenadeDown?.id !== id) return;
          this.pulses.add('cycleGrenade');
          this.grenadeDown = null;
          btn.classList.remove('held');
          navigator.vibrate?.(15);
        }, LONG_PRESS_MS);
        this.grenadeDown = { id, at: performance.now(), timer };
        btn.classList.add('held');
      } else if (!down && this.grenadeDown) {
        window.clearTimeout(this.grenadeDown.timer);
        if (performance.now() - this.grenadeDown.at < LONG_PRESS_MS) this.pulses.add('grenade');
        this.grenadeDown = null;
        btn.classList.remove('held');
      }
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
    s.jump ||= this.pulses.has('jump');
    s.reload ||= this.pulses.has('reload');
    s.throwGrenade ||= this.pulses.has('grenade');
    s.cycleGrenade ||= this.pulses.has('cycleGrenade');
    if (this.pulses.has('switch')) s.weaponCycle = 1;
    s.melee ||= this.pulses.has('melee');
    s.inspect ||= this.pulses.has('inspect');
    this.pulses.clear();
  }

  /** Shows the selected grenade type and how many are left on its button. */
  setGrenade(label: string, count: number): void {
    const b = this.buttons.get('grenade')!;
    const text = `${label} ${count}`;
    if (b.textContent !== text) b.textContent = text;
    b.classList.toggle('empty', count === 0);
  }

  /** Drops toggles (after death / respawn) so the player doesn't spawn aiming or crouched. */
  reset(): void {
    this.adsToggled = false;
    this.crouchToggled = false;
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
