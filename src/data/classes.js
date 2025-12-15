// Patch 6-1a: Class & inventory definitions (static contract)

export const CLASS_KEY = "strikegy_selectedClass";

// Internal ids are stable and used across patches
export const CLASSES = {
  assault: { id: "assault", name: "경보병", icon: "🪖", classItems: ["panzerfaust", null] },
  medic:   { id: "medic",   name: "의무병", icon: "🩺", classItems: ["bandage", "launcher_grenade"] },
  support: { id: "support", name: "보급병", icon: "📦", classItems: ["ammo_pack", "landmine"] },
  sniper:  { id: "sniper",  name: "저격병", icon: "🎯", classItems: ["binocular", null] },
};

// User-facing icons (6-1: display only; behavior comes later patches)
export const ITEM_ICONS = {
  panzerfaust: "💥",
  bandage: "🩹",
  launcher_grenade: "🧨",
  ammo_pack: "📦",
  landmine: "💣",
  binocular: "🔭",
};

export function normalizeClassId(id){
  if(!id) return "assault";
  const key = String(id).toLowerCase();
  return CLASSES[key] ? key : "assault";
}

export function initInventoryForClass(classId){
  const cid = normalizeClassId(classId);
  const cls = CLASSES[cid];
  return {
    primary: null,
    secondary: "pistol1",
    grenades: [null, null, null],
    melee: null,
    classItems: [cls.classItems[0] ?? null, cls.classItems[1] ?? null],
  };
}
