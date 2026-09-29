import { CLASS_IDS, defaultLoadout, sanitizeLoadout, type ClassId, type Loadout } from './classes';

const KEY = 'strikegy.loadouts.v1';

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

  constructor() {
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

  get(cls: ClassId): Loadout {
    let l = this.byClass.get(cls);
    if (!l) {
      l = defaultLoadout(cls);
      this.byClass.set(cls, l);
    }
    return l;
  }

  setClass(cls: ClassId): void {
    this.cls = cls;
    this.save();
  }

  update(l: Loadout): void {
    this.byClass.set(l.cls, sanitizeLoadout(l));
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
