import {
  ChunkIdsArray,
  Detour,
  DetourTileCacheParams,
  NavMesh,
  NavMeshParams,
  Raw,
  RecastBuildContext,
  RecastChunkyTriMesh,
  TileCache,
  TileCacheData,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
  allocCompactHeightfield,
  allocHeightfield,
  allocHeightfieldLayerSet,
  buildCompactHeightfield,
  buildHeightfieldLayers,
  buildTileCacheLayer,
  calcGridSize,
  cloneRcConfig,
  createHeightfield,
  createRcConfig,
  erodeWalkableArea,
  filterLedgeSpans,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeHeightfield,
  freeHeightfieldLayerSet,
  getHeightfieldLayerAreas,
  getHeightfieldLayerCons,
  getHeightfieldLayerHeights,
  markWalkableTriangles,
  rasterizeTriangles,
  recastConfigDefaults,
  statusFailed,
  vec3,
  type RecastConfig,
  type TileCacheMeshProcess,
} from 'recast-navigation';

/**
 * The soldiers' tile cache, built like recast-navigation's `generateTileCache`
 * (same steps, same settings, so a map's mesh comes out the same) with one
 * change: Detour's tile / polygon address bits are sized from the layers the
 * map really has, not from its whole bounding grid times the expected layers.
 * The library caps tiles at 2^14, which a big map's 6.4 m tiles pass (Ardennes
 * has ~6,000 layers; a 1.8 x 1.4 km island ~25,000 round its towns alone).
 * Up to 2^14 layers it picks the very same bits as the library.
 */
export function buildTileCache(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  cfg: Partial<RecastConfig> & { expectedLayersPerTile: number; maxObstacles: number },
  meshProcess: TileCacheMeshProcess,
): { success: true; navMesh: NavMesh; tileCache: TileCache } | { success: false; error: string } {
  const ctx = new RecastBuildContext();
  const tileCache = new TileCache();
  const navMesh = new NavMesh();
  const verts = new VerticesArray();
  verts.copy(positions as number[]);
  const tris = new TrianglesArray();
  tris.copy(indices as number[]);
  const numTriangles = indices.length / 3;
  const bbMin = [Infinity, Infinity, Infinity];
  const bbMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]! * 3;
    for (let k = 0; k < 3; k++) {
      bbMin[k] = Math.min(bbMin[k]!, positions[v + k]!);
      bbMax[k] = Math.max(bbMax[k]!, positions[v + k]!);
    }
  }
  const { expectedLayersPerTile, maxObstacles, ...recast } = cfg;
  const config = createRcConfig({ ...recastConfigDefaults, ...recast });
  const grid = calcGridSize(bbMin as [number, number, number], bbMax as [number, number, number], config.cs);
  config.width = grid.width;
  config.height = grid.height;
  config.minRegionArea = config.minRegionArea * config.minRegionArea;
  config.mergeRegionArea = config.mergeRegionArea * config.mergeRegionArea;
  config.detailSampleDist = config.detailSampleDist < 0.9 ? 0 : config.cs * config.detailSampleDist;
  config.detailSampleMaxError = config.ch * config.detailSampleMaxError;
  const tileSize = Math.floor(config.tileSize);
  const tileWidth = Math.floor((config.width + tileSize - 1) / tileSize);
  const tileHeight = Math.floor((config.height + tileSize - 1) / tileSize);
  config.borderSize = config.walkableRadius + 3;
  config.width = config.tileSize + config.borderSize * 2;
  config.height = config.tileSize + config.borderSize * 2;
  const chunky = new RecastChunkyTriMesh();
  const done = (error?: string) => {
    verts.destroy();
    tris.destroy();
    if (error) {
      tileCache.destroy();
      navMesh.destroy();
    }
    return error;
  };
  const params = DetourTileCacheParams.create({
    orig: bbMin as [number, number, number],
    cs: config.cs,
    ch: config.ch,
    width: config.tileSize,
    height: config.tileSize,
    walkableHeight: config.walkableHeight * config.ch,
    walkableRadius: config.walkableRadius * config.cs,
    walkableClimb: config.walkableClimb * config.ch,
    maxSimplificationError: config.maxSimplificationError,
    maxTiles: tileWidth * tileHeight * expectedLayersPerTile,
    maxObstacles,
  });
  const compressor = new Raw.RecastFastLZCompressor();
  if (!tileCache.init(params, new Raw.RecastLinearAllocator(32000), compressor, meshProcess)) return { success: false, error: done('Failed to initialize tile cache')! };
  if (!chunky.init(verts, tris, numTriangles, 256)) return { success: false, error: done('Failed to build chunky triangle mesh')! };

  // Rasterize every tile into compressed layers (as the library does).
  const tcs = config.tileSize * config.cs;
  const chunkIds = new ChunkIdsArray();
  chunkIds.resize(512);
  let layers = 0;
  const columns: [number, number][] = [];
  for (let ty = 0; ty < tileHeight; ty++) {
    for (let tx = 0; tx < tileWidth; tx++) {
      const tc = cloneRcConfig(config);
      const lo = [bbMin[0]! + tx * tcs - tc.borderSize * tc.cs, bbMin[1]!, bbMin[2]! + ty * tcs - tc.borderSize * tc.cs];
      const hi = [bbMin[0]! + (tx + 1) * tcs + tc.borderSize * tc.cs, bbMax[1]!, bbMin[2]! + (ty + 1) * tcs + tc.borderSize * tc.cs];
      for (let k = 0; k < 3; k++) {
        tc.set_bmin(k, lo[k]!);
        tc.set_bmax(k, hi[k]!);
      }
      const n = chunky.getChunksOverlappingRect([lo[0]!, lo[2]!], [hi[0]!, hi[2]!], chunkIds, 512);
      if (n === 0) continue;
      const hf = allocHeightfield();
      if (!createHeightfield(ctx, hf, tc.width, tc.height, lo as [number, number, number], hi as [number, number, number], tc.cs, tc.ch)) {
        freeHeightfield(hf);
        continue;
      }
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const id = chunkIds.get(i);
        const nTris = chunky.nodes(id).n;
        const nodeTris = chunky.getNodeTris(id);
        const areas = new TriangleAreasArray();
        areas.resize(nTris);
        markWalkableTriangles(ctx, tc.walkableSlopeAngle, verts, indices.length, nodeTris, nTris, areas);
        ok = rasterizeTriangles(ctx, verts, indices.length, nodeTris, areas, nTris, hf, tc.walkableClimb);
        areas.destroy();
      }
      if (!ok) {
        freeHeightfield(hf);
        continue;
      }
      filterLowHangingWalkableObstacles(ctx, config.walkableClimb, hf);
      filterLedgeSpans(ctx, config.walkableHeight, config.walkableClimb, hf);
      filterWalkableLowHeightSpans(ctx, config.walkableHeight, hf);
      const chf = allocCompactHeightfield();
      const built = buildCompactHeightfield(ctx, config.walkableHeight, config.walkableClimb, hf, chf);
      freeHeightfield(hf);
      if (!built || !erodeWalkableArea(ctx, config.walkableRadius, chf)) {
        freeCompactHeightfield(chf);
        continue;
      }
      const lset = allocHeightfieldLayerSet();
      const split = buildHeightfieldLayers(ctx, chf, config.borderSize, config.walkableHeight, lset);
      freeCompactHeightfield(chf);
      if (!split) {
        freeHeightfieldLayerSet(lset);
        continue;
      }
      let added = 0;
      for (let i = 0; i < lset.nlayers(); i++) {
        const layer = lset.layers(i);
        const header = new Raw.dtTileCacheLayerHeader();
        header.magic = Detour.DT_TILECACHE_MAGIC;
        header.version = Detour.DT_TILECACHE_VERSION;
        header.tx = tx;
        header.ty = ty;
        header.tlayer = i;
        const b0 = layer.bmin();
        const b1 = layer.bmax();
        header.set_bmin(0, b0.x);
        header.set_bmin(1, b0.y);
        header.set_bmin(2, b0.z);
        header.set_bmax(0, b1.x);
        header.set_bmax(1, b1.y);
        header.set_bmax(2, b1.z);
        header.width = layer.width();
        header.height = layer.height();
        header.minx = layer.minx();
        header.maxx = layer.maxx();
        header.miny = layer.miny();
        header.maxy = layer.maxy();
        header.hmin = layer.hmin();
        header.hmax = layer.hmax();
        const tile = new TileCacheData();
        const status = buildTileCacheLayer(compressor, header, getHeightfieldLayerHeights(layer), getHeightfieldLayerAreas(layer), getHeightfieldLayerCons(layer), tile);
        if (statusFailed(status)) continue;
        if (!statusFailed(tileCache.addTile(tile).status)) added++;
      }
      freeHeightfieldLayerSet(lset);
      if (added) {
        layers += added;
        columns.push([tx, ty]);
      }
    }
  }
  chunkIds.destroy();

  // Address bits: the library's choice while it fits, else as many tile bits as the layers need.
  const libraryBits = Math.min(Math.floor(Math.log2(nextPow2(tileWidth * tileHeight * expectedLayersPerTile))), 14);
  const needBits = Math.ceil(Math.log2(Math.max(2, layers)));
  const tileBits = Math.max(libraryBits, needBits);
  const polyBits = 22 - tileBits;
  if (polyBits < 6) return { success: false, error: done(`${layers} navmesh layers: too many for 32-bit polygon refs`)! };
  const nmParams = NavMeshParams.create({ orig: vec3.fromArray(bbMin), tileWidth: tcs, tileHeight: tcs, maxTiles: 1 << tileBits, maxPolys: 1 << polyBits });
  if (!navMesh.initTiled(nmParams)) return { success: false, error: done('Failed to initialize tiled navmesh')! };
  for (const [tx, ty] of columns) {
    if (statusFailed(tileCache.buildNavMeshTilesAt(tx, ty, navMesh))) return { success: false, error: done(`Failed to build nav mesh tiles at ${tx}, ${ty}`)! };
  }
  // A layer with more polygons than its address bits would hand out refs into other tiles.
  for (let i = 0, n = navMesh.getMaxTiles(); i < n; i++) {
    const count = navMesh.getTile(i).header()?.polyCount() ?? 0;
    if (count > 1 << polyBits) return { success: false, error: done(`a navmesh layer has ${count} polygons (at most ${1 << polyBits} with ${tileBits} tile bits)`)! };
  }
  done();
  return { success: true, navMesh, tileCache };
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p *= 2;
  return p;
}
