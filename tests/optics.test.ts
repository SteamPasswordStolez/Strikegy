import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@/weapons/weaponData';
import { opticFor, reticleSvg, type Reticle } from '@/weapons/optics';
import { buildOptic } from '@/weapons/gunModels';

describe('optics', () => {
  it('gives every scoped weapon its own scope and reticle', () => {
    const scoped = Object.values(WEAPONS).filter((d) => d.scope);
    expect(scoped.length).toBeGreaterThanOrEqual(5);
    const reticles = new Set<Reticle>();
    for (const def of scoped) {
      const o = opticFor(def);
      expect(o.model).toBe('scope');
      expect(o.scope).toBeDefined();
      reticles.add(o.reticle);
    }
    // No two scoped rifles look the same through the glass.
    expect(reticles.size).toBe(scoped.length);
  });

  it('uses several kinds of 1x sights', () => {
    const models = new Set(Object.values(WEAPONS).filter((d) => !d.scope).map((d) => opticFor(d).model));
    for (const m of ['reddot', 'reflex', 'holo', 'kobra', 'prism', 'irons'] as const) expect(models.has(m)).toBe(true);
  });

  it('draws each scope reticle and builds each scope model', () => {
    for (const r of ['duplex', 'mildot', 'pso', 'bdc', 'tree'] as const) {
      const svg = reticleSvg(r, 0xff2a1a);
      expect(svg).toContain('<path');
      expect(svg).not.toContain('NaN');
    }
    for (const def of Object.values(WEAPONS).filter((d) => d.scope)) {
      const { group, sightHeight } = buildOptic(def, 0.01, 0.08);
      expect(group.children.length).toBeGreaterThan(0);
      expect(sightHeight).toBeGreaterThan(0.03);
    }
  });
});
