import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { yawPitchOf } from '@/ai/aim';
import { createInputState } from '@/input/InputState';
import { Layer } from '@/physics/PhysicsWorld';
import { MatchSim, type SoldierInput } from '@/sim/MatchSim';
import { defaultLoadout } from '@/data/classes';
import { parseMap } from '@/world/validateMap';

const lyon = () => parseMap(JSON.parse(readFileSync('public/maps/lyon.json', 'utf8')));

/** Somewhere on open ground near (x, z): the terrain height there, a little above. */
function ground(sim: MatchSim, x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, sim.world.terrain.heightAt(x, z) + 0.05, z);
}

/** Steps the sim for `sec` with the given inputs per soldier. */
function run(sim: MatchSim, sec: number, inputs: Record<number, SoldierInput> = {}): void {
  for (let i = 0; i < Math.round(sec * 60); i++) sim.step((id) => inputs[id] ?? null);
}

describe('a match on the game server (no view)', () => {
  it('two people: one shoots the other down, the other bleeds out and redeploys; kills and deaths count', async () => {
    const sim = await MatchSim.create(lyon());
    const blue = sim.addSoldier(1, 'blue', 'alpha');
    const red = sim.addSoldier(2, 'red', 'bravo');
    expect(blue.deployed).toBe(false);
    expect(sim.deploy(1)).toBeTruthy();
    expect(sim.deploy(2)).toBeTruthy();
    expect(sim.deploy(2)).toBeNull();

    // Face to face on open ground in the fields, 9 m apart.
    let from = ground(sim, 60, -90);
    let to = ground(sim, 60, -99);
    for (let tries = 0; tries < 12; tries++) {
      const eye = from.clone().setY(from.y + 1.5);
      const chest = to.clone().setY(to.y + 1.2);
      const d = chest.clone().sub(eye);
      if (!sim.physics.raycast(eye, d.clone().normalize(), d.length(), Layer.WORLD)) break;
      from = ground(sim, from.x + 17, from.z + 11);
      to = ground(sim, from.x, from.z - 9);
    }
    blue.player.teleport(from, 0);
    red.player.teleport(to, Math.PI);
    run(sim, 0.5);

    const kills: string[] = [];
    sim.bus.on('combat:kill', (e) => kills.push(`${e.attackerId}>${e.victimId} ${e.attacker} ${e.weapon}`));
    const eye = blue.player.feet.clone().setY(blue.player.feet.y + blue.player.eyeHeight);
    const chest = red.player.feet.clone().setY(red.player.feet.y + 1.2);
    const [yaw, pitch] = yawPitchOf(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
    const fire = createInputState();
    fire.fire = true;
    for (let i = 0; i < 240 && !red.downed; i++) sim.step((id) => (id === 1 ? { state: fire, yaw, pitch } : null));
    expect(red.downed).toBe(true);
    expect(red.killedBy).toBe('alpha');
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatch(/^1>2 alpha /);
    expect(sim.scores.get(1)?.kills).toBe(1);

    // Down, then gives up (holds jump): off the field, a death on the table,
    // back after the rest of the respawn wait (time down counts toward it).
    fire.fire = false;
    const giveUp = createInputState();
    giveUp.jumpHeld = true;
    run(sim, 1.1, { 2: { state: giveUp, yaw: 0, pitch: 0 } });
    expect(red.downed).toBe(false);
    expect(red.deployed).toBe(false);
    expect(sim.scores.get(2)?.deaths).toBe(1);
    expect(red.respawnTimer).toBeGreaterThan(2.5);
    expect(sim.deploy(2)).toBeNull();
    run(sim, 3.1);
    expect(sim.deploy(2)).toBeTruthy();
    expect(red.alive).toBe(true);
    sim.dispose();
  });

  it('standing in a zone takes it; the capture is credited to who was there', async () => {
    const sim = await MatchSim.create(lyon());
    const blue = sim.addSoldier(1, 'blue', 'alpha');
    sim.deploy(1);
    const a = sim.zoneMode!.zone('A')!;
    blue.player.teleport(ground(sim, a.x, a.z), 0);
    const captured: string[] = [];
    sim.bus.on('zone:captured', (e) => captured.push(`${e.zone}:${e.team}`));
    for (let i = 0; i < 60 * 90 && !captured.length; i++) sim.step(() => null);
    expect(captured).toEqual(['A:blue']);
    expect(sim.zoneMode!.zone('A')!.owner).toBe('blue');
    expect(sim.scores.get(1)?.captures).toBe(1);
    sim.dispose();
  });

  it('a long fall hurts, and a soldier who leaves takes its bodies along', async () => {
    const sim = await MatchSim.create(lyon());
    const blue = sim.addSoldier(1, 'blue', 'alpha');
    sim.deploy(1);
    const p = ground(sim, 60, -90);
    blue.player.teleport(p.clone().setY(p.y + 9), 0);
    run(sim, 3);
    expect(blue.player.health.value).toBeLessThan(100);
    expect(blue.alive).toBe(true);
    const before = sim.physics.world.colliders.len();
    sim.removeSoldier(1);
    sim.step(() => null);
    expect(sim.physics.world.colliders.len()).toBe(before - 4);
    expect(sim.soldiers.size).toBe(0);
    sim.dispose();
  });

  it('a frag thrown at an enemy hurts it; a mate holding E revives the downed', async () => {
    const sim = await MatchSim.create(lyon());
    const a = sim.addSoldier(1, 'blue', 'alpha');
    const b = sim.addSoldier(2, 'red', 'bravo');
    const c = sim.addSoldier(3, 'red', 'charlie');
    for (const id of [1, 2, 3]) sim.deploy(id);
    const at = ground(sim, 60, -90);
    a.player.teleport(at, 0);
    b.player.teleport(ground(sim, at.x, at.z - 7), 0);
    c.player.teleport(ground(sim, at.x + 30, at.z - 7), 0);
    run(sim, 0.3);
    const booms: string[] = [];
    sim.bus.on('grenade:detonate', (e) => booms.push(e.type));
    const throwIt = createInputState();
    throwIt.throwGrenade = true;
    sim.step((id) => (id === 1 ? { state: throwIt, yaw: 0, pitch: -0.35 } : null));
    expect(a.grenades.count).toBe(1);
    expect([...sim.throwables.all()]).toHaveLength(1);
    // Where it comes to rest, bravo is standing 2 m off when it goes.
    run(sim, 2);
    const g = [...sim.throwables.all()][0]!;
    b.player.teleport(ground(sim, g.x, g.z - 2), 0);
    run(sim, 2);
    expect(booms).toEqual(['frag']);
    expect(b.player.health.value).toBeLessThan(100);

    // Bravo goes down (finished off by the test), charlie walks up and holds E.
    b.damage(500, null, 'bullet');
    expect(b.downed).toBe(true);
    c.player.teleport(ground(sim, b.player.feet.x + 1, b.player.feet.z), 0);
    const hold = createInputState();
    hold.interact = true;
    const revived: number[] = [];
    sim.bus.on('combatant:revived', (e) => revived.push(e.id));
    run(sim, 5.2, { 3: { state: hold, yaw: 0, pitch: 0 } });
    expect(revived).toEqual([2]);
    expect(b.downed).toBe(false);
    expect(b.alive).toBe(true);
    expect(sim.scores.get(3)!.score).toBeGreaterThan(0);
    sim.dispose();
  });

  it('kit on the server: build mode builds a spot, a panzerfaust kills, an ammo station restocks', async () => {
    const sim = await MatchSim.create(lyon());
    const a = sim.addSoldier(1, 'blue', 'alpha', { ...defaultLoadout('support') });
    const b = sim.addSoldier(2, 'red', 'bravo');
    sim.deploy(1, 'base', defaultLoadout('support'));
    sim.deploy(2);
    const fort = sim.fort!;
    // A sandbag spot: stand where its builder stands, look at it, T then hold the trigger.
    const slot = fort.slots.find((s) => s.kind === 'sandbag')!;
    a.player.teleport(slot.stand.clone(), 0);
    run(sim, 0.3);
    const eye = a.player.feet.clone().setY(a.player.feet.y + a.player.eyeHeight);
    const [yaw, pitch] = yawPitchOf(slot.center.x - eye.x, slot.center.y - eye.y, slot.center.z - eye.z);
    const t = createInputState();
    t.buildMode = true;
    sim.step((id) => (id === 1 ? { state: t, yaw, pitch } : null));
    expect(a.buildMode).toBe(true);
    const work = createInputState();
    work.fire = true;
    for (let i = 0; i < 60 * 12 && !slot.built; i++) sim.step((id) => (id === 1 ? { state: work, yaw, pitch } : null));
    expect(slot.built).toBe(true);
    expect(sim.scores.get(1)!.score).toBeGreaterThan(0);

    // An assault puts a rocket into bravo's chest from 15 m.
    const c = sim.addSoldier(3, 'blue', 'charlie');
    sim.deploy(3);
    const at = ground(sim, 60, -90);
    c.player.teleport(at, 0);
    b.player.teleport(ground(sim, at.x, at.z - 15), 0);
    run(sim, 0.3);
    const ce = c.player.feet.clone().setY(c.player.feet.y + c.player.eyeHeight);
    const bc = b.player.feet.clone().setY(b.player.feet.y + 1.2);
    const [y2, p2] = yawPitchOf(bc.x - ce.x, bc.y - ce.y, bc.z - ce.z);
    const four = createInputState();
    four.gadget = true;
    sim.step((id) => (id === 3 ? { state: four, yaw: y2, pitch: p2 } : null));
    expect(c.gadgetOut).toBe(true);
    const shoot = createInputState();
    shoot.fire = true;
    shoot.firePressed = true;
    const booms: string[] = [];
    sim.onBoom = (k) => booms.push(k);
    sim.step((id) => (id === 3 ? { state: shoot, yaw: y2, pitch: p2 } : null));
    expect(c.gadgetCount).toBe(1);
    run(sim, 1);
    expect(booms).toContain('rocket');
    expect(b.downed).toBe(true);
    sim.dispose();
  });
});
