export const ITEM_TYPES = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  GRENADE: "grenade",
  UTILITY: "utility",
};

export const PRIMARY_CATEGORIES = {
  AR: "AR",
  SMG: "SMG",
  LMG: "LMG",
  SHOTGUN: "SHOTGUN",
  SEMI: "SEMI",
  SEMI_SCOPE: "SEMI_SCOPE",
  SR: "SR",
};

// Patch 6-2: Class purchase restrictions (final)
export const CLASS_PRIMARY_ALLOW = {
  assault: ["AR","SMG","SHOTGUN"],
  medic:   ["SMG","SEMI"],
  support: ["LMG","SHOTGUN"],
  sniper:  ["SR","SEMI_SCOPE"],
};

// Patch 6-2: Full shop catalog (stats later in Patch 7)
export const SHOP = {
  primaries: [
    // AR (assault)
    { id:"AR1", name:"AR-1 Ranger",     icon:"🔫", type:"primary", category:"AR", price:800 },
    { id:"AR2", name:"AR-2 Viper",      icon:"🔫", type:"primary", category:"AR", price:1100 },
    { id:"AR3", name:"AR-3 Sentinel",   icon:"🔫", type:"primary", category:"AR", price:1500 },

    // SMG (assault/medic)
    { id:"SMG1", name:"SMG-1 Swift",    icon:"🔫", type:"primary", category:"SMG", price:800 },
    { id:"SMG2", name:"SMG-2 Wasp",     icon:"🔫", type:"primary", category:"SMG", price:1100 },
    { id:"SMG3", name:"SMG-3 Phantom",  icon:"🔫", type:"primary", category:"SMG", price:1100 },
    { id:"SMG4", name:"SMG-4 Riot",     icon:"🔫", type:"primary", category:"SMG", price:1500 },

    // LMG (support)
    { id:"LMG1", name:"LMG-1 Bulwark",  icon:"🧯", type:"primary", category:"LMG", price:1100 },
    { id:"LMG2", name:"LMG-2 Hammer",   icon:"🧯", type:"primary", category:"LMG", price:1500 },

    // Shotgun (assault/support)
    { id:"SG1", name:"SG-1 Breaker",    icon:"💥", type:"primary", category:"SHOTGUN", price:800 },
    { id:"SG2", name:"SG-2 Reaper",     icon:"💥", type:"primary", category:"SHOTGUN", price:1500 },

    // Semi-auto (medic / sniper(scope))
    { id:"DMR1", name:"DMR-1 Marksman", icon:"🎯", type:"primary", category:"SEMI", price:1100 },
    { id:"DMR2", name:"DMR-2 Longshot (Scope)", icon:"🔭", type:"primary", category:"SEMI_SCOPE", price:1500 },

    // Sniper rifles (sniper)
    { id:"SR1", name:"SR-1 Pioneer",    icon:"🎯", type:"primary", category:"SR", price:1500 },
    { id:"SR2", name:"SR-2 Valkyrie",   icon:"🎯", type:"primary", category:"SR", price:1900 },
  ],

  secondaries: [
    // basic pistol is free and not in shop
    { id:"P2", name:"Pistol Standard+", icon:"🔫", type:"secondary", price:300 },
    { id:"P3", name:"Pistol Quickdraw", icon:"⚡", type:"secondary", price:300 },
    { id:"P4", name:"Pistol Heavy",     icon:"💢", type:"secondary", price:500 },
    { id:"MP1",name:"Machine Pistol",   icon:"🔁", type:"secondary", price:500 },
  ],

  grenades: [
    { id:"frag",   name:"💥 Frag",  price:300, type:"grenade", icon:"💥" },
    { id:"flash",  name:"✨ Flash", price:250, type:"grenade", icon:"✨" },
    { id:"smoke",  name:"💨 Smoke", price:200, type:"grenade", icon:"💨" },
    { id:"impact", name:"⚡ Impact",price:350, type:"grenade", icon:"⚡" },
  ],

  utility: [
    { id:"ammo_primary",   name:"주무기 탄약 보충", price:350, type:"utility", icon:"🔫" },
    { id:"ammo_secondary", name:"보조무기 탄약 보충", price:200, type:"utility", icon:"🔫" },
  ]
};
