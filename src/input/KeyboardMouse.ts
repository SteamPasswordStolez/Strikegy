import type { InputSource, InputState } from './InputState';
import { ACTIONS, bindings, onBindingsChange, type Action } from './bindings';
import { typing } from './typing';

/** Base radians per mouse count at sensitivity 1.0. */
const MOUSE_RAD_PER_COUNT = 0.0022;

/** Pulse actions: a press is queued until the next `apply`. */
const PULSES = ['jump', 'fire', 'reload', 'medkit', 'interact', 'build', 'grenade', 'melee', 'support', 'view', 'crouch', 'inspect'] as const;
type Pulse = (typeof PULSES)[number];

export class KeyboardMouse implements InputSource {
  /** Codes held down: keys (`KeyboardEvent.code`) and mouse buttons (`Mouse0`..`Mouse4`). */
  private keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  private queued = new Set<Pulse>();
  private cycleQueued = 0;
  private slotQueued = -1;
  /** One toggle press on the next apply (the crouch mode changed while crouched). */
  private flipCrouch = false;
  /** Code -> the actions it does (rebuilt when the bindings change). */
  private byCode = new Map<string, Action[]>();
  private disposers: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    private readonly getSensitivity: () => number,
    private readonly getInvertY: () => boolean,
    /** Crouch while the key is held instead of a press toggling it (setting). */
    private readonly getCrouchHold: () => boolean = () => false,
  ) {
    this.rebind();
    this.disposers.push(onBindingsChange(() => this.rebind()));
    this.listen<KeyboardEvent>(window, 'keydown', (e) => {
      // Typing in the chat (or any text box) moves nobody.
      if (e.repeat || typing(e)) return;
      this.press(e.code);
      if (this.locked && (this.byCode.has(e.code) || e.code === 'Tab')) e.preventDefault();
    });
    this.listen<KeyboardEvent>(window, 'keyup', (e) => this.keys.delete(e.code));
    // Ctrl+W (a crouch-walk when crouch is on Ctrl) would close the tab: browsers don't
    // let a page take Ctrl+W, but they ask before closing when the page objects, and in
    // fullscreen the Keyboard Lock API hands the keys to the game.
    this.listen<BeforeUnloadEvent>(window, 'beforeunload', (e) => {
      if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.listen(document, 'fullscreenchange', () => {
      const kb = (navigator as Navigator & { keyboard?: { lock?(codes?: string[]): Promise<void>; unlock?(): void } }).keyboard;
      if (document.fullscreenElement) kb?.lock?.([...this.byCode.keys()].filter((c) => !c.startsWith('Mouse'))).catch(() => {});
      else kb?.unlock?.();
    });
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen<MouseEvent>(target, 'mousedown', (e) => {
      if (!this.locked) return;
      this.press(`Mouse${e.button}`);
    });
    this.listen<MouseEvent>(window, 'mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
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

  private rebind(): void {
    this.byCode.clear();
    const b = bindings();
    for (const a of ACTIONS) for (const c of b[a]) this.byCode.set(c, [...(this.byCode.get(c) ?? []), a]);
  }

  private press(code: string): void {
    this.keys.add(code);
    for (const a of this.byCode.get(code) ?? []) {
      const slot = /^slot([1-9])$/.exec(a);
      if (slot) this.slotQueued = Number(slot[1]) - 1;
      else if ((PULSES as readonly string[]).includes(a)) this.queued.add(a as Pulse);
    }
  }

  /** Any key of the action held. */
  private held(a: Action): boolean {
    for (const c of bindings()[a]) if (this.keys.has(c)) return true;
    return false;
  }

  /** Takes a queued press. */
  private take(p: Pulse): boolean {
    return this.queued.delete(p);
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
    const x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    const y = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    if (x || y) {
      s.moveX = x;
      s.moveY = y;
    }
    const scale = MOUSE_RAD_PER_COUNT * this.getSensitivity();
    s.lookYaw += -this.dx * scale;
    s.lookPitch += -this.dy * scale * (this.getInvertY() ? -1 : 1);
    this.dx = 0;
    this.dy = 0;

    s.fire ||= this.held('fire');
    s.firePressed ||= this.take('fire');
    s.ads ||= this.held('ads');
    s.sprint ||= this.held('sprint');
    if (this.getCrouchHold()) {
      this.take('crouch');
      s.crouch ||= this.held('crouch');
    } else s.crouchToggle ||= this.take('crouch');
    s.crouchToggle ||= this.flipCrouch;
    this.flipCrouch = false;
    s.scoreboard ||= this.held('scoreboard');
    s.jump ||= this.take('jump');
    s.reload ||= this.take('reload');
    if (this.cycleQueued) s.weaponCycle = this.cycleQueued;
    if (this.slotQueued >= 0) s.weaponSlot = this.slotQueued;
    s.throwGrenade ||= this.take('grenade');
    s.medkit ||= this.take('medkit');
    s.interactPressed ||= this.take('interact');
    s.buildMode ||= this.take('build');
    s.interact ||= this.held('interact');
    s.jumpHeld ||= this.held('jump');
    s.holdBreath ||= this.held('breath');
    s.melee ||= this.take('melee');
    s.inspect ||= this.take('inspect');
    s.support ||= this.take('support');
    s.viewToggle ||= this.take('view');
    this.cycleQueued = 0;
    this.slotQueued = -1;
  }

  /** Sends one crouch toggle (here and to the game server): stands up from a toggled crouch when the mode becomes hold. */
  flipCrouchOnce(): void {
    this.flipCrouch = true;
  }

  private releaseAll(): void {
    this.keys.clear();
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
