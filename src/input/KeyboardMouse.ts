import type { InputSource, InputState } from './InputState';

/** Base radians per mouse count at sensitivity 1.0. */
const MOUSE_RAD_PER_COUNT = 0.0022;

export class KeyboardMouse implements InputSource {
  private keys = new Set<string>();
  private buttons = new Set<number>();
  private dx = 0;
  private dy = 0;
  private jumpQueued = false;
  private fireQueued = false;
  private reloadQueued = false;
  private cycleQueued = 0;
  private slotQueued = -1;
  private grenadeQueued = false;
  private medkitQueued = false;
  private interactQueued = false;
  private meleeQueued = false;
  private inspectQueued = false;
  private disposers: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    private readonly getSensitivity: () => number,
    private readonly getInvertY: () => boolean,
  ) {
    this.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'KeyR') this.reloadQueued = true;
      if (e.code === 'KeyQ') this.medkitQueued = true;
      if (e.code === 'KeyE') this.interactQueued = true;
      if (e.code === 'KeyG') this.grenadeQueued = true;
      if (e.code === 'KeyV') this.meleeQueued = true;
      if (e.code === 'Backquote') this.inspectQueued = true;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) this.slotQueued = Number(digit[1]) - 1;
      if (this.locked && ['Space', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault();
    });
    this.listen<KeyboardEvent>(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen<MouseEvent>(target, 'mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      if (e.button === 0) this.fireQueued = true;
    });
    this.listen<MouseEvent>(window, 'mouseup', (e) => this.buttons.delete(e.button));
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
    this.listen<WheelEvent>(target, 'wheel', (e) => {
      if (this.locked && e.deltaY !== 0) this.cycleQueued = e.deltaY > 0 ? 1 : -1;
    });
    this.listen<MouseEvent>(document, 'mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    this.listen(document, 'pointerlockchange', () => {
      if (!this.locked) this.releaseAll();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestLock(): void {
    // unadjustedMovement gives raw input where supported; fall back silently.
    const el = this.target as HTMLElement & {
      requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    const plain = () => {
      try {
        void Promise.resolve(el.requestPointerLock()).catch(() => {});
      } catch {
        /* pointer lock unavailable (e.g. embedded frame) */
      }
    };
    try {
      void Promise.resolve(el.requestPointerLock({ unadjustedMovement: true })).catch(plain);
    } catch {
      plain();
    }
  }

  apply(s: InputState): void {
    const k = this.keys;
    const x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const y = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (x || y) {
      s.moveX = x;
      s.moveY = y;
    }
    const scale = MOUSE_RAD_PER_COUNT * this.getSensitivity();
    s.lookYaw += -this.dx * scale;
    s.lookPitch += -this.dy * scale * (this.getInvertY() ? -1 : 1);
    this.dx = 0;
    this.dy = 0;

    s.fire ||= this.buttons.has(0);
    s.firePressed ||= this.fireQueued;
    this.fireQueued = false;
    s.ads ||= this.buttons.has(2);
    s.sprint ||= k.has('ShiftLeft');
    s.crouch ||= k.has('ControlLeft') || k.has('KeyC');
    s.scoreboard ||= k.has('KeyZ');
    s.jump ||= this.jumpQueued;
    s.reload ||= this.reloadQueued;
    if (this.cycleQueued) s.weaponCycle = this.cycleQueued;
    if (this.slotQueued >= 0) s.weaponSlot = this.slotQueued;
    this.jumpQueued = false;
    this.reloadQueued = false;
    s.throwGrenade ||= this.grenadeQueued;
    s.medkit ||= this.medkitQueued;
    s.interactPressed ||= this.interactQueued;
    s.interact ||= k.has('KeyE');
    s.jumpHeld ||= k.has('Space');
    this.medkitQueued = false;
    this.interactQueued = false;
    this.cycleQueued = 0;
    this.slotQueued = -1;
    this.grenadeQueued = false;
    s.melee ||= this.meleeQueued;
    s.inspect ||= this.inspectQueued;
    this.meleeQueued = false;
    this.inspectQueued = false;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.buttons.clear();
  }

  private listen<T extends Event = Event>(el: EventTarget, type: string, fn: (e: T) => void): void {
    const h = fn as EventListener;
    el.addEventListener(type, h);
    this.disposers.push(() => el.removeEventListener(type, h));
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
  }
}
