import { t, type MessageKey } from '@/i18n';
import type { InputSource, InputState } from './InputState';
import { LAYOUT_BUTTONS, SIZE_MAX, SIZE_MIN, loadLayout, saveLayout, type LayoutButton, type TouchLayout } from './touchLayout';

const LOOK_RAD_PER_PX = 0.006;
const STICK_RADIUS = 56;
/**
 * Sprinting: the thumb pushed this far past the stick's middle (in stick
 * radii, so out beyond the rim) and mostly forward. The stick itself stays
 * where the thumb first landed (it used to follow the thumb past the rim,
 * which moved it out from under the thumb before a sprint even started).
 */
const SPRINT_REACH = 1.3;
const SPRINT_FORWARD = 0.75;
/** Thumb wobble around the middle that doesn't count as moving (share of the radius). */
const DEAD_ZONE = 0.12;

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
  | 'build'
  | 'gadget'
  | 'breath'
  | 'support'
  | 'gas'
  | 'brake';

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
  gadget: '<path d="M3 15l12-6M15 9l3-1.5 2.5 1.5-2.5 2L15 11zM6 13.5l2 4"/>',
  support: '<path d="M12 3v18M12 3l7 4-7 4"/><path d="M7 21h10"/>',
  breath: '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>',
  gas: '<path d="M6 15l6-6 6 6"/><path d="M6 20l6-6 6 6"/>',
  brake: '<path d="M6 4l6 6 6-6"/><path d="M6 9l6 6 6-6"/>',
};

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/**
 * Touch controls for phones in landscape: the left side is a move stick that
 * stays where the thumb lands (push on past its rim, forward, to sprint; in a
 * driver's seat it steers and pedals work the throttle), the right side drags
 * the view, plus action buttons. Both fire buttons also steer the view while held,
 * so you can shoot and aim with one thumb. Layout lives in CSS (sized by
 * screen height, clear of the notch).
 */
export class TouchControls implements InputSource {
  readonly root: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  /** Thumb pushed out past the rim, forward: sprint. */
  private stickSprint = false;
  /** In a vehicle: 'drive' / 'fly' (driver's / pilot's seat: pedals, the stick steers), 'seat' (any other seat), or null. */
  private ride: 'drive' | 'fly' | 'seat' | null = null;
  /** Touches holding the pedals (gas / brake-reverse; throttle up / down in a plane) and, aboard, the aim button. */
  private gasHeld = 0;
  private brakeHeld = 0;
  private adsHeld = 0;
  private lookTouches = new Map<number, { x: number; y: number }>();
  private lookDx = 0;
  private lookDy = 0;
  /** Touch ids holding a fire button. */
  private firing = new Set<number>();
  private pulses = new Set<ButtonAction>();
  /** Touches holding the interact / give-up buttons. */
  private interactHeld = 0;
  private giveUpHeld = 0;
  private breathHeld = 0;
  private adsToggled = false;
  private crouchToggled = false;
  private scoreOpen = false;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
  private restEl: HTMLDivElement;
  private readonly buttons = new Map<ButtonAction, HTMLDivElement>();
  /** Player-arranged button places (see `editLayout`). */
  private layout: TouchLayout = loadLayout();
  /** Layout editing: the toolbar, the picked button and the drag in progress. */
  private editor: { bar: HTMLDivElement; done: () => void; picked: LayoutButton | null; drag: number | null; offX: number; offY: number } | null = null;

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
      // Class gadget (panzerfaust, rifle smoke, beacon, mines): shown when the class has one.
      ['gadget', 'touch.gadget'],
      // Hold your breath: shown while looking down a scope.
      ['breath', 'touch.breath'],
      // Squad call-ins (squad leaders in bot matches), beside the minimap.
      ['support', 'touch.support'],
      // Pedals, shown in the driver's / pilot's seat (the stick then steers).
      ['gas', 'touch.gas'],
      ['brake', 'touch.brake'],
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

    for (const id of LAYOUT_BUTTONS) this.place(id);

    this.root.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    this.root.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.root.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    this.root.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
    parent.appendChild(this.root);
  }

  private onButton(e: TouchEvent, action: ButtonAction, down: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.editor) {
      this.editTouch(e, down ? 'start' : 'end', action);
      return;
    }
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
    if (action === 'breath') {
      this.breathHeld = Math.max(0, this.breathHeld + (down ? 1 : -1) * touches.length);
      btn.classList.toggle('held', down);
      return;
    }
    if (action === 'gas' || action === 'brake') {
      const n = (down ? 1 : -1) * touches.length;
      if (action === 'gas') this.gasHeld = Math.max(0, this.gasHeld + n);
      else this.brakeHeld = Math.max(0, this.brakeHeld + n);
      btn.classList.toggle('held', down);
      return;
    }
    if (action === 'ads' && this.ride) {
      // Aboard, the aim button is the second weapon's trigger (missiles, rocket pods): held, not a toggle.
      this.adsHeld = Math.max(0, this.adsHeld + (down ? 1 : -1) * touches.length);
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
      // In a vehicle the same button switches first / third person.
      this.pulses.add('crouch');
      if (this.ride) return;
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
    if (this.editor) {
      this.editTouch(e, 'start', null);
      return;
    }
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.clientX < window.innerWidth * 0.42 && this.stickId === null) {
        this.stickId = tch.identifier;
        this.stickOrigin = { x: tch.clientX, y: tch.clientY };
        this.stickVec = { x: 0, y: 0 };
        this.stickSprint = false;
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
    if (this.editor) {
      this.editTouch(e, 'move', null);
      return;
    }
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.identifier === this.stickId) {
        // The stick stays put; the knob stops at the rim while the thumb can go on past it.
        const dx = tch.clientX - this.stickOrigin.x;
        const dy = tch.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        const reach = Math.min(len, STICK_RADIUS);
        const kx = len > 0 ? (dx / len) * reach : 0;
        const ky = len > 0 ? (dy / len) * reach : 0;
        const live = len > STICK_RADIUS * DEAD_ZONE;
        this.stickVec = live ? { x: kx / STICK_RADIUS, y: -ky / STICK_RADIUS } : { x: 0, y: 0 };
        this.stickSprint = !this.ride && len > STICK_RADIUS * SPRINT_REACH && -dy / len > SPRINT_FORWARD;
        this.knobEl.style.transform = `translate(${kx}px, ${ky}px)`;
        this.stickEl.classList.toggle('sprint', this.stickSprint);
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
    if (this.editor) {
      this.editTouch(e, 'end', null);
      return;
    }
    for (const tch of Array.from(e.changedTouches)) {
      if (tch.identifier === this.stickId) {
        this.stickId = null;
        this.stickVec = { x: 0, y: 0 };
        this.stickSprint = false;
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
    if (this.ride === 'drive' || this.ride === 'fly') {
      // Driving: the stick steers; the pedals work the throttle (the stick's
      // forward / back only counts while neither pedal is held).
      const pedals = (this.gasHeld > 0 ? 1 : 0) - (this.brakeHeld > 0 ? 1 : 0);
      if (x) s.moveX = x;
      if (pedals || this.gasHeld || this.brakeHeld) s.moveY = pedals;
      else if (y) s.moveY = y;
    } else if (x || y) {
      s.moveX = x;
      s.moveY = y;
      s.sprint ||= this.stickSprint;
    }
    if (this.ride) s.ads ||= this.adsHeld > 0;
    const scale = LOOK_RAD_PER_PX * this.getSensitivity();
    s.lookYaw += -this.lookDx * scale;
    s.lookPitch += -this.lookDy * scale;
    this.lookDx = 0;
    this.lookDy = 0;
    s.fire ||= this.firing.size > 0;
    s.firePressed ||= this.pulses.has('fire');
    if (!this.ride) s.ads ||= this.adsToggled;
    s.crouch ||= this.crouchToggled;
    s.scoreboard ||= this.scoreOpen;
    s.jump ||= this.pulses.has('jump');
    s.reload ||= this.pulses.has('reload');
    s.throwGrenade ||= this.pulses.has('grenade');
    s.medkit ||= this.pulses.has('medkit');
    s.interactPressed ||= this.pulses.has('interact');
    s.interact ||= this.interactHeld > 0;
    s.jumpHeld ||= this.giveUpHeld > 0;
    s.holdBreath ||= this.breathHeld > 0;
    if (this.pulses.has('switch')) s.weaponCycle = 1;
    s.melee ||= this.pulses.has('melee');
    s.inspect ||= this.pulses.has('inspect');
    s.buildMode ||= this.pulses.has('build');
    s.gadget ||= this.pulses.has('gadget');
    s.support ||= this.pulses.has('support');
    s.viewToggle ||= this.pulses.has('crouch');
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
  setContext(c: {
    medkit: string | null;
    interact: string | null;
    downed: boolean;
    build?: 'near' | 'on' | null;
    /** Class gadget: label with the count left, whether it is in hand; null hides the button. */
    gadget?: { label: string; out: boolean; empty: boolean } | null;
    /** Looking down a scope: show the hold-breath button. */
    scoped?: boolean;
    /** Call-ins: null hides the button, true lights it (menu open / aiming one). */
    support?: boolean | null;
    /** In a vehicle: the driver's seat, a plane's pilot seat, any other seat; null on foot. */
    ride?: 'drive' | 'fly' | 'seat' | null;
  }): void {
    this.setRide(c.ride ?? null);
    const sup = this.buttons.get('support')!;
    sup.classList.toggle('show', c.support !== null && c.support !== undefined);
    sup.classList.toggle('on', !!c.support);
    const br = this.buttons.get('breath')!;
    br.classList.toggle('show', !!c.scoped);
    if (!c.scoped) this.breathHeld = 0;
    const build = this.buttons.get('build')!;
    build.classList.toggle('show', !!c.build);
    build.classList.toggle('on', c.build === 'on');
    const gad = this.buttons.get('gadget')!;
    gad.classList.toggle('show', !!c.gadget);
    gad.classList.toggle('on', !!c.gadget?.out);
    gad.classList.toggle('empty', !!c.gadget?.empty);
    const gl = gad.querySelector('.tb-label')!;
    if (c.gadget && gl.textContent !== c.gadget.label) gl.textContent = c.gadget.label;
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

  /**
   * Aboard a vehicle the on-foot buttons give way: pedals for the driver /
   * pilot (labels for a car or a plane), crouch switches the view, swap
   * changes seats, aim fires the second weapon while held.
   */
  private setRide(ride: 'drive' | 'fly' | 'seat' | null): void {
    if (ride === this.ride) return;
    this.ride = ride;
    this.gasHeld = this.brakeHeld = this.adsHeld = 0;
    this.stickSprint = false;
    this.stickEl.classList.remove('sprint');
    this.root.classList.toggle('riding', !!ride);
    this.root.classList.toggle('driving', ride === 'drive' || ride === 'fly');
    const label = (b: ButtonAction, key: MessageKey): void => {
      const l = this.buttons.get(b)?.querySelector('.tb-label');
      if (l) l.textContent = t(key);
    };
    label('gas', ride === 'fly' ? 'touch.throttleUp' : 'touch.gas');
    label('brake', ride === 'fly' ? 'touch.throttleDown' : 'touch.brake');
    label('crouch', ride ? 'touch.view' : 'touch.crouch');
    label('switch', ride ? 'touch.seat' : 'touch.switch');
    label('ads', ride ? 'touch.alt' : 'touch.ads');
    for (const b of ['gas', 'brake', 'ads', 'crouch'] as const) this.buttons.get(b)!.classList.remove('held');
    // Toggles from on foot don't carry over (and back on foot they start off).
    this.adsToggled = this.crouchToggled = false;
    this.buttons.get('ads')!.classList.remove('on');
    this.buttons.get('crouch')!.classList.remove('on');
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

  /**
   * Button layout editor (from the pause screen): drag buttons anywhere, make
   * the picked one smaller or bigger, reset to the defaults. Saved per device.
   */
  editLayout(done: () => void): void {
    if (this.editor) return;
    const bar = document.createElement('div');
    bar.className = 'touch-edit-bar';
    const hint = document.createElement('span');
    hint.textContent = t('layout.hint');
    bar.appendChild(hint);
    const tool = (label: string, fn: () => void, cls = ''): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `teb-btn ${cls}`;
      b.textContent = label;
      b.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      b.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      bar.appendChild(b);
    };
    tool('−', () => this.resize(-0.1));
    tool('+', () => this.resize(0.1));
    tool(t('layout.reset'), () => {
      this.layout = {};
      for (const id of LAYOUT_BUTTONS) this.place(id);
      saveLayout(this.layout);
    });
    tool(t('layout.done'), () => this.closeEditor(), 'teb-done');
    bar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.root.appendChild(bar);
    this.editor = { bar, done, picked: null, drag: null, offX: 0, offY: 0 };
    this.root.classList.add('editing');
    this.setVisible(true);
  }

  private closeEditor(): void {
    const ed = this.editor;
    if (!ed) return;
    ed.bar.remove();
    if (ed.picked) this.buttons.get(ed.picked)?.classList.remove('picked');
    this.editor = null;
    this.root.classList.remove('editing');
    saveLayout(this.layout);
    ed.done();
  }

  private editTouch(e: TouchEvent, phase: 'start' | 'move' | 'end', action: ButtonAction | null): void {
    const ed = this.editor!;
    for (const tch of Array.from(e.changedTouches)) {
      if (phase === 'start') {
        if (ed.drag !== null) continue;
        const id = action && (LAYOUT_BUTTONS as readonly string[]).includes(action) ? (action as LayoutButton) : null;
        if (ed.picked) this.buttons.get(ed.picked)?.classList.remove('picked');
        ed.picked = id;
        if (!id) continue;
        const b = this.buttons.get(id)!;
        b.classList.add('picked');
        const r = b.getBoundingClientRect();
        ed.drag = tch.identifier;
        ed.offX = tch.clientX - (r.left + r.width / 2);
        ed.offY = tch.clientY - (r.top + r.height / 2);
      } else if (tch.identifier === ed.drag && ed.picked) {
        if (phase === 'end') {
          ed.drag = null;
          saveLayout(this.layout);
          continue;
        }
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.layout[ed.picked] = {
          x: Math.min(0.98, Math.max(0.02, (tch.clientX - ed.offX) / w)),
          y: Math.min(0.98, Math.max(0.02, (tch.clientY - ed.offY) / h)),
          s: this.layout[ed.picked]?.s ?? 1,
        };
        this.place(ed.picked);
      }
    }
  }

  /** Changes the picked button's size (placing it where it is now if it had no custom place yet). */
  private resize(step: number): void {
    const id = this.editor?.picked;
    if (!id) return;
    let p = this.layout[id];
    if (!p) {
      const r = this.buttons.get(id)!.getBoundingClientRect();
      p = { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight, s: 1 };
    }
    this.layout[id] = { ...p, s: Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round((p.s + step) * 10) / 10)) };
    this.place(id);
    saveLayout(this.layout);
  }

  /** Puts a button at its custom place, or back in its CSS default. */
  private place(id: LayoutButton): void {
    const b = this.buttons.get(id);
    if (!b) return;
    const p = this.layout[id];
    b.classList.toggle('custom', !!p);
    b.style.left = p ? `${(p.x * 100).toFixed(2)}%` : '';
    b.style.top = p ? `${(p.y * 100).toFixed(2)}%` : '';
    if (p) b.style.setProperty('--s', String(p.s));
    else b.style.removeProperty('--s');
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
