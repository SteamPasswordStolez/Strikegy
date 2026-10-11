// Rasterizes procedural surfaces off the main thread while the map loads (see SurfaceLibrary.preload).
import { createRecipe, rasterize } from './surfaces';
import type { SurfaceMaterial } from '@/world/mapTypes';

self.onmessage = (e: MessageEvent<{ kind: SurfaceMaterial; size: number }>) => {
  const { kind, size } = e.data;
  const img = rasterize(createRecipe(kind), size);
  (self as unknown as Worker).postMessage({ kind, img }, [img.albedo.buffer, img.normal.buffer, img.orm.buffer]);
};
