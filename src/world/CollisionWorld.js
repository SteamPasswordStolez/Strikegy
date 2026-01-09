import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const _closest = new THREE.Vector3();
const _delta = new THREE.Vector3();

export default class CollisionWorld {
  constructor(){
    /** @type {{min:THREE.Vector3,max:THREE.Vector3,type?:string}[]} */
    this.boxes = [];
  }

  clear(){ this.boxes.length = 0; }

  /**
   * Add AABB from centered box (size, pos) like our map objects.
   * @param {string} type
   * @param {[number,number,number]} size
   * @param {[number,number,number]} pos
   */
  addCenteredBox(type, size, pos){
    const [sx, sy, sz] = size;
    const [px, py, pz] = pos;
    const min = new THREE.Vector3(px - sx/2, py - sy/2, pz - sz/2);
    const max = new THREE.Vector3(px + sx/2, py + sy/2, pz + sz/2);
    this.boxes.push({ min, max, type });
  }

  /**
   * Resolve a vertical capsule (approximated as cylinder on XZ) against AABBs.
   * We only push in XZ; Y is handled by ground plane in PlayerController.
   *
   * @param {THREE.Vector3} pos capsule center position
   * @param {number} radius
   * @param {number} halfHeight center-to-feet distance (for vertical overlap)
   * @returns {boolean} true if any collision resolved
   */
  resolveCapsuleXZ(pos, radius, halfHeight){
    let hit = false;

    // capsule vertical segment range
    const yMin = pos.y - halfHeight;
    const yMax = pos.y + halfHeight;

    // a few iterations helps sliding along corners
    for(let iter=0; iter<3; iter++){
      let movedThisIter = false;

      for(const b of this.boxes){
        // vertical overlap check
        if (yMax < b.min.y || yMin > b.max.y) continue;

        // Patch 7-4I: if the capsule is entirely above the top face (standing on the box),
        // we do NOT resolve XZ against it. This lets players stand/walk on top of inner walls
        // without being shoved sideways by the XZ-only solver.
        if (yMin >= b.max.y - 1e-3) continue;

// closest point on AABB to capsule center in XZ
        const clx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
        const clz = Math.max(b.min.z, Math.min(pos.z, b.max.z));

        const dx = pos.x - clx;
        const dz = pos.z - clz;
        const d2 = dx*dx + dz*dz;

        // If center is inside the box in XZ, dx=dz=0 and we need a fallback push direction.
        const insideXZ = (pos.x > b.min.x && pos.x < b.max.x && pos.z > b.min.z && pos.z < b.max.z);

        if (insideXZ){
          // push out to the nearest face, plus capsule radius
          const penLeft  = pos.x - b.min.x;
          const penRight = b.max.x - pos.x;
          const penBack  = pos.z - b.min.z;
          const penFront = b.max.z - pos.z;

          const minPen = Math.min(penLeft, penRight, penBack, penFront);

          if (minPen === penLeft){
            pos.x = b.min.x - radius;
          } else if (minPen === penRight){
            pos.x = b.max.x + radius;
          } else if (minPen === penBack){
            pos.z = b.min.z - radius;
          } else {
            pos.z = b.max.z + radius;
          }

          hit = true;
          movedThisIter = true;
          continue;
        }

        if (d2 < radius*radius - 1e-9){
          const d = Math.sqrt(Math.max(d2, 1e-12));
          const push = radius - d;

          const nx = dx / d;
          const nz = dz / d;

          pos.x += nx * push;
          pos.z += nz * push;

          hit = true;
          movedThisIter = true;
        }
      }

      if(!movedThisIter) break;
    }

    return hit;
  }
}