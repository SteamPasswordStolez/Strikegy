// src/bots/nav/BotNavigator.js
// Patch 8-4B: Bot navigation wrapper (grid + A* + light smoothing)

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { NavGrid } from "./NavGrid.js";
import { aStarGrid } from "./AStar.js";

function dist2(ax, az, bx, bz){
  const dx = bx-ax, dz = bz-az;
  return dx*dx + dz*dz;
}

export class BotNavigator {
  /**
   * @param {{
   *  collisionWorld:any,
   *  map:any,
   *  cellSize?:number,
   *  agentRadius?:number,
   * }} opts
   */
  // Patch 9-4F: pathfinding overhaul (less wall-rubbing)
  // - finer grid
  // - slightly inflated agent radius (clearance)
  constructor({ collisionWorld, map, cellSize=1.4, agentRadius=0.55 }){
    const gs = map?.world?.groundSize || [200,200];
    this.grid = new NavGrid({ collisionWorld, groundSize: gs, cellSize, agentRadius });
    this.grid.rebuild();

    // cache for repeated path calls
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
  }

  rebuild(){
    this.grid.rebuild();
  }

  isWalkableWorld(x, z){
    return this.grid.isWalkableWorld(x, z);
  }

  opennessAtWorld(x, z){
    return this.grid.opennessAtWorld(x, z);
  }

  /**
   * @returns {THREE.Vector3[]|null}
   */
  findPathWorld(fromPos, toPos, opts={}){
    if(!fromPos || !toPos) return null;

    const start = this.grid.findNearestWalkableCell(fromPos.x, fromPos.z, 10);
    const goal  = this.grid.findNearestWalkableCell(toPos.x,   toPos.z,   10);
    if(!start || !goal) return null;

    const nodes = aStarGrid(this.grid, start, goal, {
      maxExpansions: opts.maxExpansions ?? 24000,
      allowDiag: true,
      // Patch 9-4F: stronger wall-avoidance cost
      openPenalty: opts.openPenalty ?? 0.22,
    });
    if(!nodes || nodes.length === 0) return null;

    // Convert to world points
    const pts = nodes.map(n => this.grid.cellToWorld(n.ix, n.iz, new THREE.Vector3()));

    // Replace last point with exact goal (if walkable), so bot aims accurately
    pts[pts.length-1].x = toPos.x;
    pts[pts.length-1].z = toPos.z;

    // Simple smoothing: greedily skip nodes if line is walkable
    const smoothed = [];
    let i = 0;
    smoothed.push(pts[0].clone());
    while(i < pts.length - 1){
      let j = Math.min(pts.length - 1, i + 26); // lookahead (Patch 9-4F: stronger smoothing)
      let best = i + 1;
      for(; j > i + 1; j--){
        const a = pts[i], b = pts[j];
        if(this.grid.hasWalkableLine(a.x, a.z, b.x, b.z)){
          best = j;
          break;
        }
      }
      smoothed.push(pts[best].clone());
      i = best;
    }

    return smoothed;
  }

  /**
   * Cheap preview: returns path nodes (world) but limits expansions
   * @returns {THREE.Vector3[]|null}
   */
  previewPathWorld(fromPos, toPos){
    return this.findPathWorld(fromPos, toPos, { maxExpansions: 8000 });
  }

  /**
   * Given a desired (x,z), nudge to nearest walkable world point.
   * @returns {THREE.Vector3|null}
   */
  nudgeToWalkable(x, z){
    const cell = this.grid.findNearestWalkableCell(x, z, 10);
    if(!cell) return null;
    // If exact target isn't walkable, use the nearest walkable cell center.
    if(!this.grid.isWalkableWorld(x, z)){
      return this.grid.cellToWorld(cell.ix, cell.iz, new THREE.Vector3());
    }
    // Walkable: keep exact x/z.
    const p = new THREE.Vector3(x, 0, z);
    return p;
  }
}
