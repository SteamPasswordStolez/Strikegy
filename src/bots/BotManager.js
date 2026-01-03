// src/bots/BotManager.js
// Patch 8-3A: Simple bots (spawn -> move to random zone -> hold/wander)
// - No pathfinding (direct steering + CollisionWorld capsule XZ resolve)
// - Designed as moving targets for early combat/bot testing

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { WEAPONS } from "../weapons/WeaponData.js";
import { BotNavigator } from "./nav/BotNavigator.js";
import { StuckResolver } from "./nav/StuckResolver.js";
import { ShopSystem } from "../game/ShopSystem.js";
import { EconomyManager } from "../game/EconomyManager.js";
import { SHOP, CLASS_PRIMARY_ALLOW } from "../data/shopCatalog.js";
import { CLASSES, normalizeClassId, initInventoryForClass } from "../data/classes.js";
import { getBotDifficultyPreset, normalizeBotDifficulty } from "../data/botDifficulty.js";

function randRange(a, b){
  return a + Math.random() * (b - a);
}

function pick(arr){
  if(!arr || !arr.length) return null;
  return arr[(Math.random() * arr.length) | 0];
}

function vec2Len(x,z){
  return Math.sqrt(x*x + z*z);
}


const DIFF_RANK = { very_easy:0, easy:1, normal:2, hard:3, expert:4, nightmare:5 };
function diffAtLeast(id, need){
  const a = DIFF_RANK[String(id||'normal')] ?? 2;
  const b = DIFF_RANK[String(need||'normal')] ?? 2;
  return a >= b;
}

function botWeaponSoundKey(weaponId, weapon){
  const id = String(weaponId||"").toLowerCase();
  const fm = String(weapon?.fireMode||"").toLowerCase();
  // very small mapping layer to the synth SFX keys in SoundSystem
  if(id.includes("pistol")){
    if(id.includes("mp") || id.includes("machine")) return "fire_machine_pistol";
    return "fire_pistol";
  }
  if(id.startsWith("ar") || id.includes("ranger") || id.includes("viper") || id.includes("sentinel")) return (fm==='auto' ? "fire_ar_light" : "fire_dmr_light");
  if(id.startsWith("smg") || id.includes("swift") || id.includes("wasp") || id.includes("phantom") || id.includes("riot")) return "fire_smg_fast";
  if(id.startsWith("lmg") || id.includes("bulwark") || id.includes("hammer")) return "fire_lmg_heavy";
  if(id.startsWith("sg") || id.includes("breaker") || id.includes("reaper")) return "fire_sg_heavy";
  if(id.startsWith("dmr") || id.includes("marksman") || id.includes("longshot")) return "fire_dmr_heavy";
  if(id.startsWith("sr") || id.includes("pioneer") || id.includes("valkyrie")) return "fire_sr_heavy";
  return "fire_pistol";
}

export class BotManager {
  /**
   * @param {{
   *  scene:THREE.Scene,
   *  collisionWorld:any,
   *  map:any,
   *  mode?:string,
   *  getPlayerPosition?:()=>THREE.Vector3|null,
   *  getPlayerTeam?:()=>('blue'|'red'|'neutral')|string|null,
   *  damageSystem?:any,
   *  getPlayerAimPosition?:()=>THREE.Vector3|null,
   *  getCollidables?:()=>any[],
   *  onShootPlayer?:(payload:{amount:number, headshot?:boolean, weaponId?:string, sourceTeam?:string})=>void,
   * }} params
   */
  constructor({ scene, collisionWorld, map, mode, getPlayerPosition, getPlayerAimPosition, getCollidables, onShootPlayer, damageSystem, getPlayerTeam, botCountBlue, botCountRed, difficultyId, playerBaseSpeed }){
    this.scene = scene;
    this.collisionWorld = collisionWorld;
    this.map = map;
    this.mode = mode || "zone";

    // External hooks (provided by game.html)
    this.getPlayerPosition = (typeof getPlayerPosition === 'function') ? getPlayerPosition : (()=>null);
    this.getPlayerAimPosition = (typeof getPlayerAimPosition === 'function') ? getPlayerAimPosition : (()=>null);
    this.getCollidables = (typeof getCollidables === 'function') ? getCollidables : (()=>[]);
    this.onShootPlayer = (typeof onShootPlayer === 'function') ? onShootPlayer : (()=>{});
    this.getPlayerTeam = (typeof getPlayerTeam === 'function') ? getPlayerTeam : (()=>'blue');
    this.damageSystem = (typeof window !== 'undefined' && window.damageSystem) ? window.damageSystem : null;
    if(damageSystem) this.damageSystem = damageSystem;

    // ThrowablesSystem (for bot grenades / smoke / flash)
    this.throwables = (typeof window !== 'undefined' && window.throwablesSystem) ? window.throwablesSystem : null;


    /** @type {{id:string,team:'blue'|'red',mesh:THREE.Object3D,pos:THREE.Vector3,yaw:number,hp:number,alive:boolean,state:string,targetZoneId:string|null,target:THREE.Vector3,nextRetarget:number,holdUntil:number}[]} */
    this.bots = [];

    // Tuning
    this.botCountBlue = Number((arguments[0]&&arguments[0].botCountBlue)!=null ? arguments[0].botCountBlue : 4);
    this.botCountRed  = Number((arguments[0]&&arguments[0].botCountRed)!=null ? arguments[0].botCountRed  : 5);
    // Patch 9-4D: match bot movement speed to player base speed for fairness/feel.
    // PlayerController default baseSpeed is 6.
    this.speed = (typeof playerBaseSpeed === 'number' && isFinite(playerBaseSpeed)) ? playerBaseSpeed : 6;
    this.turnSpeed = 7.0;   // rad/s

    // ---- Patch 9-3C+: Difficulty presets (selected in lobby)
    this.difficultyId = normalizeBotDifficulty(difficultyId);
    this.diff = getBotDifficultyPreset(this.difficultyId);

    // Internal clock for status effects
    this._time = 0;

    // Bot capsule (roughly player-sized)
    this.radius = 0.42;
    this.halfHeight = 0.92;

    // Combat tuning (Patch 8-4A: stricter, pistol-only, no wall-through feel)
    // - Split detection vs engagement ranges
    // - Require sustained visibility before engaging
    // - Only shoot while LOS is currently true (no "memory shooting")
    this.detectRange = Number(this.diff?.detectRange ?? 25) || 25; // can "notice" enemy
    this.engageRange = Number(this.diff?.engageRange ?? 18) || 18; // will actually shoot
    this.visionFovDeg = 110;               // degrees
    this.losPadding = 0.25;                // meters
    this.shootMinRange = 5.5;              // too-close fallback

    // Bot weapon: pistol (use local tuned spec; keep weaponId for HUD/logs)
    this.botWeaponId = 'pistol1';
    this.botWeapon = {
      id: 'pistol_bot',
      name: 'Bot Pistol',
      damage: 20,
      headshotMult: 1.6,
      rpm: 360,
    };
    this._ray = new THREE.Raycaster();
    this._tmpDir = new THREE.Vector3();
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3(0,1,0);

    // Pre-normalize zones
    this.zones = (map?.zones || []).map(z => {
      const p = z.pos ?? z.position ?? [0,0,0];
      return {
        id: String(z.id ?? "?"),
        x: Number(p[0] ?? p.x ?? 0) || 0,
        z: Number(p[2] ?? p.z ?? 0) || 0,
        radius: Number(z.radius ?? z.r ?? z.captureRadius ?? 8) || 8,
      };
    });

    // Campaign mode: if no capture zones exist, derive simple AI target zones from campaign triggers.
    if(String(this.mode)==='campaign' && (!this.zones || this.zones.length===0)) {
      try {
        const t = this.map?.campaign?.triggers || this.map?.meta?.campaign?.triggers;
        if (t && typeof t === 'object') {
          this.zones = Object.entries(t).map(([id,v])=>{
            const p = v?.pos || [0,0,0];
            return { id: String(id), x: Number(p[0])||0, z: Number(p[2])||0, radius: Math.max(6, Number(v?.r)||10) };
          });
        }
      } catch { /* ignore */ }
    }


    // Spawns
    const sp = map?.spawns || [];
    // buildScene uses current.spawns, but map.json keeps array; support both
    this.spawnBlue = map?.spawnsBlue || null;
    this.spawnRed  = map?.spawnsRed  || null;
    if(!this.spawnBlue || !this.spawnRed){
      // try array entries
      const b = sp.find(s => String(s.team||'').toLowerCase() === 'blue') || sp[0];
      const r = sp.find(s => String(s.team||'').toLowerCase() === 'red')  || sp[1] || sp[0];
      this.spawnBlue = b;
      this.spawnRed  = r;
    }

    // ---- Patch 9-3A: pathfinding + stuck resolver (movement module #1)
    // We keep movement deterministic and avoid wall-rubbing by combining:
    // 1) A* grid path, 2) local avoidance, 3) stuck detection -> repath/nudge.
    try{
      // Patch 9-4F: finer nav grid + extra clearance for less wall-rubbing
      // (agentRadius slightly larger than bot capsule radius)
      this.navigator = new BotNavigator({
        collisionWorld: this.collisionWorld,
        map: this.map,
        cellSize: 1.3,
        agentRadius: Math.max(0.55, (this.radius || 0.42) + 0.14),
      });
    }catch{
      this.navigator = null;
    }
    this.stuckResolver = new StuckResolver();

    // ---- Patch 9-4D.1: lightweight bot gadgets (for nightmare AI item usage)
    // Stored in manager so we can resolve triggers against all bots/player.
    this._botMines = [];
  }

  init(){
    this.clear();
    for(let i=0;i<this.botCountBlue;i++){ this._spawnBot(`B${i+1}`, 'blue'); }
    for(let i=0;i<this.botCountRed;i++){ this._spawnBot(`R${i+1}`, 'red'); }
  }

  // Hotfix 9-4E.2: Conquest defender spawn rule.
  // Defender bots should spawn one zone behind the current frontline zone.
  _getSpawnPosForTeam(team){
    const t = String(team || 'blue').toLowerCase();
    // Conquest defender dynamic spawn
    try{
      if(String(this.mode || '').toLowerCase() === 'conquest'){
        const ms = (typeof window !== 'undefined') ? window.modeSystem : null;
        const def = String(ms?.conquestDefender || 'red').toLowerCase();
        if(t === def){
          const order = ms?.order;
          if(Array.isArray(order) && order.length){
            const fi = (ms?.conquestFrontIndex ?? 0) | 0;
            const idx = Math.min(fi + 2, order.length - 1);
            const zid = order[idx];
            const z = this.zones.find(zz => String(zz?.id || '').toUpperCase() === String(zid).toUpperCase());
            if(z){
              return { x: z.x, y: 0, z: z.z, _from: 'conquestZone' };
            }
          }
        }
      }
    }catch(e){ /* fall back */ }

    const spawn = (t === 'red') ? this.spawnRed : this.spawnBlue;
    const p = spawn?.pos ?? spawn?.position ?? [0, 0, 0];
    const x = Number(p[0] ?? p.x ?? 0) || 0;
    const y = Number(p[1] ?? p.y ?? 0) || 0;
    const z = Number(p[2] ?? p.z ?? 0) || 0;
    return { x, y, z, _from: 'teamSpawn' };
  }

  clear(){
    for(const b of this.bots){
      try{ b.mesh?.parent?.remove?.(b.mesh); }catch{}
    }
    this.bots.length = 0;
  }

  _makeBotMesh(team){
    // Simple capsule-ish: cylinder + 2 spheres
    const group = new THREE.Group();
    group.name = `bot_${team}`;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: team === 'red' ? 0xff5555 : 0x55aaff,
      roughness: 0.85,
      metalness: 0.05,
      transparent: true,
      opacity: 0.95,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.0,
      transparent: true,
      opacity: 0.95,
    });

    // Player-ish proportions
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.45, 12), bodyMat);
    cyl.position.y = 0.725;
    cyl.castShadow = false;
    cyl.receiveShadow = false;
    group.add(cyl);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), headMat);
    head.position.set(0, 1.62, 0);
    head.userData.hitRegion = "head"; // Patch 8-2 headshot hook
    group.add(head);

    // tiny forward nub for facing direction (debug)
    const nub = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.28), headMat);
    nub.position.set(0, 1.30, 0.42);
    nub.userData.isBotNub = true;
    group.add(nub);

    return group;
  }

  _spawnBot(id, team){
    const base = this._getSpawnPosForTeam(team);

    const mesh = this._makeBotMesh(team);
	    // Patch 9-4F: prevent blue/red perfect stacking at spawn.
	    let sx = (Number(base?.x ?? 0) || 0);
	    let sz = (Number(base?.z ?? 0) || 0);
	    for(let t=0;t<12;t++){
	      const ox = sx + randRange(-1.7, 1.7);
	      const oz = sz + randRange(-1.7, 1.7);
	      let ok = true;
	      for(const o of this.bots){
	        if(!o?.pos) continue;
	        const dx = o.pos.x - ox;
	        const dz = o.pos.z - oz;
	        if((dx*dx + dz*dz) < 1.2*1.2){ ok = false; break; }
	      }
	      if(ok){ sx = ox; sz = oz; break; }
	      // keep searching
	      sx = ox; sz = oz;
	    }
	    mesh.position.set(sx, 0, sz);
    this.scene.add(mesh);

    // ---- Patch 9-3A: bot has its own "profile" + economy (module #2 구매)
    const classPool = ["assault","medic","support","sniper"];
    const classId = normalizeClassId(pick(classPool));
    const profile = {
      isBot: true,
      id: String(id),
      team,
      classId,
      inventory: initInventoryForClass(classId),
      money: 0,
      // NOTE: bot weapon switching AI is Patch 9-3B; here we just track ids.
      selectedSlot: "secondary", // "primary"|"secondary"
    };
    const economy = new EconomyManager(profile);
    economy.initOnGameStart();

    const shop = new ShopSystem({
      getProfile: ()=>profile,
      getEconomy: ()=>economy,
    });

    const bot = {
      id: String(id),
      team,
      mesh,
      pos: mesh.position.clone(),
      yaw: 0,
      hp: 100,
      alive: true,
      state: 'MOVE_TO_ZONE',
      targetZoneId: null,
      target: new THREE.Vector3(),
      nextRetarget: 0,
      holdUntil: 0,
      // Lifecycle
      respawnLeft: 0,
      damageId: null,
      // Combat
      engageUntil: 0,
      shootCooldown: randRange(0.15, 0.35),
      // Tactical cooldowns
      grenadeCooldown: 0,
      smokeCooldown: 0,
      flashCooldown: 0,
      ladderCooldown: 0,
      ladderSnipeUntil: 0,
      retreatUntil: 0,
      // Patch 10: make retreat harder (bots don't disengage too easily)
      retreatCooldownUntil: 0,
      lastHitTime: -999,
      hitStreak: 0,
      _lastHp: 100,
      lastLOSFlipTime: -999,
      prevCanSee: false,
      reactionLeft: 0,
      firstShotLeft: 0,
      burstLeft: 0,
      burstPause: 0,
      aimErrYaw: 0,
      aimErrTimer: 0,
      // Patch 8-4A: stricter detection state
      seenTime: 0,
      detectNeed: randRange(this.diff?.detectNeedMin ?? 0.18, this.diff?.detectNeedMax ?? 0.35),
      losLostTime: 0,
      botLosLostTime: 0,
    
      // Status effects (seconds, using internal clock)
      flashUntil: 0,
      smokeUntil: 0,
      stunUntil: 0,
      // Wall interaction
      wallUntil: 0,
      wallN: new THREE.Vector3(0,0,0),
      combatTarget: null,
      // ---- Nav state (Patch 9-3A)
      path: null,
      pathIdx: 0,
      repathLeft: 0,
      // Economy/profile
      profile,
      economy,
      shop,
      // light decision timers
      buyCheckLeft: randRange(0.6, 1.2),

      // ---- Patch 9-3B (part): Perception & weapon switching scaffolding
      lastSeenPos: new THREE.Vector3(),
      lastSeenLeft: 0,
      lastSeenType: null, // "player"|"bot"|null
      searchLeft: 0,
      currentWeaponId: "pistol1",
      // Patch 9-3C+: bot-vs-bot hunt timers
      huntLeft: 0,
      huntTargetId: null,
      huntCooldown: randRange(0.6, 1.4),

      // Patch 9-4D: class-item usage & tactical buffs
      healCooldown: randRange(2.0, 5.0),
      binoUntil: 0,
      panzerCooldown: randRange(4.0, 9.0),
      mineCooldown: randRange(6.0, 12.0),
      healSmokeCooldown: randRange(5.0, 10.0),
      tacticalAggro: 0,
    };

    // First buy + first target
    this._botAutoBuy(bot, /*onSpawn=*/true);
    this._retarget(bot, true);

    // Register as damageable (so player shots can hurt bots)
    try{
      const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
      if(ds && typeof ds.register === 'function'){
        bot.damageId = ds.register(mesh, {
          team: team,
          maxHp: 100,
          height: 1.85,
          headshotYRatio: 0.80,
        });
      }
    }catch(e){}

    this.bots.push(bot);
    return bot;
  }

  _retarget(bot, immediate=false){
    // ---- Patch 9-3A: mode-aware target selection
    // Zone: move between objectives (bias toward enemy/neutral)
    // Conquest/Frontline: respect "one active objective" rule via ModeSystem.getActiveZoneId().
    const mode = String(this.mode || this.map?.meta?.mode || "zone").toLowerCase();
    const ms = (typeof window !== 'undefined') ? (window.modeSystem || null) : null;

    let targetZoneId = null;
    if((mode === "conquest" || mode === "frontline") && ms && typeof ms.getActiveZoneId === "function"){
      targetZoneId = ms.getActiveZoneId();
    }

    // fallback: pick a reasonable zone
    let z = null;
    if(targetZoneId){
      z = this.zones.find(v=>String(v.id)===String(targetZoneId)) || null;
    }
    if(!z){
      // Zone mode bias: 60% pick nearest non-friendly objective if modeSystem exists
      const prefer = (mode === "zone" && ms && ms.cap instanceof Map) ? 0.6 : 0.0;
      if(mode === "zone" && Math.random() < prefer){
        z = this._pickNearestInterestingZone(bot, ms);
      }
      if(!z) z = pick(this.zones);
    }
    if(!z) return;

    bot.targetZoneId = String(z.id);
    // Aim for a random point within zone radius (but keep to walkable cells if nav exists)
    const ang = Math.random() * Math.PI * 2;
    const rr = Math.random() * (Math.max(3, z.radius) * 0.55);
    const tx = z.x + Math.cos(ang) * rr;
    const tz = z.z + Math.sin(ang) * rr;
    const nudged = this.navigator?.nudgeToWalkable?.(tx, tz);
    if(nudged){
      bot.target.set(nudged.x, bot.pos.y, nudged.z);
    }else{
      bot.target.set(tx, bot.pos.y, tz);
    }

    bot.state = 'MOVE_TO_ZONE';
    bot.nextRetarget = (immediate ? 0 : randRange(8, 18));
    this._botRepath(bot, /*force=*/true);
  }

  _pickNearestInterestingZone(bot, modeSystem){
    // modeSystem.cap stores owner sign. Use it if available.
    const mySign = (String(bot.team).toLowerCase() === "red") ? -1 : 1;
    let best = null;
    let bestD = Infinity;
    for(const z of this.zones){
      const st = modeSystem?.cap?.get?.(String(z.id)) || null;
      const owner = st?.owner ?? 0;
      // Prefer zones not owned by us
      if(owner === mySign) continue;
      const dx = z.x - bot.pos.x;
      const dz = z.z - bot.pos.z;
      const d2 = dx*dx + dz*dz;
      if(d2 < bestD){ bestD = d2; best = z; }
    }
    return best;
  }

  
  _botRepath(bot, force=false){
    if(!this.navigator) return;
    if(!force && bot.repathLeft > 0) return;
    bot.repathLeft = 0.25; // throttle
    const path = this.navigator.findPathWorld(bot.pos, bot.target, { maxExpansions: 18000 });
    if(path && path.length >= 2){
      bot.path = path;
      bot.pathIdx = 1; // [0] is current cell
      bot._pathFail = 0;
    }else{
      bot.path = null;
      bot.pathIdx = 0;
      bot._pathFail = (bot._pathFail||0) + 1;
      const by = bot.target?.y ?? bot.pos.y;

      // Campaign/urban maps can have tight choke points. Try nearby alternatives so bots
      // don't cluster forever in a dead corner.
      if(bot._pathFail <= 6){
        const bx = bot.target?.x ?? 0;
        const bz = bot.target?.z ?? 0;
        for(let i=0;i<4;i++){
          const ang = Math.random()*Math.PI*2;
          const rad = 6 + Math.random()*18;
          const alt = new THREE.Vector3(bx + Math.cos(ang)*rad, by, bz + Math.sin(ang)*rad);
          const p2 = this.navigator.findPathWorld(bot.pos, alt, { maxExpansions: 14000 });
          if(p2 && p2.length >= 2){
            bot.target.copy(alt);
            bot.path = p2;
            bot.pathIdx = 1;
            break;
          }
        }
      } else {
        // Hard reset: retarget to a random derived zone
        try{
          if(this.zones && this.zones.length){
            const z = this.zones[Math.floor(Math.random()*this.zones.length)];
            bot.target.set(z.x, by, z.z);
          }
        }catch{}
        bot._pathFail = 0;
      }
    }
  }

  _botAutoBuy(bot, onSpawn=false){
    // ---- Patch 9-3A: simple, deterministic shopping.
    // Goal: ensure bots actually use the same economy/shop rules as player.
    const prof = bot.profile;
    const eco = bot.economy;
    const shop = bot.shop;
    if(!prof || !eco || !shop) return;

    // Buy priority: primary -> 1 grenade -> pistol upgrade (optional)
    const inv = prof.inventory;
    const cid = normalizeClassId(prof.classId);
    const allow = CLASS_PRIMARY_ALLOW[cid] || [];

    if(!inv.primary){
      const candidates = SHOP.primaries
        .filter(it=>allow.includes(it.category))
        .slice()
        .sort((a,b)=>a.price-b.price);
      for(const it of candidates){
        if(eco.p.money >= it.price || (prof.money ?? 0) >= it.price){
          const r = shop.buy(it);
          if(r?.ok){
            prof.selectedSlot = "primary";
            break;
          }
        }
      }
    }

    // One grenade per bot early (helps later when we enable usage AI)
    if(Array.isArray(inv.grenades) && inv.grenades.filter(Boolean).length === 0){
      let pref = "frag";
      if(cid === "medic") pref = "smoke";
      if(cid === "sniper") pref = "flash";
      if(cid === "support") pref = "impact";
      const g = SHOP.grenades.find(x=>x.id===pref) || SHOP.grenades[0];
      if(g) shop.buy(g);
    }

    // Equip logic (temporary): if primary exists, stick with it.
    if(inv.primary) prof.selectedSlot = "primary";
    else prof.selectedSlot = "secondary";
  }

  update(dt){
    if(!dt || !Number.isFinite(dt)) return;


    this._time += dt;

    const playerPos = this.getPlayerPosition?.();
    const playerAim = this.getPlayerAimPosition?.() || playerPos;
    const hasPlayer = !!(playerPos && playerAim);

    const cosFov = Math.cos((this.visionFovDeg * Math.PI / 180) * 0.5);

    const playerTeam = String(this.getPlayerTeam?.() || 'blue').toLowerCase();

    // Patch 9-4D.1: tick bot mines (support gadget)
    this._tickBotMines(dt, playerPos, playerAim, playerTeam);

    for(const bot of this.bots){
      const now = this._time;
      if(!bot.alive){
        // Respawn timer
        if(bot.respawnLeft > 0){
          bot.respawnLeft -= dt;
          // Keep the corpse visible for most of the timer, then hide shortly before respawn.
          // This matches: "죽으면 가로로 쓰러지고 -> 잠시 후 사라짐 -> 리스폰".
          const hideWindow = 0.8;
          if(bot.mesh){
            bot.mesh.visible = bot.respawnLeft > hideWindow;
          }
          if(bot.respawnLeft <= 0){
            this._respawnBot(bot);
          }
        }
        continue;
      }

      // combat timers
      if(bot.shootCooldown > 0) bot.shootCooldown -= dt;
      if(bot.engageUntil > 0) bot.engageUntil -= dt;

      // ---- Patch 9-3B: Perception timers
      if(bot.lastSeenLeft > 0) bot.lastSeenLeft = Math.max(0, bot.lastSeenLeft - dt);
      if(bot.searchLeft > 0) bot.searchLeft = Math.max(0, bot.searchLeft - dt);

      // ---- Patch 9-3A: bot economy tick + periodic shopping
      try{ bot.economy?.tick?.(dt); }catch{}
      if(bot.buyCheckLeft > 0) bot.buyCheckLeft -= dt;
      if(bot.buyCheckLeft <= 0){
        bot.buyCheckLeft = randRange(6, 12);
        this._botAutoBuy(bot, /*onSpawn=*/false);
      }

      // Sync HP from DamageSystem
      try{
        const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
        if(ds && bot.damageId){
          const ent = ds.getEntityById?.(bot.damageId);
          if(ent){
            bot.hp = ent.hp;
            // Patch 9-4E: track recent damage for risk-based tactics
            if(typeof bot._lastHp === 'number' && ent.hp < bot._lastHp - 0.001){
              const prevHit = (typeof bot.lastHitTime === 'number') ? bot.lastHitTime : -999;
              bot.lastHitTime = now;
              bot.hitStreak = ((now - prevHit) < 1.2) ? ((bot.hitStreak||0)+1) : 1;
            }
            bot._lastHp = ent.hp;
            if(!ent.alive){
              this._onBotKilled(bot);
              continue;
            }
          }
        }
      }catch(e){}

      // ---- Patch 9-4D: bots can use class items (simplified AI usage)
      try{
        const isNightmare = (this.difficultyId === 'nightmare');

        if(bot.healCooldown > 0) bot.healCooldown -= dt;
        if(bot.panzerCooldown > 0) bot.panzerCooldown -= dt;
        if(bot.mineCooldown > 0) bot.mineCooldown -= dt;
        if(bot.healSmokeCooldown > 0) bot.healSmokeCooldown -= dt;

        // Medic: self-heal when low (bandage-like). This is independent from player ClassItemsSystem.
        if(bot.profile?.classId === 'medic' && bot.healCooldown <= 0){
          const healThresh = isNightmare ? 88 : 70;
          if(bot.hp < healThresh && now >= bot.flashUntil && now >= bot.stunUntil){
            const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
            if(ds && bot.damageId){
              const ent = ds.getEntityById?.(bot.damageId);
              if(ent && ent.alive){
                const add = (isNightmare ? (40 + Math.random()*26) : (28 + Math.random()*18));
                ent.hp = Math.min(ent.maxHp || 100, ent.hp + add);
                bot.hp = ent.hp;
                bot.healCooldown = isNightmare ? randRange(4.2, 7.2) : randRange(7.5, 12.5);
                // small behavior: when healing, briefly stop pushing
                bot.engageUntil = Math.min(bot.engageUntil, 0.4);
                try{ window.soundSystem?.play?.('reload_end_pistol'); }catch(e){}
              }
            }
          }
        }

        // Medic: heal-smoke launcher (nightmare uses this aggressively)
        if(bot.profile?.classId === 'medic' && bot.healSmokeCooldown <= 0){
          const want = isNightmare
            ? (bot.hp < 78 || (bot.state === 'ENGAGE' && bot.engageUntil > 0.6))
            : (bot.hp < 58 && bot.state === 'ENGAGE');
          if(want && now >= bot.flashUntil && now >= bot.stunUntil){
            // Heal self + nearby allies (simple AoE heal)
            const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
            if(ds){
              const healR = isNightmare ? 7.2 : 5.8;
              const healA = isNightmare ? (26 + Math.random()*18) : (18 + Math.random()*12);
              for(const ally of this.bots){
                if(!ally || !ally.alive) continue;
                if(String(ally.team).toLowerCase() !== String(bot.team).toLowerCase()) continue;
                const d = ally.pos.distanceTo(bot.pos);
                if(d > healR) continue;
                if(!ally.damageId) continue;
                const ent = ds.getEntityById?.(ally.damageId);
                if(!ent || !ent.alive) continue;
                if(ent.hp >= (ent.maxHp||100)) continue;
                ent.hp = Math.min(ent.maxHp||100, ent.hp + healA);
                ally.hp = ent.hp;
              }
            }

            // Also create smoke to reduce incoming accuracy (re-uses bot smoke effect)
            try{ this.applyAoEEffect({ type:'smoke', pos: bot.pos.clone(), radius: isNightmare ? 8.5 : 6.5, duration: isNightmare ? 4.0 : 3.0, sourceTeam: bot.team }); }catch(e){}
            bot.healSmokeCooldown = isNightmare ? randRange(8.0, 12.0) : randRange(12.0, 18.0);
            try{ window.soundSystem?.play?.('swap'); }catch(e){}
          }
        }

        // Sniper: binocular focus buff for long shots (accuracy for a short window)
        if(bot.profile?.classId === 'sniper'){
          // When currently engaging and target is far, occasionally "focus".
          if(bot.state === 'ENGAGE' && bot.combatTarget && bot.binoUntil <= now){
            const tpos = bot.combatTarget?.pos || bot.combatTarget?.aimPos;
            if(tpos){
              const dx = tpos.x - bot.pos.x;
              const dz = tpos.z - bot.pos.z;
              const d = Math.sqrt(dx*dx+dz*dz);
              const chance = isNightmare ? 0.40 : 0.18;
              if(d >= (isNightmare ? 18 : 24) && Math.random() < chance){
                bot.binoUntil = now + (isNightmare ? randRange(4.0, 6.0) : randRange(2.8, 4.4));
                try{ window.soundSystem?.play?.('swap'); }catch(e){}
              }
            }
          }
        }

        // Assault: panzerfaust (nightmare uses as "finisher" / opener)
        if(bot.profile?.classId === 'assault' && bot.panzerCooldown <= 0){
          if(bot.state === 'ENGAGE' && bot.combatTarget && now >= bot.flashUntil && now >= bot.stunUntil){
            const t = bot.combatTarget;
            const tpos = (t.type === 'bot') ? t.bot?.pos : (hasPlayer ? playerAim : null);
            if(tpos){
              const dx = tpos.x - bot.pos.x;
              const dz = tpos.z - bot.pos.z;
              const dist = Math.hypot(dx, dz);
              const can = (dist >= 9 && dist <= (isNightmare ? 30 : 22)) && this._hasLOS(bot, this._tmpB.set(tpos.x, 1.45, tpos.z), this.detectRange * 1.25);
              let p = isNightmare ? 0.28 : 0.10;
              // Hard+ : 각 보이면 바로 판처파우스트 (특히 peeking 순간)
              if(diffAtLeast(this.difficultyId,'hard') && (now - (bot.lastLOSFlipTime||-999)) < 0.25){
                p = isNightmare ? 0.98 : 0.90;
              }
              if(can && Math.random() < p){
                const amount = isNightmare ? (92 + Math.random()*18) : (72 + Math.random()*14);
                if(t.type === 'bot' && t.bot?.damageId){
                  const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
                  if(ds) {
                    const res = ds.applyDamage(t.bot.damageId, amount, { weaponId:'panzerfaust', sourceTeam: bot.team, headshot:false });
                    try{ bot.economy?.rewardDamage?.(amount, false); }catch(e){}
                    if(res?.killed){ try{ bot.economy?.rewardKill?.(); }catch(e){} }
                  }
                }else{
                  this.onShootPlayer({ amount, headshot:false, weaponId:'panzerfaust', sourceTeam: bot.team, sourceId: bot.id });
                }
                bot.panzerCooldown = isNightmare ? randRange(10.0, 15.0) : randRange(16.0, 24.0);
                try{ window.soundSystem?.play?.('fire_sg_heavy'); }catch(e){}
              }
            }
          }
        }

        // Support: landmine placement (nightmare lays more mines around objectives)
        if(bot.profile?.classId === 'support' && bot.mineCooldown <= 0){
          const inSafe = (bot.state !== 'ENGAGE');
          if(inSafe && now >= bot.flashUntil && now >= bot.stunUntil){
            const z = bot.targetZoneId ? this.zones.find(v=>String(v.id)===String(bot.targetZoneId)) : null;
            const nearObj = z ? (Math.hypot(bot.pos.x - z.x, bot.pos.z - z.z) <= Math.max(4.5, z.radius * 0.85)) : false;
            const p = isNightmare ? 0.55 : 0.18;
            if(nearObj && Math.random() < p){
              this._botMines.push({
                pos: bot.pos.clone(),
                team: bot.team,
                armedAt: now + 0.65,
                ttlAt: now + (isNightmare ? 55 : 40),
                ownerId: bot.id,
              });
              bot.mineCooldown = isNightmare ? randRange(10.0, 18.0) : randRange(18.0, 28.0);
              try{ window.soundSystem?.play?.('swap'); }catch(e){}
            }
          }
        }
      }catch(e){}


      // ---- Patch 9-4E: Hard+ tactical layer (grenades / smoke&flash retreat / ladder snipe)
      const hardPlus = diffAtLeast(this.difficultyId, 'hard');
      if(hardPlus){
        // tick tactical cooldowns
        if(bot.grenadeCooldown > 0) bot.grenadeCooldown -= dt;
        if(bot.smokeCooldown > 0) bot.smokeCooldown -= dt;
        if(bot.flashCooldown > 0) bot.flashCooldown -= dt;
        if(bot.ladderCooldown > 0) bot.ladderCooldown -= dt;

        // Risk 판단: "쉽게 후퇴하지 않게" 조건을 더 빡세게.
        // - ENGAGE 중일 때만
        // - HP가 꽤 낮고(또는 치명적) + 최근 연속 피격이 있어야
        // - 후퇴 쿨다운이 지나야
        const inFight = (bot.state === 'ENGAGE') && !!bot.combatTarget;
        const criticalHp = (this.difficultyId === 'nightmare') ? 34 : 24;
        const lowHp = bot.hp < ((this.difficultyId === 'nightmare') ? 48 : 34);
        const recentlyHit = (now - (bot.lastHitTime||-999)) < 1.1 && (bot.hitStreak||0) >= 3;
        const canRetreat = inFight && (now >= (bot.retreatCooldownUntil||0)) && (now >= bot.flashUntil) && (now >= bot.stunUntil);
        const shouldRetreat = (bot.hp <= criticalHp) || (lowHp && recentlyHit);
        if(canRetreat && shouldRetreat){
          if(bot.smokeCooldown <= 0){
            try{
              this.throwables?.triggerDetonation?.('smoke', bot.pos.clone());
            }catch(e){}
            bot.smokeCooldown = (this.difficultyId === 'nightmare') ? randRange(8, 12) : randRange(12, 18);
          }
          if(bot.flashCooldown <= 0){
            // flash slightly forward so it can actually screen
            const fwd = this._tmpDir.set(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
            const p = bot.pos.clone().add(fwd.multiplyScalar(3.2));
            try{ this.throwables?.triggerDetonation?.('flash', p); }catch(e){}
            bot.flashCooldown = (this.difficultyId === 'nightmare') ? randRange(10, 15) : randRange(16, 22);
          }
          // set retreat target away from last seen threat
          if(now + 0.2 > (bot.retreatUntil||0)){
            bot.retreatUntil = now + randRange(2.6, 4.6);
            bot.retreatCooldownUntil = now + ((this.difficultyId === 'nightmare') ? randRange(8.0, 11.0) : randRange(11.0, 15.0));
            bot.state = 'RETREAT';
            const away = this._tmpDir.set(0,0,0);
            if(bot.lastSeenLeft > 0.05){
              away.set(bot.pos.x - bot.lastSeenPos.x, 0, bot.pos.z - bot.lastSeenPos.z);
            }else if(hasPlayer){
              away.set(bot.pos.x - playerAim.x, 0, bot.pos.z - playerAim.z);
            }
            if(away.lengthSq() < 1e-6) away.set(Math.random()*2-1,0,Math.random()*2-1);
            away.normalize().multiplyScalar(14);
            bot.target.set(bot.pos.x + away.x, 0, bot.pos.z + away.z);
            this._botRepath(bot, /*force=*/true);
          }
        }

        // Sniper: "사다리 저격" (Hard+). 간단히 높은 위치로 올라가서 몇 초간 고정 사격.
        if(bot.profile?.classId === 'sniper' && bot.state === 'ENGAGE' && bot.combatTarget && bot.ladderCooldown <= 0){
          const tpos = (bot.combatTarget.type === 'bot') ? bot.combatTarget.bot?.pos : (hasPlayer ? playerAim : null);
          if(tpos){
            const d = Math.hypot(tpos.x - bot.pos.x, tpos.z - bot.pos.z);
            const wantHigh = (d > 20) && (bot.pos.y < 2.5) && (now > bot.flashUntil) && (now > bot.stunUntil);
            if(wantHigh && Math.random() < (this.difficultyId === 'nightmare' ? 0.65 : 0.35)){
              bot.pos.y = Math.min(7.0, bot.pos.y + randRange(3.6, 4.6));
              bot.mesh.position.y = bot.pos.y;
              bot.ladderSnipeUntil = now + randRange(4.5, 7.0);
              bot.ladderCooldown = randRange(18, 28);
              try{ window.soundSystem?.play?.('swap'); }catch(e){}
            }
          }
        }

        // Throwables: 적극적으로 던지기 (Hard+). LOS가 끊기거나 엄폐 뒤라고 판단되면 마지막 본 위치에 던짐.
        if(bot.state === 'ENGAGE' && bot.grenadeCooldown <= 0 && now >= bot.flashUntil && now >= bot.stunUntil){
          const tgtPos = (bot.lastSeenLeft > 0.05) ? bot.lastSeenPos : null;
          if(tgtPos){
            const d = Math.hypot(tgtPos.x - bot.pos.x, tgtPos.z - bot.pos.z);
            if(d >= 10 && d <= 26){
              const p = (this.difficultyId === 'nightmare') ? 0.22 : 0.10;
              if(Math.random() < p){
                // Nightmare: flash -> frag combo 느낌, 그 외: frag 위주
                const kind = (this.difficultyId === 'nightmare' && Math.random() < 0.55) ? 'flash' : 'frag';
                try{ this.throwables?.triggerDetonation?.(kind, new THREE.Vector3(tgtPos.x, 0.2, tgtPos.z)); }catch(e){}
                bot.grenadeCooldown = (this.difficultyId === 'nightmare') ? randRange(6.5, 10.5) : randRange(10.0, 15.5);
              }
            }
          }
        }
      }

      // Check detection -> engage (Patch 8-4A: stricter)
      // 1) Enemy bots (bot vs bot)  (Patch 9-3C+: more aggressive bot-vs-bot)
      if(now >= bot.flashUntil && now >= bot.stunUntil){
        const vsBotRange = this.detectRange * (Number(this.diff?.vsBotDetectMult ?? 1.12) || 1.12);
        const enemy = this._findVisibleEnemyBot(bot, cosFov, vsBotRange);
        if(enemy){
          // remember last known position (Patch 9-3B)
          bot.lastSeenPos.set(enemy.pos.x, 0, enemy.pos.z);
          bot.lastSeenLeft = 4.0;
          bot.lastSeenType = "bot";
          bot.seenTime = Math.min(2, bot.seenTime + dt);
          bot.losLostTime = 0;
          if(bot.seenTime >= bot.detectNeed){
            if(bot.state !== 'ENGAGE' || bot.combatTarget?.type !== 'bot'){
              // human-ish reaction even for bot-vs-bot
              const rMin = Number(this.diff?.reactionMin ?? 0.35) || 0.35;
              const rMax = Number(this.diff?.reactionMax ?? 0.60) || 0.60;
              const fMin = Number(this.diff?.firstShotMin ?? 0.12) || 0.12;
              const fMax = Number(this.diff?.firstShotMax ?? 0.22) || 0.22;
              const reactMult = 0.75; // bots react slightly faster to other bots by default
              bot.reactionLeft = randRange(rMin, rMax) * reactMult;
              bot.firstShotLeft = randRange(fMin, fMax) * reactMult;
              bot.burstLeft = 0;
              bot.burstPause = 0;
              bot.aimErrYaw = 0;
              bot.aimErrTimer = 0;
              bot.botLosLostTime = 0;
            }
            bot.state = 'ENGAGE';
            bot.combatTarget = { type:'bot', bot: enemy };
            const ag = Number(this.diff?.vsBotAggression ?? 1.35) || 1.35;
            bot.engageUntil = randRange(1.6, 3.2) * ag;
          }
          // keep fighting
          if(bot.state === 'ENGAGE'){
            // Hotfix 9-4E.2: player priority.
            // If an enemy player is clearly visible, don't tunnel on bot-vs-bot.
            try{
              if(hasPlayer){
                const pt = (typeof this.getPlayerTeam === 'function') ? String(this.getPlayerTeam() || '').toLowerCase() : '';
                const isEnemyPlayer = !pt || (String(bot.team).toLowerCase() !== pt);
                if(isEnemyPlayer){
                  const seeP = this._canSeePlayer(bot, playerAim, cosFov, this.detectRange);
                  if(seeP){
                    const dp = Math.hypot(playerAim.x - bot.pos.x, playerAim.z - bot.pos.z);
                    const de = Math.hypot(enemy.pos.x - bot.pos.x, enemy.pos.z - bot.pos.z);
                    if(dp <= Math.min(14, de * 0.85)){
                      if(bot.combatTarget?.type !== 'player'){
                        bot.combatTarget = { type: 'player' };
                        // keep existing reaction timers if already set
                      }
                      this._engage(bot, playerAim, dt, bot.combatTarget);
                      continue;
                    }
                  }
                }
              }
            }catch(e){}

            this._engage(bot, this._tmpB.set(enemy.pos.x, 1.55, enemy.pos.z), dt, bot.combatTarget);
            continue;
          }
        }
      }

      if(hasPlayer){
        // Team check: bots do not engage friendly player
        if(playerTeam && String(bot.team).toLowerCase() === playerTeam){
          bot.seenTime = 0;
          bot.losLostTime = 0;
          // Hotfix 9-4E.2: don't wipe bot-vs-bot combat target when a friendly player exists.
          if(bot.combatTarget?.type === 'player'){
            if(bot.state === 'ENGAGE') bot.state = 'MOVE_TO_ZONE';
            bot.combatTarget = null;
          }
        } else {
          // LOS true? (for detection)
          const see = (now < bot.flashUntil || now < bot.smokeUntil || now < bot.stunUntil) ? false : this._canSeePlayer(bot, playerAim, cosFov, this.detectRange);
          // Patch 9-4E: track LOS edge for instant reactions (panzer / snap decisions)
          if(see && !bot.prevCanSee){ bot.lastLOSFlipTime = now; }
          bot.prevCanSee = !!see;
          if(see){
            // remember last known player position (Patch 9-3B)
            bot.lastSeenPos.set(playerAim.x, 0, playerAim.z);
            bot.lastSeenLeft = 5.0;
            bot.lastSeenType = "player";
            bot.seenTime = Math.min(2, bot.seenTime + dt);
            bot.losLostTime = 0;
          }else{
            // decay quickly so peeking doesn't instantly aggro
            bot.seenTime = Math.max(0, bot.seenTime - dt * 2.2);
            bot.losLostTime = Math.min(2, bot.losLostTime + dt);
          }

          // enter engage only after sustained visibility
          if(bot.seenTime >= bot.detectNeed){
            if(bot.state !== 'ENGAGE'){
              bot.combatTarget = { type:'player' };
              // Human-like reaction delay before first shot
              const rMin = Number(this.diff?.reactionMin ?? 0.35) || 0.35;
              const rMax = Number(this.diff?.reactionMax ?? 0.60) || 0.60;
              const fMin = Number(this.diff?.firstShotMin ?? 0.12) || 0.12;
              const fMax = Number(this.diff?.firstShotMax ?? 0.22) || 0.22;
              bot.reactionLeft = randRange(rMin, rMax);
              bot.firstShotLeft = randRange(fMin, fMax);
              bot.burstLeft = 0;
              bot.burstPause = 0;
              bot.aimErrYaw = 0;
              bot.aimErrTimer = 0;
            }
            bot.state = 'ENGAGE';
            bot.engageUntil = 0.35; // short linger, but no shooting without LOS
          }

          // leave engage after LOS has been gone for a bit
          if(bot.state === 'ENGAGE' && bot.losLostTime > 0.55 && bot.engageUntil <= 0){
            // If we recently saw the enemy, go investigate instead of snapping back to routing.
            if(bot.lastSeenLeft > 0.15){
              bot.state = 'SEARCH';
              bot.searchLeft = Math.max(bot.searchLeft, 2.6);
              bot.target.set(bot.lastSeenPos.x, 0, bot.lastSeenPos.z);
              this._botRepath(bot, /*force=*/true);
            }else{
              bot.state = 'MOVE_TO_ZONE';
            }
            bot.seenTime = 0;
            bot.detectNeed = randRange(this.diff?.detectNeedMin ?? 0.18, this.diff?.detectNeedMax ?? 0.35);
          }
        }
      }

      // timers
      if(bot.nextRetarget > 0) bot.nextRetarget -= dt;

      // decide retarget
      if(bot.nextRetarget <= 0 && bot.state === 'MOVE_TO_ZONE'){
        // Only retarget while moving; holding has its own timer
        this._retarget(bot, false);
      }

      // ---- Patch 9-3C+: Bot vs Bot "hunt" behavior
      // 목적: 봇끼리도 더 자주 붙어서 교전하도록, 짧게 적 위치를 추격한다.
      // (단, 항상 존 목표를 버리진 않고, 짧게만 "싸우러" 갔다가 다시 목표로 복귀)
      if(bot.huntCooldown > 0) bot.huntCooldown -= dt;
      if((bot.state === 'MOVE_TO_ZONE' || bot.state === 'HOLD_ZONE') && bot.huntCooldown <= 0){
        bot.huntCooldown = randRange(0.8, 1.6);
        const chancePerSec = Number(this.diff?.vsBotHuntChancePerSec ?? 0.10) || 0.10;
        const ag = Number(this.diff?.vsBotAggression ?? 1.35) || 1.35;
        if(Math.random() < (chancePerSec * ag)){
          // pick nearest enemy within a soft radius
          let best = null;
          let bestD2 = 1e18;
          const maxR = 32;
          const maxR2 = maxR * maxR;
          for(const o of this.bots){
            if(!o || !o.alive) continue;
            if(String(o.team).toLowerCase() === String(bot.team).toLowerCase()) continue;
            const dx = o.pos.x - bot.pos.x;
            const dz = o.pos.z - bot.pos.z;
            const d2 = dx*dx + dz*dz;
            if(d2 > maxR2) continue;
            if(d2 < bestD2){ bestD2 = d2; best = o; }
          }
          if(best){
            bot.state = 'HUNT_BOT';
            bot.huntTargetId = best.id;
            bot.huntLeft = randRange(2.5, 4.5) * ag;
            bot.target.set(best.pos.x, 0, best.pos.z);
            bot.path = null;
            bot.pathIdx = 0;
            bot.repathLeft = 0;
          }
        }
      }

      // ---- Patch 9-3C+: handle HUNT_BOT state
      if(bot.state === 'HUNT_BOT'){
        bot.huntLeft -= dt;
        if(bot.huntLeft <= 0){
          bot.state = 'MOVE_TO_ZONE';
          bot.huntTargetId = null;
          this._retarget(bot, true);
          continue;
        }
        // Update target to the live enemy position if still alive
        if(bot.huntTargetId){
          const enemy = this.bots.find(b=>b && b.alive && String(b.id) === String(bot.huntTargetId) && String(b.team).toLowerCase() !== String(bot.team).toLowerCase());
          if(enemy){
            bot.target.set(enemy.pos.x, 0, enemy.pos.z);
          }else{
            // enemy died or disappeared
            bot.huntLeft = 0;
          }
        }
      }

      // ---- Patch 9-3B: SEARCH state (investigate last seen)
      if(bot.state === 'SEARCH'){
        if(bot.searchLeft <= 0){
          bot.state = 'MOVE_TO_ZONE';
          this._retarget(bot, true);
          continue;
        }
        // keep heading to bot.target (set when entering SEARCH)
      }

      if(bot.state === 'ENGAGE'){
        // If stunned, cannot engage/fire
        if(now < bot.stunUntil){ continue; }
        const tgt = bot.combatTarget;
        if(tgt?.type === 'bot' && tgt.bot && tgt.bot.alive){
          const tpos = this._tmpB.set(tgt.bot.pos.x, 1.55, tgt.bot.pos.z);
          // Track LOS loss vs bots too (Patch 9-3C+: smarter disengage/search)
          const canSee = this._hasLOS(bot, tpos, this.detectRange * 1.35);
          if(canSee){
            bot.botLosLostTime = 0;
            bot.lastSeenPos.set(tgt.bot.pos.x, 0, tgt.bot.pos.z);
            bot.lastSeenLeft = 4.0;
            bot.lastSeenType = "bot";
          }else{
            bot.botLosLostTime = Math.min(2, (bot.botLosLostTime || 0) + dt);
          }
          if(!canSee && bot.botLosLostTime > 0.75 && bot.engageUntil <= 0){
            // Investigate last seen pos instead of giving up instantly
            bot.state = 'SEARCH';
            bot.searchLeft = Math.max(bot.searchLeft, 2.2);
            bot.target.set(bot.lastSeenPos.x, 0, bot.lastSeenPos.z);
            this._botRepath(bot, /*force=*/true);
            bot.seenTime = 0;
            bot.detectNeed = randRange(this.diff?.detectNeedMin ?? 0.18, this.diff?.detectNeedMax ?? 0.35);
            continue;
          }
          this._engage(bot, tpos, dt, tgt);
          this._combatMove(bot, tpos, dt, tgt);
        } else if(hasPlayer && tgt?.type === 'player'){
          this._engage(bot, playerAim, dt, tgt);
          this._combatMove(bot, playerAim, dt, tgt);
        } else if(hasPlayer){
          // fallback: still engage player aim if target missing
          const fallback = {type:'player'};
          this._engage(bot, playerAim, dt, fallback);
          this._combatMove(bot, playerAim, dt, fallback);
        }
        // During engage: don't wander/retarget (keeps fighting)
        continue;
      }


      // ---- Patch 9-4E: RETREAT state (use target from tactical logic; return to routing after timer)
      if(bot.state === 'RETREAT'){
        if((bot.retreatUntil||0) > now){
          // keep moving along path (same movement module below)
          // reduce shooting pressure while retreating
          bot.engageUntil = Math.min(bot.engageUntil, 0.2);
        }else{
          bot.state = 'MOVE_TO_ZONE';
          bot.retreatUntil = 0;
          this._retarget(bot, false);
        }
      }

      if(bot.state === 'HOLD_ZONE'){
        bot.holdUntil -= dt;
        if(bot.holdUntil <= 0){
          this._retarget(bot, false);
          continue;
        }
        // Patch 9-4F: don't "AFK" on objectives.
        // - patrol around zone center
        // - if no combat contact for a while, reposition more aggressively
        const lastC = bot.lastContactAt || 0;
        const noContactFor = Math.max(0, now - lastC);
        const centerX = (bot.holdCenterX ?? bot.pos.x);
        const centerZ = (bot.holdCenterZ ?? bot.pos.z);
        const patrolR = Number(bot.patrolRadius ?? 3.2) || 3.2;
        bot.patrolPickLeft = (bot.patrolPickLeft ?? 0) - dt;
        const shouldPick = (bot.patrolPickLeft <= 0) || (noContactFor > 3.3 && bot.patrolPickLeft > 0.35);
        if(shouldPick){
          const a = Math.random() * Math.PI * 2;
          const r = randRange(Math.max(1.8, patrolR*0.55), patrolR);
          bot.target.x = centerX + Math.cos(a) * r;
          bot.target.z = centerZ + Math.sin(a) * r;
          bot.patrolPickLeft = randRange(0.8, 1.6);
          bot.path = null;
          bot.repathLeft = 0;
        }else{
          // micro wobble to look alive
          const wob = 0.25;
          bot.target.x += randRange(-wob, wob) * dt;
          bot.target.z += randRange(-wob, wob) * dt;
        }
        // If we've been idle too long, stop camping and rotate to a new objective
        if(noContactFor > 7.5){
          this._retarget(bot, true);
          continue;
        }
      }

      // ---- Patch 9-3A: path following + local avoidance (movement module #1)
      if(bot.repathLeft > 0) bot.repathLeft -= dt;

      // Pick current waypoint
      let goal = bot.target;
      if(bot.path && bot.pathIdx < bot.path.length){
        goal = bot.path[bot.pathIdx];
        // advance if reached
        const gdx = goal.x - bot.pos.x;
        const gdz = goal.z - bot.pos.z;
        if((gdx*gdx + gdz*gdz) < (0.85*0.85)){
          bot.pathIdx++;
          if(bot.pathIdx >= bot.path.length){
            bot.path = null;
          }
        }
      }

      const dx = goal.x - bot.pos.x;
      const dz = goal.z - bot.pos.z;
      const dist = vec2Len(dx, dz);

      if(bot.state !== 'HOLD_ZONE'){
        // if close enough to final target -> hold
        const tdx = bot.target.x - bot.pos.x;
        const tdz = bot.target.z - bot.pos.z;
        if((tdx*tdx + tdz*tdz) < (1.1*1.1)){
          bot.state = 'HOLD_ZONE';
          // Patch 9-4F: shorter holding + more rotations = more fights.
          const holdMul = Number(this.diff?.holdMul ?? 1.0) || 1.0;
          const baseHold = (String(this.mode||'').toLowerCase() === 'zone') ? randRange(2.0, 3.6) : randRange(1.6, 2.8);
          bot.holdUntil = baseHold * holdMul;
          bot.nextRetarget = randRange(4, 9);
          // cache a patrol center (zone center if known)
          let cx = bot.target.x, cz = bot.target.z;
          try{
            if(bot.targetZoneId){
              const z = this.zones.find(zz => String(zz?.id||'') === String(bot.targetZoneId));
              if(z){ cx = z.x; cz = z.z; }
            }
          }catch(e){}
          bot.holdCenterX = cx;
          bot.holdCenterZ = cz;
          bot.patrolRadius = randRange(2.8, 5.2);
          bot.patrolPickLeft = randRange(0.2, 0.6);
          bot.path = null;
          continue;
        }
      }

      // compute desired velocity toward goal
      let vx = 0, vz = 0;
      if(dist > 1e-4){
        vx = (dx / dist) * this.speed;
        vz = (dz / dist) * this.speed;
      }

      // local avoidance: walls (repulsion) + other bots (separation)
      const avoid = this._computeAvoidance(bot);
      vx += avoid.x;
      vz += avoid.z;

      // normalize to max speed
      const sp = Math.hypot(vx, vz);
      if(sp > this.speed){
        vx = (vx/sp) * this.speed;
        vz = (vz/sp) * this.speed;
      }

      // stuck detection -> repath + nudge
      const st = this.stuckResolver.update(bot, dt, goal);
      if(st.repath){
        this._botRepath(bot, /*force=*/true);
        if(st.nudge){
          bot.pos.x += st.nudge.x;
          bot.pos.z += st.nudge.z;
        }
      }

      // integrate
      bot.pos.x += vx * dt;
      bot.pos.z += vz * dt;

      // collision resolve (XZ only)
      const preX = bot.pos.x, preZ = bot.pos.z;
      try{ this.collisionWorld?.resolveCapsuleXZ?.(bot.pos, this.radius, this.halfHeight); }catch{}
      const corrX = bot.pos.x - preX;
      const corrZ = bot.pos.z - preZ;
      const corrLen = Math.hypot(corrX, corrZ);
      if(corrLen > 1e-4){
        bot.wallN.set(corrX / corrLen, 0, corrZ / corrLen);
        bot.wallUntil = this._time + 0.25;
      }

      // if we deviated too far from the path cell, repath
      if(this.navigator && bot.path && bot.pathIdx < (bot.path?.length||0)){
        const wp = bot.path[bot.pathIdx];
        const ddx = wp.x - bot.pos.x;
        const ddz = wp.z - bot.pos.z;
        if((ddx*ddx + ddz*ddz) > (5.5*5.5)){
          this._botRepath(bot, /*force=*/true);
        }
      }

      // update mesh
      bot.mesh.position.copy(bot.pos);
      bot.pos.y = 0;
      bot.mesh.position.y = 0;

      // face movement direction
      if(Math.hypot(vx, vz) > 0.15){
        const desiredYaw = Math.atan2(vx, vz);
        let dy = desiredYaw - bot.yaw;
        while(dy > Math.PI) dy -= Math.PI * 2;
        while(dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += dy * Math.min(1, this.turnSpeed * dt);
        bot.mesh.rotation.y = bot.yaw;
      }
    }
  }

  _computeAvoidance(bot){
    // Returns a small steering vector (x,z) in world space.
    const out = this._tmpAvoid || (this._tmpAvoid = new THREE.Vector3());
    out.set(0,0,0);

    // 1) Wall repulsion (prevents long "rubbing" along walls)
    const boxes = this.collisionWorld?.boxes || [];
    const range = 1.15;
    const range2 = range*range;
    for(const b of boxes){
      // ignore very low boxes (floor-ish) — our walls are tall anyway
      if((b.max?.y ?? 0) < 0.5) continue;
      const clx = Math.max(b.min.x, Math.min(bot.pos.x, b.max.x));
      const clz = Math.max(b.min.z, Math.min(bot.pos.z, b.max.z));
      const dx = bot.pos.x - clx;
      const dz = bot.pos.z - clz;
      const d2 = dx*dx + dz*dz;
      if(d2 < 1e-6 || d2 > range2) continue;
      const d = Math.sqrt(d2);
      const t = (range - d) / range; // 0..1
      out.x += (dx / d) * t * 2.0;
      out.z += (dz / d) * t * 2.0;
    }


    // 1.5) Forward feelers (predictive): reduce "벽에 비빔" by steering before collision
    try{
      const yaw = bot.yaw || 0;
      const angles = [0, -0.55, 0.55];
      const dist = 0.95;
      const pad = 0.32;
      for(const a of angles){
        const ax = Math.sin(yaw + a);
        const az = Math.cos(yaw + a);
        const px = bot.pos.x + ax * dist;
        const pz = bot.pos.z + az * dist;
        for(const b of boxes){
          if((b.max?.y ?? 0) < 0.5) continue;
          // If probe point is inside (or very close to) a wall AABB in XZ, push away.
          const insideX = (px >= (b.min.x - pad)) && (px <= (b.max.x + pad));
          const insideZ = (pz >= (b.min.z - pad)) && (pz <= (b.max.z + pad));
          if(!insideX || !insideZ) continue;
          // Compute a cheap outward normal from nearest face
          const dl = Math.abs(px - b.min.x);
          const dr = Math.abs(b.max.x - px);
          const df = Math.abs(pz - b.min.z);
          const dbk= Math.abs(b.max.z - pz);
          const m = Math.min(dl, dr, df, dbk);
          let nx = 0, nz = 0;
          if(m === dl) nx = -1;
          else if(m === dr) nx = 1;
          else if(m === df) nz = -1;
          else nz = 1;
          const strength = 1.45 * (a === 0 ? 1.0 : 0.75);
          out.x += nx * strength;
          out.z += nz * strength;
        }
      }
    }catch(e){}

    // 2) Separation from other bots (prevents "비비기" in corridors)
    // Patch 9-4F: handle perfect overlap (d2 ~ 0) + slightly stronger radius.
    const sepR = 1.35;
    const sepR2 = sepR*sepR;
    for(const o of this.bots){
      if(!o || o === bot || !o.alive) continue;
      const dx = bot.pos.x - o.pos.x;
      const dz = bot.pos.z - o.pos.z;
      const d2 = dx*dx + dz*dz;
      if(d2 > sepR2) continue;
      if(d2 < 1e-6){
        // Perfect overlap: inject a random nudge so they can separate.
        const a = Math.random() * Math.PI * 2;
        out.x += Math.cos(a) * 2.1;
        out.z += Math.sin(a) * 2.1;
        continue;
      }
      const d = Math.sqrt(d2);
      const t = (sepR - d) / sepR;
      out.x += (dx / d) * t * 1.6;
      out.z += (dz / d) * t * 1.6;
    }

    // 2.5) Nav-grid openness gradient (softly steers away from walls)
    try{
      const nav = this.navigator;
      if(nav && nav.opennessAtWorld){
        const cur = nav.opennessAtWorld(bot.pos.x, bot.pos.z);
        if((cur|0) <= 4){
          const step = Math.max(0.8, nav.grid?.cellSize || 1.2);
          const oR = nav.opennessAtWorld(bot.pos.x + step, bot.pos.z);
          const oL = nav.opennessAtWorld(bot.pos.x - step, bot.pos.z);
          const oF = nav.opennessAtWorld(bot.pos.x, bot.pos.z + step);
          const oB = nav.opennessAtWorld(bot.pos.x, bot.pos.z - step);
          const gx = (oR - oL);
          const gz = (oF - oB);
          const gLen = Math.hypot(gx, gz);
          if(gLen > 1e-3){
            const strength = Math.min(1.0, (5 - Math.max(0, cur)) / 5) * 1.45;
            out.x += (gx / gLen) * strength;
            out.z += (gz / gLen) * strength;
          }
        }
      }
    }catch(e){}

    // scale down to a "steering" amount (m/s)
    out.x *= 0.72;
    out.z *= 0.72;
    return out;
  }

  _botEye(bot){
    // Rough eye position
    return this._tmpA.set(bot.pos.x, 1.55, bot.pos.z);
  }

  _findVisibleEnemyBot(bot, cosFov, maxRange){
    let best = null;
    let bestD = 1e9;
    for(const other of this.bots){
      if(!other || !other.alive) continue;
      if(other === bot) continue;
      if(String(other.team).toLowerCase() === String(bot.team).toLowerCase()) continue;
      // If smoked/flashed/stunned, treat as harder to see
      const now = this._time;
      if(now < bot.smokeUntil) continue;
      const aim = this._tmpB.set(other.pos.x, 1.55, other.pos.z);
      // Range + FOV + LOS (reuse _hasLOS)
      const dx = aim.x - bot.pos.x;
      const dz = aim.z - bot.pos.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      const range = (Number(maxRange) > 0) ? Number(maxRange) : this.detectRange;
      if(dist > range) continue;
      const fwdX = Math.sin(bot.yaw);
      const fwdZ = Math.cos(bot.yaw);
      const inv = 1 / Math.max(1e-6, dist);
      const tx = dx * inv;
      const tz = dz * inv;
      const dot = fwdX * tx + fwdZ * tz;
      // Patch 9-4F: bots should fight each other more often.
      // - Very close range: 360° awareness (no FOV requirement)
      // - Hearing: if the enemy just fired, allow detection with looser FOV
      const close360 = Number(this.diff?.closeDetect360 ?? 7.5) || 7.5;
      const hearingRange = Number(this.diff?.hearingRange ?? 18) || 18;
      const justFired = (other.lastFiredAt && (now - other.lastFiredAt) < 0.22);
      const allowNoFov = dist <= close360;
      const allowHearing = justFired && (dist <= hearingRange) && (Math.random() < (Number(this.diff?.hearingDetectChance ?? 0.85) || 0.85));
      if(!allowNoFov){
        if(!allowHearing){
          if(dot < cosFov) continue;
        }else{
          const looser = Math.max(-1, Math.min(1, cosFov - 0.28));
          if(dot < looser) continue;
        }
      }
      if(!this._hasLOS(bot, aim, range)) continue;
      if(dist < bestD){
        bestD = dist;
        best = other;
      }
    }
    return best;
  }

  _canSeePlayer(bot, playerAimPos, cosFov, maxRange){
    // Range
    const dx = playerAimPos.x - bot.pos.x;
    const dz = playerAimPos.z - bot.pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const range = (Number(maxRange) > 0) ? Number(maxRange) : this.detectRange;
    if(dist > range) return false;

    // FOV (based on bot yaw)
    const fwdX = Math.sin(bot.yaw);
    const fwdZ = Math.cos(bot.yaw);
    const inv = 1 / Math.max(1e-6, dist);
    const tx = dx * inv;
    const tz = dz * inv;
    const dot = fwdX * tx + fwdZ * tz;
    if(dot < cosFov) return false;

    // LOS occlusion (raycast against collidables; ignore other bots)
    const from = this._botEye(bot);
    const to = this._tmpB.copy(playerAimPos);
    this._tmpDir.subVectors(to, from);
    const d = this._tmpDir.length();
    if(d < 1e-4) return true;
    this._tmpDir.multiplyScalar(1 / d);

    const objs = this.getCollidables?.() || [];
    this._ray.set(from, this._tmpDir);
    this._ray.far = d - this.losPadding;
    const hits = this._ray.intersectObjects(objs, true);
    if(!hits || hits.length === 0) return true;
    // If the first thing we hit is a bot part, ignore and retry quickly by scanning
    for(const h of hits){
      const o = h?.object;
      if(!o) continue;
      const n = String(o.name||'');
      if(n.startsWith('decal_')) continue;
      // Patch 9-4F: non-blocking props (e.g. corpse marker)
      if(o.userData?.ignoreLOS) continue;
      if(o.userData?.damageableId) continue; // damageables don't block LOS (bots/targets)
      // Ignore bot meshes even before they are registered as damageables
      let p = o;
      while(p){
        const pn = String(p.name||'');
        if(pn.startsWith('bot_')){ p = null; break; }
        p = p.parent;
      }
      if(p === null) continue;
      if(o.userData?.isBotNub) continue;
      // anything else blocks
      return false;
    }
    return true;
  }

  // Patch 8-4A: LOS-only check used for firing (prevents wall-through damage).
  _hasLOS(bot, targetPos, maxRange){
    if(!targetPos) return false;
    const from = this._botEye(bot);
    const to = this._tmpB.copy(targetPos);
    this._tmpDir.subVectors(to, from);
    const d = this._tmpDir.length();
    if(d < 1e-4) return true;
    const range = (Number(maxRange) > 0) ? Number(maxRange) : this.engageRange;
    if(d > range) return false;
    this._tmpDir.multiplyScalar(1 / d);

    const objs = this.getCollidables?.() || [];
    this._ray.set(from, this._tmpDir);
    this._ray.far = d - this.losPadding;
    const hits = this._ray.intersectObjects(objs, true);
    if(!hits || hits.length === 0) return true;
    for(const h of hits){
      const o = h?.object;
      if(!o) continue;
      const n = String(o.name||'');
      if(n.startsWith('decal_')) continue;
      // Patch 9-4F: non-blocking props (e.g. corpse marker)
      if(o.userData?.ignoreLOS) continue;
      if(o.userData?.damageableId) continue; // do not let bots/targets block LOS
      // ignore bot meshes
      let p = o;
      while(p){
        const pn = String(p.name||'');
        if(pn.startsWith('bot_')){ p = null; break; }
        p = p.parent;
      }
      if(p === null) continue;
      if(o.userData?.isBotNub) continue;
      return false;
    }
    return true;
  }

  _engage(bot, playerAimPos, dt, target={type:"player"}){
    // Face the player with smoothing (human-like)
    const dx = playerAimPos.x - bot.pos.x;
    const dz = playerAimPos.z - bot.pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);

    // Patch 9-4F: track recent combat contact so HOLD_ZONE doesn't AFK.
    bot.lastContactAt = this._time;

    if(dist > 1e-4){
      // Aim error increases with distance (and difficulty)
      const distT = Math.min(1, Math.max(0, (dist - 8) / 40)); // 0..1
      const aimMult = Number(this.diff?.aimErrMult ?? 1.0) || 1.0;
      const baseErrDeg = (1.2 + distT * 4.0) * aimMult; // ~1.2° .. 5.2° (scaled)
      bot.aimErrTimer -= dt;
      if(bot.aimErrTimer <= 0){
        bot.aimErrTimer = randRange(0.15, 0.25);
        const err = THREE.MathUtils.degToRad(baseErrDeg) * (1 + (Math.random()*0.35));
        bot.aimErrYaw = (Math.random()*2-1) * err;
      }

      const desiredYaw = Math.atan2(dx, dz) + bot.aimErrYaw;
      let dy = desiredYaw - bot.yaw;
      while(dy > Math.PI) dy -= Math.PI * 2;
      while(dy < -Math.PI) dy += Math.PI * 2;

      const turn = (bot.reactionLeft > 0 ? 4.0 : 5.0);
      bot.yaw += dy * Math.min(1, turn * dt);
      bot.mesh.rotation.y = bot.yaw;
    }

    // Optional tiny strafe if too close
    if(dist < this.shootMinRange){
      const side = (Math.random() < 0.5) ? -1 : 1;
      bot.pos.x += Math.cos(bot.yaw) * side * 0.35 * dt;
      bot.pos.z += -Math.sin(bot.yaw) * side * 0.35 * dt;
      try{ this.collisionWorld?.resolveCapsuleXZ?.(bot.pos, this.radius, this.halfHeight); }catch{}
      bot.mesh.position.copy(bot.pos);
      bot.mesh.position.y = 0;
    }

    // Reaction delays
    if(bot.reactionLeft > 0){
      bot.reactionLeft -= dt;
      return;
    }
    if(bot.firstShotLeft > 0){
      bot.firstShotLeft -= dt;
      return;
    }

    // Burst logic (difficulty-scaled): shoot N shots then pause
    if(bot.burstPause > 0){
      bot.burstPause -= dt;
      return;
    }
    if(bot.burstLeft <= 0){
      const bMin = Math.max(1, (Number(this.diff?.burstMin ?? 2) || 2)|0);
      const bMax = Math.max(bMin, (Number(this.diff?.burstMax ?? 4) || 4)|0);
      bot.burstLeft = bMin + ((Math.random() * (bMax - bMin + 1)) | 0);
    }

    // Fire cooldown
    if(bot.shootCooldown > 0) return;

    // Patch 8-4A: never apply damage through walls.
    // Require current LOS + within engage range at shot time.
    if(!this._hasLOS(bot, playerAimPos, this.engageRange)){
      bot.shootCooldown = randRange(0.12, 0.18);
      return;
    }

    // ---- Patch 9-3B: weapon switching (primary/secondary) using shared WEAPONS stats.
    const sel = this._selectBotWeapon(bot, dist);
    const weaponId = sel.weaponId;
    const w = sel.weapon;
    bot.currentWeaponId = weaponId;

    // Patch 9-4D: bot gunfire sound should be audible (also for bot-vs-bot fights)
    try{ window.soundSystem?.play?.(botWeaponSoundKey(weaponId, w)); }catch(e){}
    // Patch 9-4F: update "heard" signals for bot-vs-bot awareness.
    // We set this even if the shot misses so nearby bots can react.
    bot.lastFiredAt = this._time;
    bot.lastFiredWeaponId = weaponId;

    const dmg = Number(w?.damage ?? 22) || 22;
    const headMult = Number(w?.headshotMult ?? 1.5) || 1.5;
    const rpm = Number(w?.rpm ?? 420) || 420;
    const shotInterval = 60 / Math.max(120, rpm);

    // Human-ish accuracy model: uses weapon range as a soft falloff.
    const wRange = Number(w?.range ?? 120) || 120;
    const fallStart = Math.max(6, wRange * 0.10);
    const fallEnd   = Math.max(fallStart + 6, wRange * 0.22);
    const distU = Math.min(1, Math.max(0, (dist - fallStart) / (fallEnd - fallStart))); // 0..1
    const baseNear = (w?.fireMode === 'bolt' || w?.fireMode === 'semi') ? 0.62 : 0.56;
    const baseFar  = (w?.fireMode === 'bolt') ? 0.32 : 0.20;
    const hitMult = Number(this.diff?.hitChanceMult ?? 1.0) || 1.0;
    const focusMul = (bot.binoUntil && bot.binoUntil > this._time) ? 1.12 : 1.0;
    const hitChanceRaw = (1 - distU) * baseNear + distU * baseFar;
    const hitChance = Math.max(0.03, Math.min(0.96, hitChanceRaw * hitMult * focusMul));
    const willHit = (Math.random() < hitChance);

    if(willHit){
      const hsMult = (Number(this.diff?.headshotChanceMult ?? 1.0) || 1.0) * (focusMul > 1 ? 1.12 : 1.0);
      const hsBase = (dist < 10) ? 0.08 : (dist < 14 ? 0.04 : 0.015);
      const hsChance = Math.max(0.0, Math.min(0.22, hsBase * hsMult));
      const headshot = (Math.random() < hsChance);
      const amount = dmg * (headshot ? headMult : 1);
      if(target && target.type === 'bot'){
        try{
          const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
          if(ds && target.bot && target.bot.damageId){
            const res = ds.applyDamage(target.bot.damageId, amount, { weaponId, sourceTeam: bot.team, headshot });
            // Patch 9-3C: economy linkage (damage -> money, kill -> money)
            try{ bot.economy?.rewardDamage?.(amount, !!headshot); }catch(e){}
            if(res?.killed){ try{ bot.economy?.rewardKill?.(); }catch(e){} }
          }
        }catch(e){}
      }else{
        this.onShootPlayer({ amount, headshot, weaponId, sourceTeam: bot.team, sourceId: bot.id });
      }
    }

    bot.shootCooldown = shotInterval + randRange(0.02, 0.06);
    bot.burstLeft -= 1;
    if(bot.burstLeft <= 0){
      const pMin = Number(this.diff?.burstPauseMin ?? 0.20) || 0.20;
      const pMax = Number(this.diff?.burstPauseMax ?? 0.35) || 0.35;
      bot.burstPause = randRange(pMin, pMax);
    }
  }

  // Patch 9-3C+: combat movement (push/chase) for more "AI-like" fights
  _combatMove(bot, targetPos, dt, target={type:"player"}){
    try{
      if(!bot || !bot.alive) return;
      if(!targetPos) return;
      const type = String(target?.type || 'player');
      const ag = (type === 'bot')
        ? (Number(this.diff?.vsBotAggression ?? 1.35) || 1.35)
        : (Number(this.diff?.aggression ?? 1.0) || 1.0);
      // very low aggression: do not push
      if(ag <= 0.70) return;

      const dx = targetPos.x - bot.pos.x;
      const dz = targetPos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if(!(dist > 1e-4)) return;

      // Desired spacing
      const desired = Math.max(
        this.shootMinRange + 0.6,
        (type === 'bot' ? this.engageRange * 0.55 : this.engageRange * 0.62)
      );
      if(dist <= desired) return;

      // Player pushing only on higher difficulties (prevents "always rush")
      if(type === 'player'){
        if(ag < 1.12) return;
        // If we can't see the player right now, don't blindly full-send
        const canSeeNow = this._hasLOS(bot, targetPos, this.detectRange * 1.15);
        if(!canSeeNow){
          // Patch 9-4D.1: Nightmare bots will still pressure the last seen position
          // for a short time (feels "smarter" than instantly giving up).
          const isNightmare = (this.difficultyId === 'nightmare');
          const hasMemory = isNightmare && (bot.lastSeenType === 'player') && (bot.lastSeenLeft > 0.85);
          if(!hasMemory) return;
        }
      }

      // Patch 9-4D: combat movement should not feel sluggish vs player.
      // Bot uses full base speed; player-target chase remains slightly conservative.
      const speedMul = (type === 'bot' ? 1.00 : 0.80) * Math.min(1.55, ag);
      const sp = this.speed * speedMul;
      bot.pos.x += (dx / dist) * sp * dt;
      bot.pos.z += (dz / dist) * sp * dt;

      try{ this.collisionWorld?.resolveCapsuleXZ?.(bot.pos, this.radius, this.halfHeight); }catch{}
      if(bot.mesh){
        bot.mesh.position.copy(bot.pos);
        bot.mesh.position.y = 0;
      }
    }catch(e){}
  }

  // ---- Patch 9-3B: basic weapon selection brain
  _selectBotWeapon(bot, dist){
    const inv = bot?.profile?.inventory || {};
    const primaryId = inv.primary;
    const secondaryId = inv.secondary || 'pistol1';

    // Default preference by distance
    let weaponId = secondaryId;
    if(primaryId){
      // Sniper/DMR prefer primary much earlier
      const p = String(primaryId);
      const isLong = p.startsWith('sr') || p.startsWith('dmr');
      const usePrimaryDist = isLong ? 8.5 : 12.0;
      if(dist >= usePrimaryDist) weaponId = primaryId;
    }

    const weapon = WEAPONS[weaponId] || WEAPONS[secondaryId] || WEAPONS['pistol1'] || { id: weaponId, damage: 22, headshotMult: 1.5, rpm: 420, range: 120, fireMode:'semi' };
    return { weaponId, weapon };
  }

  applyAoEEffect({ type, pos, radius, duration, sourceTeam }){
    try{
      const src = String(sourceTeam || 'blue').toLowerCase();
      const r = Number(radius) || 0;
      const dur = Number(duration) || 0;
      if(!pos || !(r>0) || !(dur>0)) return;
      const until = this._time + dur;
      for(const b of this.bots){
        if(!b || !b.alive) continue;
        if(String(b.team).toLowerCase() === src) continue; // no team effects
        const d = b.pos.distanceTo(pos);
        if(d > r) continue;
        if(type === 'flash'){
          b.flashUntil = Math.max(b.flashUntil||0, until);
          // also briefly stop firing
          b.reactionLeft = Math.max(b.reactionLeft||0, 0.25);
        }else if(type === 'smoke'){
          b.smokeUntil = Math.max(b.smokeUntil||0, until);
        }else if(type === 'impact'){
          b.stunUntil = Math.max(b.stunUntil||0, until);
        }
      }
    }catch(e){}
  }

  // Patch 9-4D.1: Support landmine triggers (bot-only simplified mines)
  _tickBotMines(dt, playerPos, playerAimPos, playerTeam){
    try{
      if(!this._botMines || this._botMines.length === 0) return;
      const now = this._time;
      const mines = this._botMines;

      // Trim expired
      for(let i=mines.length-1;i>=0;i--){
        const m = mines[i];
        if(!m || (m.ttlAt && now >= m.ttlAt)) mines.splice(i,1);
      }
      if(mines.length === 0) return;

      const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);

      // Helper: detonate against a target
      const detonate = (m, hitType, targetBot=null)=>{
        const amount = 78; // fixed so it feels consistent
        try{ window.soundSystem?.play?.('fire_sg_heavy'); }catch(e){}
        try{ this.applyAoEEffect({ type:'impact', pos: m.pos.clone(), radius: 3.6, duration: 0.55, sourceTeam: m.team }); }catch(e){}

        if(hitType === 'player'){
          this.onShootPlayer({ amount, headshot:false, weaponId:'landmine', sourceTeam: m.team, sourceId: m.ownerId || 'mine' });
        }else if(hitType === 'bot' && targetBot && ds && targetBot.damageId){
          const res = ds.applyDamage(targetBot.damageId, amount, { weaponId:'landmine', sourceTeam: m.team, headshot:false });
          // award kill money to mine owner bot (best-effort)
          const owner = this.bots.find(b=>b && b.alive && b.id === m.ownerId) || this.bots.find(b=>b && b.alive && b.profile?.id === m.ownerId);
          if(owner){
            try{ owner.economy?.rewardDamage?.(amount, false); }catch(e){}
            if(res?.killed){ try{ owner.economy?.rewardKill?.(); }catch(e){} }
          }
        }
      };

      // Check triggers
      for(let i=mines.length-1;i>=0;i--){
        const m = mines[i];
        if(!m || !m.pos) continue;
        if(m.armedAt && now < m.armedAt) continue;

        // Player trigger
        if(playerPos && String(playerTeam).toLowerCase() !== String(m.team).toLowerCase()){
          const dx = playerPos.x - m.pos.x;
          const dz = playerPos.z - m.pos.z;
          if((dx*dx + dz*dz) <= (2.35*2.35)){
            detonate(m, 'player');
            mines.splice(i,1);
            continue;
          }
        }

        // Bot trigger
        for(const b of this.bots){
          if(!b || !b.alive) continue;
          if(String(b.team).toLowerCase() === String(m.team).toLowerCase()) continue;
          const dx = b.pos.x - m.pos.x;
          const dz = b.pos.z - m.pos.z;
          if((dx*dx + dz*dz) <= (2.25*2.25)){
            detonate(m, 'bot', b);
            mines.splice(i,1);
            break;
          }
        }
      }
    }catch(e){}
  }

  /**
   * Markers for minimap
   * @returns {{x:number,z:number,team:string,type:string}[]}
   */
  getMinimapMarkers(){
    return this.bots.filter(b => b && b.alive).map(b => ({ x: b.pos.x, z: b.pos.z, team: b.team, type: 'bot' }));
  }

  // ---------- Lifecycle helpers (Patch 8-4A2) ----------
  _clearDamageableTags(root){
    if(!root) return;
    const clear = (obj)=>{
      try{
        if(obj?.userData && obj.userData.damageableId) delete obj.userData.damageableId;
      }catch{}
    };
    clear(root);
    root.traverse?.((c)=> clear(c));
  }

  _onBotKilled(bot){
    if(!bot || !bot.alive) return;
    bot.alive = false;
    bot.state = 'DEAD';
    bot.respawnLeft = 5.0;


    // Patch 9-1: Zone tickets (only active in Zone mode)
    try{ window.modeSystem?.onDeath?.(bot.team); }catch(e){}

    // Unregister from damage system so it stops taking hits while "dead".
    try{
      const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
      if(ds && bot.damageId){
        ds.unregister?.(bot.damageId);
        // Also clear tags so WeaponSystem doesn't filter it out as a damageable wall.
        this._clearDamageableTags(bot.mesh);
      }
    }catch(e){}
    bot.damageId = null;

    // Visual: lie down (simple rotation), keep visible during most of timer (handled in update).
    if(bot.mesh){
      bot.mesh.visible = true;
      bot.mesh.rotation.z = Math.PI * 0.5;
      bot.mesh.rotation.x = 0;
      bot.mesh.rotation.y = bot.yaw || 0;
      bot.mesh.position.y = 0.18;
    }
  }

  _respawnBot(bot){
    // Reset state
    bot.alive = true;
    bot.hp = 100;
    bot.state = 'MOVE_TO_ZONE';
    bot.seenTime = 0;
    bot.losLostTime = 0;
    bot.detectNeed = randRange(this.diff?.detectNeedMin ?? 0.18, this.diff?.detectNeedMax ?? 0.35);
    bot.engageUntil = 0;
    bot.reactionLeft = 0;
    bot.firstShotLeft = 0;
    bot.burstLeft = 0;
    bot.burstPause = 0;
    bot.shootCooldown = randRange(0.15, 0.35);

    // Teleport to team spawn (or dynamic conquest spawn)
    const base = this._getSpawnPosForTeam(bot.team);
    bot.pos.set(
      (Number(base?.x ?? 0) || 0) + randRange(-1.0, 1.0),
      0,
      (Number(base?.z ?? 0) || 0) + randRange(-1.0, 1.0)
    );
    if(bot.mesh){
      bot.mesh.visible = true;
      bot.mesh.position.copy(bot.pos);
      bot.mesh.position.y = 0;
      bot.mesh.rotation.set(0, bot.yaw || 0, 0);
    }

    // Re-register in damage system
    try{
      const ds = this.damageSystem || (typeof window !== 'undefined' ? window.damageSystem : null);
      if(ds && typeof ds.register === 'function'){
        bot.damageId = ds.register(bot.mesh, {
          team: bot.team,
          maxHp: 100,
          height: 1.85,
          headshotYRatio: 0.80,
        });
      }
    }catch(e){}

    // Pick a fresh target
    this._retarget(bot, true);
  }
}