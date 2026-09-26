import { t, type MessageKey } from '@/i18n';
import type { InputSource, InputState } from './InputState';

const LOOK_RAD_PER_PX = 0.006;
const STICK_RADIUS = 56;

type ButtonAction = 'fire' | 'ads' | 'jump' | 'reload' | 'crouch' | 'grenade';

/**
 * Basic touch controls: left side = floating move stick, right side = look drag,
 * plus action buttons. The fire button also works as a look surface while held.
 */
export class TouchControls implements InputSource {
  readonly root: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookTouches = new Map<number, { x: number; y: number }>();
  private lookDx = 0;
  private lookDy = 0;
  private firing = false;
  private pulses = new Set<ButtonAction>();
  private adsToggled = false;
  private crouchToggled = false;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly getSensitivity: () => number,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'touch-stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'touch-knob';
    this.stickEl.appendChild(this.knobEl);
    this.root.appendChild(this.stickEl);

    const buttons: [ButtonAction, MessageKey][] = [
      ['fire', 'touch.fire'],
      ['ads', 'touch.ads'],
      ['jump', 'touch.jump'],
      ['reload', 'touch.reload'],
      ['crouch', 'touch.crouch'],
      ['grenade', 'touch.grenade'],
    ];
    for (const [action, label] of buttons) {
      const b = document.createElement('div');
      b.className = `touch-btn touch-${action}`;
      b.textContent = t(label);
      b.addEventListener('touchstart', (e) => this.onButton(e, action, true), { passive: false });
      b.addEventListener('touchend', (e) => this.onButton(e, action, false), { passive: false });
      b.addEventListener('touchcancel', (e) => this.onButton(e, action, false), { passive: false });
      if (action === 'fire') {
        b.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
      }
      this.root.appendChild(b);
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
    if (action === 'fire') {
      this.firing = down;
      for (const tch of Array.from(e.changedTouches)) {
        if (down) this.lookTouches.set(tch.identifier, { x: tch.clientX, y: tch.clientY });
        else this.lookTouches.delete(tch.identifier);
      }
      return;
    }
    if (!down) return;
    if (action === 'ads') this.adsToggled = !this.adsToggled;
    else if (action === 'crouch') this.crouchToggled = !this.crouchToggled;
    else this.pulses.add(action);
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.clientX < window.innerWidth * 0.45 && this.stickId === null) {
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
          dx = (dx / len) * STICK_RADIUS;
          dy = (dy / len) * STICK_RADIUS;
        }
        this.stickVec = { x: dx / STICK_RADIUS, y: -dy / STICK_RADIUS };
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
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
      }
      this.lookTouches.delete(tch.identifier);
    }
  }

  apply(s: InputState): void {
    const { x, y } = this.stickVec;
    if (x || y) {
      s.moveX = x;
      s.moveY = y;
      // Pushing the stick nearly all the way forward sprints.
      s.sprint ||= y > 0.92;
    }
    const scale = LOOK_RAD_PER_PX * this.getSensitivity();
    s.lookYaw += -this.lookDx * scale;
    s.lookPitch += -this.lookDy * scale;
    this.lookDx = 0;
    this.lookDy = 0;
    s.fire ||= this.firing;
    s.ads ||= this.adsToggled;
    s.crouch ||= this.crouchToggled;
    s.jump ||= this.pulses.has('jump');
    s.reload ||= this.pulses.has('reload');
    s.throwGrenade ||= this.pulses.has('grenade');
    this.pulses.clear();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
