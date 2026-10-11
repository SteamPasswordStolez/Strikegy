import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, bind, canShare, conflicts, defaultBindings, keyName, loadBindings, sanitizeBindings, saveBindings } from '@/input/bindings';
import { t } from '@/i18n';
import ko from '@/i18n/ko.json';
import en from '@/i18n/en.json';
import { STEPS, TutorialRun, stepsFor, type TutorialProbe } from '@/core/tutorial';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('key bindings', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('defaults are the old fixed keys, crouch on C alone (Ctrl+W closes the tab)', () => {
    const b = defaultBindings();
    expect(b.forward).toEqual(['KeyW']);
    expect(b.jump).toEqual(['Space']);
    expect(b.reload).toEqual(['KeyR']);
    expect(b.medkit).toEqual(['KeyQ']);
    expect(b.interact).toEqual(['KeyE']);
    expect(b.build).toEqual(['KeyT']);
    expect(b.grenade).toEqual(['KeyG']);
    expect(b.melee).toEqual(['KeyV']);
    expect(b.support).toEqual(['KeyB']);
    expect(b.breath).toEqual(['KeyX']);
    expect(b.scoreboard).toEqual(['KeyZ']);
    expect(b.inspect).toEqual(['Backquote']);
    expect(b.fire).toEqual(['Mouse0']);
    expect(b.ads).toEqual(['Mouse2']);
    expect(b.slot4).toEqual(['Digit4']);
    expect(b.crouch).toEqual(['KeyC']);
    expect(b.view).toEqual(['KeyC']);
    for (const a of ACTIONS) expect(b[a].length).toBeGreaterThan(0);
    // A fresh copy each time: editing it leaves the defaults alone.
    b.jump.push('KeyF');
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space']);
  });

  it('the defaults have no conflicts (C is view only in a vehicle, crouch only on foot)', () => {
    expect(conflicts(defaultBindings()).size).toBe(0);
    expect(canShare('crouch', 'view')).toBe(true);
    expect(canShare('jump', 'view')).toBe(false);
  });

  it('finds a key bound to two actions', () => {
    const b = defaultBindings();
    bind(b, 'melee', 0, 'KeyR');
    const c = conflicts(b);
    expect(c.get('KeyR')).toEqual(['reload', 'melee']);
    expect(c.size).toBe(1);
    // A vehicle-only action and a foot-only one may share; a shared action with both may not.
    bind(b, 'view', 0, 'KeyG');
    expect(conflicts(b).has('KeyG')).toBe(false);
    bind(b, 'jump', 1, 'KeyG');
    expect(conflicts(b).get('KeyG')).toEqual(['jump', 'grenade', 'view']);
  });

  it('binds a primary and a secondary key, swaps a key the action has, clears one', () => {
    const b = defaultBindings();
    bind(b, 'crouch', 1, 'ControlLeft');
    expect(b.crouch).toEqual(['KeyC', 'ControlLeft']);
    bind(b, 'crouch', 0, 'ControlLeft');
    expect(b.crouch).toEqual(['ControlLeft', 'KeyC']);
    bind(b, 'crouch', 1, 'ControlLeft');
    expect(b.crouch).toEqual(['KeyC', 'ControlLeft']);
    bind(b, 'crouch', 0, null);
    expect(b.crouch).toEqual(['ControlLeft']);
    bind(b, 'crouch', 0, null);
    expect(b.crouch).toEqual([]);
    bind(b, 'crouch', 1, 'KeyC');
    expect(b.crouch).toEqual(['KeyC']);
  });

  it('saves only the changes and loads them back over the defaults', () => {
    expect(loadBindings()).toEqual(defaultBindings());
    const b = defaultBindings();
    bind(b, 'crouch', 1, 'ControlLeft');
    bind(b, 'melee', 0, 'Mouse4');
    saveBindings(b);
    expect(JSON.parse(localStorage.getItem('strikegy.keys.v1')!)).toEqual({
      crouch: ['KeyC', 'ControlLeft'],
      melee: ['Mouse4'],
    });
    expect(loadBindings()).toEqual(b);
    saveBindings(defaultBindings());
    expect(localStorage.getItem('strikegy.keys.v1')).toBeNull();
  });

  it('loading drops junk: unknown actions, reserved or odd codes, repeats, a third key', () => {
    const b = sanitizeBindings({
      jump: ['Space', 'Space', 'Escape', 42, 'KeyF', 'KeyH'],
      fly: ['KeyF'],
      reload: 'KeyR',
      melee: ['<script>'],
      medkit: [],
    });
    expect(b.jump).toEqual(['Space', 'KeyF']);
    expect(b.reload).toEqual(['KeyR']);
    expect(b.melee).toEqual([]);
    expect(b.medkit).toEqual([]);
    expect(sanitizeBindings(null)).toEqual(defaultBindings());
    expect(sanitizeBindings('x')).toEqual(defaultBindings());
    localStorage.setItem('strikegy.keys.v1', '{not json');
    expect(loadBindings()).toEqual(defaultBindings());
  });

  it('names keys for keycaps without spaces (the hint line splits at the first space)', () => {
    expect(keyName('KeyR')).toBe('R');
    expect(keyName('Digit4')).toBe('4');
    expect(keyName('ShiftLeft')).toBe('Shift');
    expect(keyName('ControlLeft')).toBe('Ctrl');
    expect(keyName('Backquote')).toBe('~');
    expect(keyName('Mouse0')).toBe(ko['key.mouse0']);
    for (const c of ['ShiftRight', 'ControlRight', 'Numpad1', 'NumpadEnter', 'Mouse3', 'ArrowUp', 'F5', 'Space']) expect(keyName(c)).not.toMatch(/\s/);
    for (const table of [ko, en]) for (const i of [0, 1, 2, 3, 4]) expect(table[`key.mouse${i}` as keyof typeof ko]).not.toMatch(/\s/);
  });

  it('texts name the bound keys: {k:action} in the strings', () => {
    expect(t('act.holdE')).toBe('E 길게');
    expect(t('hud.giveUp')).toBe('Space 길게: 포기');
    expect(t('start.hint')).toMatch(/^WASD 이동 · Shift 달리기 · C 앉기/);
    expect(t('start.hint')).not.toContain('{k:');
    // Every action named in a string exists, in both languages.
    for (const table of [ko, en] as Record<string, string>[]) for (const v of Object.values(table)) for (const m of v.matchAll(/\{k:(\w+)\}/g)) expect(ACTIONS).toContain(m[1]);
  });
});

describe('tutorial', () => {
  const ctx = { deployFlow: true, zones: true, fort: true, support: true };
  const probe = (p: Partial<TutorialProbe>): TutorialProbe => ({
    dt: 0.1,
    onField: true,
    deploying: false,
    moved: 0,
    turned: 0,
    sprinting: false,
    crouched: false,
    jumped: false,
    fired: false,
    ads: false,
    reloaded: false,
    grenade: false,
    medkit: false,
    interact: false,
    building: false,
    supportOpen: false,
    inZone: false,
    ...p,
  });

  it('first match: basics and match steps; the range: basics only; seen ones not again', () => {
    const all = stepsFor(false, {}, ctx);
    expect(all[0]).toBe('deploy');
    expect(all).toContain('capture');
    expect(all).toContain('move');
    const range = stepsFor(false, {}, { deployFlow: false, zones: false, fort: false, support: false });
    expect(range).toEqual(STEPS.filter((s) => s.basic).map((s) => s.id));
    expect(stepsFor(false, { basics: true }, ctx)).toEqual(['deploy', 'capture', 'interact', 'build', 'support']);
    expect(stepsFor(false, { basics: true, match: true }, ctx)).toEqual([]);
    // The menu's tutorial always runs the basics.
    expect(stepsFor(true, { basics: true, match: true }, ctx)).toEqual(range);
  });

  it('moves on as the player does each step, waits off the field, can be skipped', () => {
    const run = new TutorialRun(['deploy', 'move', 'shoot']);
    expect(run.current!.id).toBe('deploy');
    run.update(probe({ onField: false, deploying: true }));
    expect(run.current!.id).toBe('deploy');
    expect(run.update(probe({ onField: true }))).toBe(true);
    for (let i = 0; i < 10; i++) run.update(probe({}));
    expect(run.current!.id).toBe('move');
    run.update(probe({ moved: 2 }));
    expect(run.progress).toBeCloseTo(0.5);
    run.update(probe({ onField: false, moved: 5 }));
    expect(run.progress).toBeCloseTo(0.5);
    run.update(probe({ moved: 2 }));
    for (let i = 0; i < 10; i++) run.update(probe({}));
    expect(run.current!.id).toBe('shoot');
    run.skip();
    expect(run.finished).toBe(true);
    expect(run.current).toBeNull();
  });

  it('what the player does while the tick shows counts toward the next step', () => {
    const run = new TutorialRun(['crouch', 'jump']);
    run.update(probe({ crouched: true }));
    run.update(probe({ jumped: true }));
    expect(run.current!.id).toBe('crouch');
    for (let i = 0; i < 10; i++) run.update(probe({}));
    expect(run.current!.id).toBe('jump');
    expect(run.progress).toBe(1);
    run.update(probe({}));
    for (let i = 0; i < 10; i++) run.update(probe({}));
    expect(run.finished).toBe(true);
  });

  it('tips the player may not get to do time out', () => {
    const run = new TutorialRun(['interact']);
    for (let i = 0; i < 200; i++) run.update(probe({}));
    expect(run.finished).toBe(true);
  });
});
