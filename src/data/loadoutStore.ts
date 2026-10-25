import { CLASS_IDS, defaultLoadout, loadoutWeapons, sanitizeLoadout, type ClassId, type Loadout } from './classes';
import { attachOpen, isLocked } from '@/progression/access';
import { cleanSet, type AttachSet } from '@/weapons/attachments';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';

const KEY = 'strikegy.loadouts.v1';
/** Each weapon's attachments (a gun's build is the same in every class, Modern Warfare style). */
const BUILDS_KEY = 'strikegy.builds.v1';

interface Stored {
  cls: ClassId;
  byClass: Partial<Record<ClassId, Partial<Loadout>>>;
}

/**
 * The player's last class and the loadout kept for each class (BFV-style:
 * set once, changed only when wanted). Browser storage may be missing or
 * blocked; everything falls back to defaults.
 */
export class LoadoutStore {
  private cls: ClassId = 'assault';
  private readonly byClass = new Map<ClassId, Loadout>();
  private readonly builds = new Map<WeaponId, AttachSet>();

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(BUILDS_KEY) ?? '{}') as Record<string, unknown>;
      for (const [id, set] of Object.entries(raw)) {
        if (!(id in WEAPONS)) continue;
        const clean = cleanSet(WEAPONS[id as WeaponId], set);
        if (Object.keys(clean).length) this.builds.set(id as WeaponId, clean);
      }
    } catch {
      // No storage: nothing fitted.
    }
    try {
      const raw = localStorage.getItem(KEY);
      const s = raw ? (JSON.parse(raw) as Stored) : null;
      if (s && CLASS_IDS.includes(s.cls)) this.cls = s.cls;
      for (const c of CLASS_IDS) {
        const l = s?.byClass?.[c];
        if (l) this.byClass.set(c, sanitizeLoadout({ ...l, cls: c }));
      }
    } catch {
      // No storage: defaults.
    }
  }

  get current(): Loadout {
    return this.get(this.cls);
  }

  /**
   * The class's kit with its weapons' attachments; a weapon or attachment
   * still locked for this player (`ACCESS`) gives way to the default, the
   * choice is kept for later.
   */
  get(cls: ClassId): Loadout {
    let l = this.byClass.get(cls);
    if (!l) {
      l = defaultLoadout(cls);
      this.byClass.set(cls, l);
    }
    const attach: Partial<Record<WeaponId, AttachSet>> = {};
    for (const id of loadoutWeapons(l)) {
      const b = this.builds.get(id);
      if (b) attach[id] = b;
    }
    return sanitizeLoadout({ ...l, attach }, isLocked, attachOpen);
  }

  /** A weapon's attachments as chosen (locked ones included; `get` leaves those out). */
  build(id: WeaponId): AttachSet {
    return this.builds.get(id) ?? {};
  }

  setBuild(id: WeaponId, set: AttachSet): void {
    const clean = cleanSet(WEAPONS[id], set);
    if (Object.keys(clean).length) this.builds.set(id, clean);
    else this.builds.delete(id);
    try {
      localStorage.setItem(BUILDS_KEY, JSON.stringify(Object.fromEntries(this.builds)));
    } catch {
      // Not saved; this session still has it.
    }
  }

  setClass(cls: ClassId): void {
    this.cls = cls;
    this.save();
  }

  update(l: Loadout): void {
    // Attachments live per weapon (`setBuild`), not in the class's kit.
    const kit = sanitizeLoadout(l);
    delete kit.attach;
    this.byClass.set(l.cls, kit);
    this.save();
  }

  private save(): void {
    try {
      const s: Stored = { cls: this.cls, byClass: Object.fromEntries(this.byClass) };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Not saved; this session still has it.
    }
  }
}
