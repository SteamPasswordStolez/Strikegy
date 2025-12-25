// src/bots/tactics/TacticalDirector.js
// Patch 8-4B: Battlefield-ish tactical target selection (utility scoring) + flank (33%)

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { FlankPlanner } from "./FlankPlanner.js";

function randRange(a,b){ return a + Math.random()*(b-a); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function bell(dist, center, width){
  const x = (dist - center) / Math.max(1e-6, width);
  return Math.exp(-0.5 * x * x);
}

function weightedPickTopK(scored, k=3){
  const top = scored.sort((a,b)=>b.s - a.s).slice(0, k);
  if(top.length === 0) return null;
  const sum = top.reduce((acc,it)=>acc + Math.max(0.001, it.s), 0);
  let r = Math.random() * sum;
  for(const it of top){
    r -= Math.max(0.001, it.s);
    if(r <= 0) return it;
  }
  return top[0];
}

export class TacticalDirector {
  /**
   * @param {{
   *  zones:{id:string,x:number,z:number,radius:number}[],
   *  navigator:any,
   *  flankChance?:number,
   *  utilityChance?:number,
   * }} opts
   */
  constructor({ zones, navigator, flankChance=0.33, utilityChance=0.67 }){
    this.zones = zones || [];
    this.navigator = navigator;
    this.flankChance = clamp(Number(flankChance)||0.33, 0, 1);
    this.utilityChance = clamp(Number(utilityChance)||0.67, 0, 1);

    this.flankPlanner = new FlankPlanner({ navigator });
  }

  getZoneById(id){
    if(!id) return null;
    const s = String(id);
    return this.zones.find(z => String(z.id) === s) || null;
  }

  pickZoneFallback(){
    if(!this.zones.length) return null;
    return this.zones[(Math.random() * this.zones.length) | 0];
  }

  _randomPointInZone(z){
    const ang = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * Math.max(3, z.radius * 0.75);
    return new THREE.Vector3(z.x + Math.cos(ang)*rr, 0, z.z + Math.sin(ang)*rr);
  }

  _recentlyVisited(bot, p){
    const rec = bot._recentTargets || [];
    const now = bot._aiTime || 0;
    for(const r of rec){
      if(now - r.t > 10.0) continue;
      const dx = p.x - r.x;
      const dz = p.z - r.z;
      if(dx*dx + dz*dz < 3.0*3.0) return true;
    }
    return false;
  }

  _pushRecent(bot, p){
    bot._recentTargets = bot._recentTargets || [];
    bot._recentTargets.push({ x: p.x, z: p.z, t: bot._aiTime || 0 });
    // keep last ~10
    if(bot._recentTargets.length > 12) bot._recentTargets.splice(0, bot._recentTargets.length - 12);
  }

  _nearestBuddyDist(bot, bots){
    let best = Infinity;
    for(const b of bots){
      if(!b || b === bot || !b.alive) continue;
      if(String(b.team) !== String(bot.team)) continue;
      const dx = b.pos.x - bot.pos.x;
      const dz = b.pos.z - bot.pos.z;
      const d = Math.sqrt(dx*dx + dz*dz);
      if(d < best) best = d;
    }
    return best;
  }

  _flowScore(bot, p){
    const dx = p.x - bot.pos.x;
    const dz = p.z - bot.pos.z;
    const d = Math.sqrt(dx*dx + dz*dz) || 1;
    const tx = dx/d, tz = dz/d;
    const fwdX = Math.sin(bot.yaw || 0);
    const fwdZ = Math.cos(bot.yaw || 0);
    const dot = fwdX*tx + fwdZ*tz;
    // map [-1,1] -> [0,1] with bias against sharp turns
    return clamp((dot + 1) * 0.5, 0, 1);
  }

  _riskScore(p){
    // fewer walkable neighbors => riskier
    const open = this.navigator.opennessAtWorld(p.x, p.z); // 0..8
    return 1 - clamp(open / 8, 0, 1);
  }

  _objectiveScore(p, zone){
    const dx = p.x - zone.x;
    const dz = p.z - zone.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const D = Math.max(20, zone.radius * 2.5);
    return 1 - clamp(dist / D, 0, 1);
  }

  _cohesionScore(buddyDist){
    // prefer 6~18m-ish distance; too far or too close is worse
    return bell(buddyDist, 12, 8);
  }

  _buildCandidates(bot, bots, zone, intentType){
    const cands = [];
    const nav = this.navigator;

    // Objective points
    const objCount = (intentType === 'PATROL') ? 3 : 6;
    for(let i=0;i<objCount;i++){
      const p = this._randomPointInZone(zone);
      if(nav.isWalkableWorld(p.x, p.z)) cands.push({ p, kind:'obj' });
    }

    // Spread points around self (local scanning)
    for(let i=0;i<4;i++){
      const ang = Math.random()*Math.PI*2;
      const rr = randRange(6, 12);
      const p = new THREE.Vector3(bot.pos.x + Math.cos(ang)*rr, 0, bot.pos.z + Math.sin(ang)*rr);
      if(nav.isWalkableWorld(p.x, p.z)) cands.push({ p, kind:'spread' });
    }

    // Buddy-adjacent points (keeps team-ish)
    let buddy = null;
    let best = Infinity;
    for(const b of bots){
      if(!b || b === bot || !b.alive) continue;
      if(String(b.team) !== String(bot.team)) continue;
      const dx = b.pos.x - bot.pos.x;
      const dz = b.pos.z - bot.pos.z;
      const d2 = dx*dx + dz*dz;
      if(d2 < best){ best = d2; buddy = b; }
    }
    if(buddy){
      for(let i=0;i<2;i++){
        const ang = Math.random()*Math.PI*2;
        const rr = randRange(3, 6);
        const p = new THREE.Vector3(buddy.pos.x + Math.cos(ang)*rr, 0, buddy.pos.z + Math.sin(ang)*rr);
        if(nav.isWalkableWorld(p.x, p.z)) cands.push({ p, kind:'buddy' });
      }
    }

    // Route points: preview path toward zone center (cheap)
    let preview = null;
    try{
      preview = this.navigator.previewPathWorld(bot.pos, new THREE.Vector3(zone.x,0,zone.z));
    }catch(e){}
    if(preview && preview.length >= 6){
      const i0 = Math.floor(preview.length * 0.30);
      const i1 = Math.floor(preview.length * 0.70);
      for(let i=0;i<4;i++){
        const idx = i0 + ((Math.random() * Math.max(1, i1-i0+1))|0);
        const n = preview[Math.min(preview.length-1, Math.max(0, idx))];
        if(n && nav.isWalkableWorld(n.x, n.z)) cands.push({ p: n.clone(), kind:'route', _preview: preview });
      }
    }

    return { cands, preview };
  }

  /**
   * Decide next intent + targets.
   * Mutates bot.navPlan = {type, final, mid?, phase}
   */
  chooseIntent(bot, bots){
    const zone = this.getZoneById(bot.targetZoneId) || this.pickZoneFallback();
    if(!zone) return null;

    const buddyDist = this._nearestBuddyDist(bot, bots);

    // choose intent type (BF-ish)
    let intentType = 'OBJECTIVE_PUSH';
    const dxz = Math.hypot(bot.pos.x - zone.x, bot.pos.z - zone.z);
    if(buddyDist > 30 && Math.random() < 0.25) intentType = 'GROUP_UP';
    else if(dxz < zone.radius * 0.75 && Math.random() < 0.35) intentType = 'PATROL';

    const { cands, preview } = this._buildCandidates(bot, bots, zone, intentType);
    if(!cands.length) return null;

    const scored = [];
    for(const cand of cands){
      const p = cand.p;
      // Utility pieces
      const obj = this._objectiveScore(p, zone);
      const varScore = this._recentlyVisited(bot, p) ? 0.1 : 1.0;
      const coh = this._cohesionScore(buddyDist);
      const flow = this._flowScore(bot, p);
      const risk = this._riskScore(p);

      // weights
      const s = 0.38*obj + 0.18*varScore + 0.18*coh + 0.16*flow - 0.10*risk;
      scored.push({ p, s, kind: cand.kind });
    }

    const picked = weightedPickTopK(scored, 3);
    if(!picked) return null;

    const final = picked.p.clone();
    this._pushRecent(bot, final);

    // 67/33: flank can override the path via mid waypoint
    const doFlank = (Math.random() < this.flankChance);
    if(doFlank){
      const planned = this.flankPlanner.plan(bot, final, preview);
      if(planned){
        bot.navPlan = { type:'FLANK', phase:'MID', mid: planned.mid, final: planned.final };
        return bot.navPlan;
      }
    }

    bot.navPlan = { type:intentType, phase:'FINAL', final };
    return bot.navPlan;
  }
}
