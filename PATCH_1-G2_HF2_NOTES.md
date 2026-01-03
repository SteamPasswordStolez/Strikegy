# Patch 1-G2 HF2

## Fixes
- Removed deprecated `renderer.useLegacyLights` assignment (three r155+ warning).
- Reduced PMREMGenerator `sigmaRadians` from `0.06` to `0.04` to avoid sample clipping warnings.
- Clamped FXAAShader LOD bias from `-100.0` to `-8.0` at runtime to prevent WebGL program warnings on some GPUs.

## Notes
- These are warning-level fixes; functionality remains unchanged.
