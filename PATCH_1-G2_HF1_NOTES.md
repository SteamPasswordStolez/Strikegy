# Patch 1-G2 HF1

## Fixes
- Fixed browser error: `Failed to resolve module specifier "three"`.
  - Added an **import map** in `game.html` that maps the bare specifier `three` to the same CDN URL used elsewhere.
  - This allows Three.js `examples/jsm` modules (EffectComposer/FXAA/Bloom) to load in the browser without a bundler.

## Notes
- The import map also helps avoid accidentally loading multiple Three.js instances.
