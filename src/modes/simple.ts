import type { InputState } from '@/input/InputState';
import { MATCH } from './matchFlags';

/**
 * Simplified controls (owner, 2026-10-18; `MATCH.simple`, see matchFlags):
 * the numbers, and the input filter both ends run so a browser and the game
 * server agree on what a soldier may do.
 */
export const SIMPLE = {
  /** Scope sway is this much of the usual (there is no holding the breath). */
  sway: 0.35,
} as const;

/**
 * Drops what a simplified match doesn't have from one step's input: class
 * gadgets, medkits, building, call-ins, holding the breath, inspecting, and
 * melee unless the mode needs it. E stays (vehicles, Rush / S&D charges);
 * 4 (the gadget's slot) finds no gadget to take out.
 */
export function simplifyInput(input: InputState): void {
  if (!MATCH.simple) return;
  input.gadget = false;
  input.medkit = false;
  input.buildMode = false;
  input.support = false;
  input.holdBreath = false;
  input.inspect = false;
  if (!MATCH.melee) input.melee = false;
}
