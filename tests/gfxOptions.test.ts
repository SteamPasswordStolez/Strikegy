import { describe, expect, it } from 'vitest';
import { qualityConfig } from '@/render/Renderer';
import { PRESET_GFX, gfxFor } from '@/core/Settings';

describe('graphics options (Settings → 그래픽)', () => {
  it('keeps the old presets as they were', () => {
    const low = qualityConfig('low');
    expect([low.shadows, low.postfx, low.msaa, low.textureSize, low.anisotropy, low.terrainStep, low.groundCover, low.treeNear, low.snow]).toEqual([false, false, false, 256, 2, 2, false, 55, 1200]);
    const med = qualityConfig('medium');
    expect([med.shadowMapSize, med.nearShadow, med.nearExtent, med.postfx, med.msaa, med.anisotropy, med.dynamicLights, med.backdropDetail]).toEqual([2048, 1536, 20, false, true, 4, 0, 'low']);
    const high = qualityConfig('high');
    expect([high.shadowMapSize, high.nearShadow, high.nearExtent, high.postfx, high.fxaa, high.ao, high.bloom, high.dynamicLights, high.pixelRatioCap]).toEqual([3072, 2048, 26, true, true, true, true, 1, 1.25]);
  });

  it('ultra is above high everywhere', () => {
    const high = qualityConfig('high');
    const ultra = qualityConfig('ultra');
    expect(ultra.shadowMapSize).toBeGreaterThan(high.shadowMapSize);
    expect(ultra.nearShadow).toBeGreaterThan(high.nearShadow);
    expect(ultra.anisotropy).toBeGreaterThan(high.anisotropy);
    expect(ultra.textureSize).toBeGreaterThan(high.textureSize);
    expect(ultra.treeNear).toBeGreaterThan(high.treeNear);
  });

  it('MSAA only without the post chain; AA off drops FXAA', () => {
    expect(qualityConfig('medium', { ao: true }).msaa).toBe(false);
    expect(qualityConfig('medium', { ao: true }).fxaa).toBe(true);
    expect(qualityConfig('high', { antialias: 'off' }).fxaa).toBe(false);
    expect(qualityConfig('high', { ao: false, bloom: false, antialias: 'msaa' })).toMatchObject({ postfx: false, msaa: true });
    expect(qualityConfig('low', { antialias: 'fxaa' })).toMatchObject({ postfx: true, fxaa: true, ao: false });
  });

  it('a player pick overrides only its item', () => {
    const g = gfxFor('high', { shadows: 'low' });
    expect(g).toEqual({ ...PRESET_GFX.high, shadows: 'low' });
    expect(qualityConfig('high', { shadows: 'low' })).toMatchObject({ shadows: true, nearShadow: 0, shadowMapSize: 1024 });
    expect(qualityConfig('high', { shadows: 'off' }).shadows).toBe(false);
  });
});
