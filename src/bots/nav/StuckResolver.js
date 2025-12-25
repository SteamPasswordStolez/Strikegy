// src/bots/nav/StuckResolver.js
// Patch 8-4B: detect stuck movement and request repath / micro-jog.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class StuckResolver {
  constructor(){
    this._tmp = new THREE.Vector3();
  }

  /**
   * @param {any} bot
   * @param {number} dt
   * @param {THREE.Vector3|null} currentGoal
   * @returns {{repath:boolean, nudge:THREE.Vector3|null}}
   */
  update(bot, dt, currentGoal){
    bot._stuck = bot._stuck || { t:0, moved:0, lastX:bot.pos.x, lastZ:bot.pos.z, lastGoalD:Infinity };
    const s = bot._stuck;

    const dx = bot.pos.x - s.lastX;
    const dz = bot.pos.z - s.lastZ;
    const moved = Math.sqrt(dx*dx + dz*dz);

    s.t += dt;
    s.moved += moved;
    s.lastX = bot.pos.x;
    s.lastZ = bot.pos.z;

    let goalD = s.lastGoalD;
    if(currentGoal){
      const gx = currentGoal.x - bot.pos.x;
      const gz = currentGoal.z - bot.pos.z;
      goalD = Math.sqrt(gx*gx + gz*gz);
    }

    let repath = false;
    let nudge = null;

    if(s.t >= 0.85){
      const movedRate = s.moved / s.t; // m/s
      const notGettingCloser = (goalD > s.lastGoalD - 0.15); // didn't reduce by 15cm
      if(movedRate < 0.35 && notGettingCloser){
        repath = true;
        // small lateral nudge to escape corners
        const side = (Math.random() < 0.5) ? -1 : 1;
        const yaw = bot.yaw || 0;
        nudge = new THREE.Vector3(Math.cos(yaw) * side * 0.55, 0, -Math.sin(yaw) * side * 0.55);
      }
      s.t = 0;
      s.moved = 0;
      s.lastGoalD = goalD;
    } else {
      s.lastGoalD = goalD;
    }

    return { repath, nudge };
  }
}
