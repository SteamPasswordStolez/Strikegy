import type { Team } from '@/world/mapTypes';

/** Call signs per side (the lobby shows the same names before a match). */
export const NAMES: Record<Team, string[]> = {
  blue: ['Hawk', 'Bishop', 'Rook', 'Nomad', 'Sparrow', 'Atlas', 'Echo', 'Kodiak', 'Falcon', 'Ranger', 'Bear', 'Moose', 'Otter', 'Badger', 'Heron', 'Lynx', 'Maple', 'Cedar', 'Granite', 'Harbor', 'Beacon', 'Anchor', 'Summit', 'Glacier'],
  red: ['Viper', 'Jackal', 'Cobra', 'Wraith', 'Mako', 'Talon', 'Scorpion', 'Raven', 'Hyena', 'Adder', 'Vulture', 'Shrike', 'Mamba', 'Barracuda', 'Warden', 'Specter', 'Cinder', 'Onyx', 'Havoc', 'Rogue', 'Vandal', 'Reaper', 'Ember', 'Dagger'],
};

/** The i-th bot's name on a team: unique, numbered once the list runs out. */
export function botName(team: Team, i: number): string {
  const list = NAMES[team];
  const base = list[i % list.length]!;
  return i < list.length ? base : `${base} ${Math.floor(i / list.length) + 1}`;
}
