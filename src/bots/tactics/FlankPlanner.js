// src/bots/tactics/FlankPlanner.js
// Patch 8-4B: simple flank planner (mid point offset from objective path preview)

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

function randRange(a,b){ return a + Math.random()*(b-a); }

export class FlankPlanner {
  /**
   * @param {{ navigator:any }} opts
   */
  constructor({ navigator }){
    this.navigator = navigator;
  }

  /**
   * @param {{pos:THREE.Vector3,yaw:number}} bot
   * @param {THREE.Vector3} finalTarget
   * @param {THREE.Vector3[]|null} pathPreview
   * @returns {{mid:THREE.Vector3, final:THREE.Vector3}|null}
   */
  plan(bot, finalTarget, pathPreview){
    const nav = this.navigator;
    const path = pathPreview;
    if(!path || path.length < 4) return null;

    // pick a mid index around the middle
    const i0 = Math.floor(path.length * 0.40);
    const i1 = Math.floor(path.length * 0.60);
    const midIndex = i0 + ((Math.random() * Math.max(1, i1 - i0 + 1)) | 0);
    const midBase = path[Math.min(path.length-1, Math.max(0, midIndex))];

    // estimate local direction along the path
    const prev = path[Math.max(0, midIndex - 1)] || path[0];
    const next = path[Math.min(path.length - 1, midIndex + 1)] || path[path.length - 1];

    const dx = (next.x - prev.x);
    const dz = (next.z - prev.z);
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    const nx = dx/len, nz = dz/len;

    // perpendicular
    const px = -nz;
    const pz =  nx;

    // left or right
    const side = (Math.random() < 0.5) ? -1 : 1;

    // offset attempts
    const tries = [randRange(12,16), randRange(9,12), randRange(7,9)];
    for(const off of tries){
      const mx = midBase.x + px * off * side;
      const mz = midBase.z + pz * off * side;
      if(nav.isWalkableWorld(mx, mz)){
        return { mid: new THREE.Vector3(mx, 0, mz), final: finalTarget.clone() };
      }
    }

    // fallback: scatter around the midBase
    for(let k=0;k<6;k++){
      const off = randRange(6, 14);
      const along = randRange(-8, 8);
      const mx = midBase.x + px * off * side + nx * along;
      const mz = midBase.z + pz * off * side + nz * along;
      if(nav.isWalkableWorld(mx, mz)){
        return { mid: new THREE.Vector3(mx, 0, mz), final: finalTarget.clone() };
      }
    }

    return null;
  }
}
