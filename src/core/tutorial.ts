/**
 * The first-play tutorial: a row of short steps that move on as the player
 * does them (walk a few metres, shoot, reload...). The basics run on the
 * first match or range visit and from the menu's tutorial (the range); the
 * match steps (deploy screen, zones, call-ins) on the first match with them.
 * Pure logic: the game feeds a probe every frame, `TutorialPanel` shows it.
 */
import type { Action } from '@/input/bindings';
import { loadJSON, saveJSON } from './storage';

export const STEP_IDS = ['deploy', 'move', 'look', 'sprint', 'crouch', 'slide', 'jump', 'shoot', 'hit', 'aim', 'reload', 'swap', 'melee', 'grenade', 'gadget', 'medkit', 'capture', 'interact', 'build', 'support', 'scoreboard'] as const;

/**
 * The steps in chapters (owner, 2026-11-01: a fuller tutorial): moving, shooting, kit and the
 * battlefield; the card names the chapter, each step says why it matters under what to do.
 */
export type Chapter = 'move' | 'fire' | 'kit' | 'field';
export type StepId = (typeof STEP_IDS)[number];

/** What this match has (steps for things it lacks are skipped). */
export interface TutorialCtx {
  deployFlow: boolean;
  zones: boolean;
  fort: boolean;
  support: boolean;
  /** Simplified controls (`MATCH.simple`): no medkit, no reviving or resupplying. */
  simple?: boolean;
  /** The class carries a gadget (key 4): not in simplified controls. */
  gadget?: boolean;
}

/** One frame of what the player did. */
export interface TutorialProbe {
  dt: number;
  /** Alive and deployed, the game running. */
  onField: boolean;
  /** The deploy screen is up. */
  deploying: boolean;
  /** Metres walked this frame (horizontal). */
  moved: number;
  /** Radians turned this frame. */
  turned: number;
  sprinting: boolean;
  /** Crouch toggled this frame (or sliding). */
  crouched: boolean;
  jumped: boolean;
  fired: boolean;
  ads: boolean;
  reloaded: boolean;
  grenade: boolean;
  medkit: boolean;
  interact: boolean;
  building: boolean;
  supportOpen: boolean;
  inZone: boolean;
  /** Started a slide this frame. */
  slid?: boolean;
  /** Own rounds that hit something this frame (a target on the range, an enemy). */
  hits?: number;
  /** Changed weapon this frame. */
  swapped?: boolean;
  melee?: boolean;
  /** Took out the class gadget this frame. */
  gadget?: boolean;
  scoreboard?: boolean;
}

interface StepDef {
  id: StepId;
  chapter: Chapter;
  /** Keys shown on the card (desktop). */
  keys: readonly Action[];
  /** Runs in the basics (first range visit, the menu's tutorial). */
  basic: boolean;
  /** How much of `need` this frame adds. */
  amount(p: TutorialProbe): number;
  need: number;
  /** Seconds after which it moves on anyway (tips the player may have no chance to do). */
  timeout?: number;
  avail?(c: TutorialCtx): boolean;
}

const pulse = (b: boolean): number => (b ? 1 : 0);

export const STEPS: readonly StepDef[] = [
  { id: 'deploy', chapter: 'field', keys: [], basic: false, amount: (p) => pulse(p.onField), need: 1, avail: (c) => c.deployFlow },
  // 1. Moving
  { id: 'move', chapter: 'move', keys: ['forward', 'left', 'back', 'right'], basic: true, amount: (p) => p.moved, need: 4 },
  { id: 'look', chapter: 'move', keys: [], basic: true, amount: (p) => p.turned, need: 2.5 },
  { id: 'sprint', chapter: 'move', keys: ['sprint'], basic: true, amount: (p) => (p.sprinting ? p.dt : 0), need: 1.2 },
  { id: 'crouch', chapter: 'move', keys: ['crouch'], basic: true, amount: (p) => pulse(p.crouched), need: 1 },
  { id: 'slide', chapter: 'move', keys: ['sprint', 'crouch'], basic: true, amount: (p) => pulse(!!p.slid), need: 1, timeout: 40 },
  { id: 'jump', chapter: 'move', keys: ['jump'], basic: true, amount: (p) => pulse(p.jumped), need: 1 },
  // 2. Shooting
  { id: 'shoot', chapter: 'fire', keys: ['fire'], basic: true, amount: (p) => pulse(p.fired), need: 3 },
  { id: 'hit', chapter: 'fire', keys: ['ads', 'fire'], basic: true, amount: (p) => p.hits ?? 0, need: 3, timeout: 60 },
  { id: 'aim', chapter: 'fire', keys: ['ads'], basic: true, amount: (p) => (p.ads ? p.dt : 0), need: 1 },
  { id: 'reload', chapter: 'fire', keys: ['reload'], basic: true, amount: (p) => pulse(p.reloaded), need: 1 },
  { id: 'swap', chapter: 'fire', keys: ['slot1', 'slot2'], basic: true, amount: (p) => pulse(!!p.swapped), need: 1, timeout: 30 },
  { id: 'melee', chapter: 'fire', keys: ['melee'], basic: true, amount: (p) => pulse(!!p.melee), need: 1, timeout: 30 },
  // 3. Kit
  { id: 'grenade', chapter: 'kit', keys: ['grenade'], basic: true, amount: (p) => pulse(p.grenade), need: 1 },
  { id: 'gadget', chapter: 'kit', keys: ['slot4'], basic: true, amount: (p) => pulse(!!p.gadget), need: 1, timeout: 30, avail: (c) => !!c.gadget && !c.simple },
  { id: 'medkit', chapter: 'kit', keys: ['medkit'], basic: true, amount: (p) => pulse(p.medkit), need: 1, avail: (c) => !c.simple },
  // 4. The battlefield (a match)
  { id: 'capture', chapter: 'field', keys: [], basic: false, amount: (p) => (p.inZone ? p.dt : 0), need: 3, timeout: 90, avail: (c) => c.zones },
  { id: 'interact', chapter: 'field', keys: ['interact'], basic: false, amount: (p) => pulse(p.interact), need: 1, timeout: 10, avail: (c) => !c.simple },
  { id: 'build', chapter: 'field', keys: ['build'], basic: false, amount: (p) => pulse(p.building), need: 1, timeout: 25, avail: (c) => c.fort },
  { id: 'support', chapter: 'field', keys: ['support'], basic: false, amount: (p) => pulse(p.supportOpen), need: 1, timeout: 25, avail: (c) => c.support },
  { id: 'scoreboard', chapter: 'field', keys: ['scoreboard'], basic: false, amount: (p) => pulse(!!p.scoreboard), need: 1, timeout: 20 },
];

const FIRST_MATCH: readonly StepId[] = ['deploy', 'move', 'sprint', 'shoot', 'aim', 'reload', 'capture'];

const STORE = 'strikegy.tutorial.v1';

/** What the player has been through: the basics, the match steps. */
export interface TutorialSeen {
  basics?: boolean;
  match?: boolean;
}

export function loadSeen(): TutorialSeen {
  return loadJSON<TutorialSeen>(STORE) ?? {};
}

export function saveSeen(s: TutorialSeen): void {
  saveJSON(STORE, s);
}

/**
 * The steps for this start: `guided` (the menu's tutorial) always runs the
 * basics; otherwise what hasn't been seen yet, the match steps only where
 * there's a match (`ctx.deployFlow`).
 */
export function stepsFor(guided: boolean, seen: TutorialSeen, ctx: TutorialCtx): StepId[] {
  const out: StepId[] = [];
  // A first match: the few things needed to play; the rest is the menu's tutorial (21 steps under fire was too many).
  const first = !guided && ctx.deployFlow && !seen.basics && !seen.match;
  for (const s of STEPS) {
    if (s.avail && !s.avail(ctx)) continue;
    if (first && !FIRST_MATCH.includes(s.id)) continue;
    if (s.basic ? guided || !seen.basics : !guided && ctx.deployFlow && !seen.match) out.push(s.id);
  }
  return out;
}

/** Seconds the tick stays on a finished step before the next one. */
export const DONE_HOLD = 0.8;

export class TutorialRun {
  private i = 0;
  private got = 0;
  private time = 0;
  /** What the player already did toward the next step while the tick showed. */
  private carry = 0;
  /** Seconds on the field while it ran (the closing card says how long it took). */
  elapsed = 0;
  /** Seconds left showing the finished step's tick. */
  doneLeft = 0;
  skipped = false;

  constructor(readonly steps: readonly StepId[]) {}

  get index(): number {
    return this.i;
  }

  get finished(): boolean {
    return this.skipped || this.i >= this.steps.length;
  }

  get current(): StepDef | null {
    if (this.finished) return null;
    const id = this.steps[this.i]!;
    return STEPS.find((s) => s.id === id)!;
  }

  /** 0..1 through the current step. */
  get progress(): number {
    const s = this.current;
    return s ? Math.min(1, this.got / s.need) : 1;
  }

  /** Feeds a frame; true when a step was finished on it. */
  update(p: TutorialProbe): boolean {
    const s = this.current;
    if (!s) return false;
    if (this.doneLeft > 0) {
      const id = this.steps[this.i + 1];
      if (id && p.onField) this.carry += STEPS.find((n) => n.id === id)!.amount(p);
      this.doneLeft -= p.dt;
      if (this.doneLeft <= 0) this.next();
      return false;
    }
    // The deploy step is about the deploy screen; the others wait for the field.
    if (s.id === 'deploy' ? !p.deploying && !p.onField : !p.onField) return false;
    this.time += p.dt;
    this.elapsed += p.dt;
    this.got += s.amount(p);
    if (this.got >= s.need || (s.timeout !== undefined && this.time >= s.timeout)) {
      this.got = s.need;
      this.doneLeft = DONE_HOLD;
      return true;
    }
    return false;
  }

  skip(): void {
    this.skipped = true;
  }

  private next(): void {
    this.i++;
    this.got = this.carry;
    this.carry = 0;
    this.time = 0;
    this.doneLeft = 0;
  }
}
