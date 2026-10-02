import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { formSquads, mateSpawnBlock, type SquadMember } from '@/modes/squads';
import { chooseAction, type BrainInput } from '@/ai/brain';

const member = (id: number, alive = true, combat = false): SquadMember => ({
  id,
  name: `M${id}`,
  team: 'blue',
  alive,
  downed: false,
  feet: new THREE.Vector3(),
  yaw: 0,
  inCombat: () => combat,
});

describe('squads', () => {
  it('splits a team into squads of four, leader first', () => {
    const squads = formSquads('blue', [0, 1, 2, 3, 4, 5].map((i) => member(i)));
    expect(squads.map((s) => s.members.map((m) => m.id))).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ]);
    expect(squads.map((s) => s.name)).toEqual(['Alpha', 'Bravo']);
    expect(squads[0]!.mates(0).map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('blocks spawning on dead or fighting squadmates', () => {
    expect(mateSpawnBlock(member(1), 0)).toBeNull();
    expect(mateSpawnBlock(member(1, false), 0)).toBe('dead');
    expect(mateSpawnBlock(member(1, true, true), 0)).toBe('combat');
  });

  it('blocks spawning beside a squadmate in a vehicle (a pilot is up in the sky)', () => {
    expect(mateSpawnBlock(member(1), 0, true)).toBe('vehicle');
    expect(mateSpawnBlock(member(1, false), 0, true)).toBe('dead');
  });

  it('is wiped only when every member is dead', () => {
    const [sq] = formSquads('red', [member(1, false), member(2, true)]);
    expect(sq!.wiped).toBe(false);
    const [gone] = formSquads('red', [member(1, false), member(2, false)]);
    expect(gone!.wiped).toBe(true);
  });

  it('makes a follower catch up with its leader instead of chasing noises', () => {
    const input: BrainInput = {
      health: 1,
      hasTarget: false,
      lastSeenAge: Infinity,
      heardAge: 1,
      ammo: 1,
      reloading: false,
      sinceHurt: Infinity,
      coverKnown: false,
      inCover: false,
    };
    expect(chooseAction(input, null)).toBe('investigate');
    expect(chooseAction({ ...input, regroup: true }, null)).toBe('advance');
  });
});
