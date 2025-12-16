// src/weapons/WeaponData.js
// Patch 7-1A checkpoint: weapon rhythm data (fire mode / RPM / mag / reserve / reload) finalized.
// NOTE: Patch 7-1A is **data-only**. WeaponSystem logic is unchanged in this checkpoint.

export const WEAPONS = {
  // ================= AR =================
  ar1:{ id:"ar1", name:"AR-1 Ranger",   fireMode:"auto",  rpm:780, range:250, magSize:30, reserve: 90, reloadTime:2.35, adsFov:62, hipFov:78,
        audio:{ preset:"AR_LIGHT" } },
  ar2:{ id:"ar2", name:"AR-2 Viper",    fireMode:"auto",  rpm:650, range:250, magSize:30, reserve: 90, reloadTime:2.60, adsFov:62, hipFov:78,
        audio:{ preset:"AR_HEAVY" } },
  ar3:{ id:"ar3", name:"AR-3 Sentinel", fireMode:"burst", rpm:780, range:250, magSize:30, reserve: 90, reloadTime:2.50, adsFov:62, hipFov:78,
        burst:{ count:3, intervalMs:80 },
        audio:{ preset:"AR_LIGHT" } },

  // ================= SMG =================
  smg1:{ id:"smg1", name:"SMG-1 Swift",   fireMode:"auto", rpm:980, range:180, magSize:30, reserve:120, reloadTime:2.00, adsFov:64, hipFov:78,
        audio:{ preset:"SMG_FAST" } },
  smg2:{ id:"smg2", name:"SMG-2 Wasp",    fireMode:"auto", rpm:900, range:180, magSize:30, reserve:120, reloadTime:2.10, adsFov:64, hipFov:78,
        audio:{ preset:"SMG_FAST" } },
  smg3:{ id:"smg3", name:"SMG-3 Phantom", fireMode:"auto", rpm:820, range:180, magSize:30, reserve:120, reloadTime:2.30, adsFov:64, hipFov:78,
        audio:{ preset:"SMG_FAST" } },
  smg4:{ id:"smg4", name:"SMG-4 Riot",    fireMode:"auto", rpm:760, range:180, magSize:30, reserve:120, reloadTime:2.45, adsFov:64, hipFov:78,
        audio:{ preset:"SMG_HEAVY" } },

  // ================= LMG =================
  lmg1:{ id:"lmg1", name:"LMG-1 Bulwark", fireMode:"auto", rpm:660, range:260, magSize:60, reserve:120, reloadTime:3.35, adsFov:60, hipFov:78,
        audio:{ preset:"LMG_LIGHT" } },
  lmg2:{ id:"lmg2", name:"LMG-2 Hammer",  fireMode:"auto", rpm:540, range:260, magSize:60, reserve:120, reloadTime:3.60, adsFov:60, hipFov:78,
        audio:{ preset:"LMG_HEAVY" } },

  // ================= SG =================
  // Patch 7-1A data: pump tempo will be enforced in Patch 7-1B engine.
  sg1:{ id:"sg1", name:"SG-1 Breaker", fireMode:"pump", rpm: 90, pumpMs:650, range: 90, magSize: 8, reserve:32, reloadTime:2.25, adsFov:70, hipFov:78,
        pellets:10, spreadDegHip:6.5, spreadDegAds:4.5,
        // Patch 7-3C: per-shell reload (one shell insert)
        reloadStyle:"perShell", insertMs:450,
        audio:{ preset:"SG_LIGHT", insert:"SG_INSERT", cycle:"PUMP" } },
  sg2:{ id:"sg2", name:"SG-2 Reaper",  fireMode:"pump", rpm: 80, pumpMs:720, range: 90, magSize: 8, reserve:32, reloadTime:2.25, adsFov:70, hipFov:78,
        pellets:8,  spreadDegHip:5.5, spreadDegAds:4.0,
        // Patch 7-3C: per-shell reload (one shell insert)
        reloadStyle:"perShell", insertMs:450,
        audio:{ preset:"SG_HEAVY", insert:"SG_INSERT", cycle:"PUMP" } },

  // ================= DMR =================
  dmr1:{ id:"dmr1", name:"DMR-1 Marksman",        fireMode:"semi", rpm:360, range:320, magSize:20, reserve:60, reloadTime:2.70, adsFov:58, hipFov:78,
        audio:{ preset:"DMR_LIGHT" } },
  dmr2:{ id:"dmr2", name:"DMR-2 Longshot (Scope)", fireMode:"semi", rpm:300, range:320, magSize:20, reserve:60, reloadTime:2.90, adsFov:45, hipFov:78, scope:"3x",
        audio:{ preset:"DMR_HEAVY" } },

  // ================= SR =================
  sr1:{ id:"sr1", name:"SR-1 Pioneer",  fireMode:"bolt", rpm:60, boltCycleMs: 900, range:520, magSize: 5, reserve:15, reloadTime:3.20, adsFov:28, hipFov:78, scope:"6x",
        // Patch 7-3C: per-round reload (one round insert)
        reloadStyle:"perShell", insertMs:720,
        audio:{ preset:"SR_LIGHT", insert:"SR_INSERT", cycle:"BOLT" } },
  sr2:{ id:"sr2", name:"SR-2 Valkyrie", fireMode:"bolt", rpm:50, boltCycleMs:1100, range:520, magSize: 5, reserve:15, reloadTime:3.60, adsFov:20, hipFov:78, scope:"8x",
        // Patch 7-3C: per-round reload (one round insert)
        reloadStyle:"perShell", insertMs:720,
        audio:{ preset:"SR_HEAVY", insert:"SR_INSERT", cycle:"BOLT" } },

  // ================= PISTOLS =================
  // Basic pistol (free)
  pistol1:{ id:"pistol1", name:"Base Pistol", fireMode:"semi", rpm:420, range:120, magSize:15, reserve:45, reloadTime:1.55, adsFov:68, hipFov:78,
          audio:{ preset:"PISTOL" } },

  // Shop pistols
  p2:{ id:"p2", name:"Pistol Standard+", fireMode:"semi", rpm:450, range:130, magSize:15, reserve:45, reloadTime:1.50, adsFov:66, hipFov:78,
      audio:{ preset:"PISTOL" } },
  p3:{ id:"p3", name:"Pistol Quickdraw", fireMode:"semi", rpm:480, range:130, magSize:15, reserve:45, reloadTime:1.45, adsFov:66, hipFov:78,
      audio:{ preset:"PISTOL" } },
  p4:{ id:"p4", name:"Pistol Heavy",     fireMode:"semi", rpm:320, range:130, magSize:12, reserve:36, reloadTime:1.75, adsFov:66, hipFov:78,
      audio:{ preset:"PISTOL" } },

  // Machine pistol
  mp1:{ id:"mp1", name:"Machine Pistol", fireMode:"auto", rpm:900, range:110, magSize:20, reserve:60, reloadTime:2.00, adsFov:66, hipFov:78,
      audio:{ preset:"MACHINE_PISTOL" } },
};
