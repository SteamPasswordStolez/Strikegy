// src/bots/nav/NavGrid.js
// Patch 8-4B: lightweight navigation grid built from CollisionWorld AABBs.
// - 2D XZ grid
// - Cells are blocked if they overlap any solid AABB expanded by agentRadius
// - World bounds derived from map.world.groundSize (plane centered at origin)

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

function aabbOverlapsXZ(boxMin, boxMax, x0, z0, x1, z1){
  // AABB projection overlaps rectangle [x0,x1] x [z0,z1]
  if (boxMax.x < x0 || boxMin.x > x1) return false;
  if (boxMax.z < z0 || boxMin.z > z1) return false;
  return true;
}

export class NavGrid {
  /**
   * @param {{
   *  collisionWorld:any,
   *  groundSize:[number,number],
   *  cellSize?:number,
   *  agentRadius?:number,
   *  yMin?:number,
   *  yMax?:number,
   * }} opts
   */
  constructor({ collisionWorld, groundSize, cellSize=2.0, agentRadius=0.45, yMin=0.0, yMax=1.85 }){
    this.collisionWorld = collisionWorld;
    this.groundSize = groundSize || [200, 200];
    this.cellSize = Math.max(0.5, Number(cellSize)||2.0);
    this.agentRadius = Math.max(0, Number(agentRadius)||0.45);

    // treat obstacles only if they overlap this vertical slice
    this.yMin = Number(yMin);
    this.yMax = Number(yMax);

    const [W, D] = this.groundSize;
    this.minX = -W/2;
    this.maxX =  W/2;
    this.minZ = -D/2;
    this.maxZ =  D/2;

    this.cols = Math.max(1, Math.ceil(W / this.cellSize));
    this.rows = Math.max(1, Math.ceil(D / this.cellSize));

    /** @type {Uint8Array} 0 walkable, 1 blocked */
    this.blocked = new Uint8Array(this.cols * this.rows);

    /** @type {Uint8Array} walkable neighbor count (0..8). Used to bias paths away from walls. */
    this.open = new Uint8Array(this.cols * this.rows);

    /** @type {{min:THREE.Vector3, max:THREE.Vector3}[]} */
    this._expandedBoxes = [];
  }

  index(ix, iz){ return iz * this.cols + ix; }
  inBounds(ix, iz){ return ix >= 0 && iz >= 0 && ix < this.cols && iz < this.rows; }

  worldToCell(x, z){
    const ix = Math.floor((x - this.minX) / this.cellSize);
    const iz = Math.floor((z - this.minZ) / this.cellSize);
    return { ix, iz };
  }

  cellToWorld(ix, iz, out=new THREE.Vector3()){
    const x = this.minX + (ix + 0.5) * this.cellSize;
    const z = this.minZ + (iz + 0.5) * this.cellSize;
    out.set(x, 0, z);
    return out;
  }

  isWalkableCell(ix, iz){
    if(!this.inBounds(ix, iz)) return false;
    return this.blocked[this.index(ix, iz)] === 0;
  }

  isWalkableWorld(x, z){
    const { ix, iz } = this.worldToCell(x, z);
    return this.isWalkableCell(ix, iz);
  }

  opennessAtWorld(x, z){
    const { ix, iz } = this.worldToCell(x, z);
    return this.opennessAtCell(ix, iz);
  }

  opennessAtCell(ix, iz){
    if(!this.inBounds(ix, iz)) return 0;
    return this.open[this.index(ix, iz)] || 0;
  }

  rebuild(){
    this._expandedBoxes.length = 0;
    const boxes = this.collisionWorld?.boxes || [];
    const r = this.agentRadius;

    for(const b of boxes){
      if(!b?.min || !b?.max) continue;
      // vertical overlap filter
      if(this.yMax < b.min.y || this.yMin > b.max.y) continue;
      const min = b.min.clone();
      const max = b.max.clone();
      min.x -= r; min.z -= r;
      max.x += r; max.z += r;
      this._expandedBoxes.push({ min, max });
    }

    this.blocked.fill(0);
    this.open.fill(0);

    const cs = this.cellSize;
    for(let iz=0; iz<this.rows; iz++){
      const z0 = this.minZ + iz*cs;
      const z1 = z0 + cs;
      for(let ix=0; ix<this.cols; ix++){
        const x0 = this.minX + ix*cs;
        const x1 = x0 + cs;

        let blocked = 0;
        for(const eb of this._expandedBoxes){
          if(aabbOverlapsXZ(eb.min, eb.max, x0, z0, x1, z1)){
            blocked = 1;
            break;
          }
        }
        this.blocked[this.index(ix, iz)] = blocked;
      }
    }

    // Precompute openness (walkable neighbor count) for wall-avoidance costs.
    for(let iz=0; iz<this.rows; iz++){
      for(let ix=0; ix<this.cols; ix++){
        const idx = this.index(ix, iz);
        if(this.blocked[idx]){ this.open[idx] = 0; continue; }
        let o = 0;
        for(let dz=-1; dz<=1; dz++){
          for(let dx=-1; dx<=1; dx++){
            if(dx===0 && dz===0) continue;
            if(this.isWalkableCell(ix+dx, iz+dz)) o++;
          }
        }
        this.open[idx] = o;
      }
    }
    return this;
  }

  /**
   * Find a nearby walkable cell around a point (spiral ring search).
   * @returns {{ix:number,iz:number}|null}
   */
  findNearestWalkableCell(x, z, maxRadiusCells=10){
    const c = this.worldToCell(x, z);
    if(this.isWalkableCell(c.ix, c.iz)) return c;

    const R = Math.max(1, maxRadiusCells|0);
    for(let r=1; r<=R; r++){
      for(let dz=-r; dz<=r; dz++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const ix = c.ix + dx, iz = c.iz + dz;
          if(this.isWalkableCell(ix, iz)) return { ix, iz };
        }
      }
    }
    return null;
  }

  /**
   * Approx LOS-like walkability check between two world points by sampling.
   * @returns {boolean}
   */
  hasWalkableLine(ax, az, bx, bz){
    const dx = bx - ax, dz = bz - az;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if(dist < 1e-6) return true;
    const step = Math.max(this.cellSize * 0.5, 0.75);
    const n = Math.ceil(dist / step);
    for(let i=0; i<=n; i++){
      const t = i / n;
      const x = ax + dx*t;
      const z = az + dz*t;
      if(!this.isWalkableWorld(x, z)) return false;
    }
    return true;
  }
}
