import { describe, expect, it } from 'vitest';
import { STEPS, TutorialRun, stepsFor, type TutorialProbe } from '@/core/tutorial';

const idle = (p: Partial<TutorialProbe> = {}): TutorialProbe => ({
  dt: 1 / 30,
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

describe('tutorial (chapters, owner 2026-11-01)', () => {
  it('runs the basics in chapter order: moving, shooting, kit', () => {
    const steps = stepsFor(true, {}, { deployFlow: false, zones: false, fort: false, support: false, gadget: true });
    expect(steps).toEqual(['move', 'look', 'sprint', 'crouch', 'slide', 'jump', 'shoot', 'hit', 'aim', 'reload', 'swap', 'melee', 'grenade', 'gadget', 'medkit']);
    const chapters = steps.map((id) => STEPS.find((s) => s.id === id)!.chapter);
    expect([...new Set(chapters)]).toEqual(['move', 'fire', 'kit']);
  });

  it('a first match keeps to the few steps needed to play, once', () => {
    const ctx = { deployFlow: true, zones: true, fort: true, support: true, gadget: true };
    expect(stepsFor(false, {}, ctx)).toEqual(['deploy', 'move', 'sprint', 'shoot', 'aim', 'reload', 'capture']);
    // The menu's tutorial still has everything.
    expect(stepsFor(true, {}, { ...ctx, deployFlow: false }).length).toBeGreaterThan(10);
  });

  it('a first match adds the battlefield steps; simplified controls drop the gadget and medkit', () => {
    const steps = stepsFor(false, { basics: true }, { deployFlow: true, zones: true, fort: true, support: true, gadget: true });
    expect(steps).toEqual(['deploy', 'capture', 'interact', 'build', 'support', 'scoreboard']);
    const simple = stepsFor(true, {}, { deployFlow: false, zones: false, fort: false, support: false, simple: true, gadget: false });
    expect(simple).not.toContain('gadget');
    expect(simple).not.toContain('medkit');
  });

  it('the new steps move on with what the player does, and count the time', () => {
    const run = new TutorialRun(['slide', 'hit', 'swap']);
    run.update(idle({ slid: true }));
    expect(run.doneLeft).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) run.update(idle());
    expect(run.current!.id).toBe('hit');
    run.update(idle({ hits: 2 }));
    expect(run.progress).toBeCloseTo(2 / 3);
    run.update(idle({ hits: 1 }));
    for (let i = 0; i < 30; i++) run.update(idle());
    expect(run.current!.id).toBe('swap');
    run.update(idle({ swapped: true }));
    for (let i = 0; i < 30; i++) run.update(idle());
    expect(run.finished).toBe(true);
    expect(run.elapsed).toBeGreaterThan(0);
  });
});
