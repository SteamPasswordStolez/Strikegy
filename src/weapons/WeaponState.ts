import type { WeaponDef } from './weaponData';

/** Tolerance so accumulated float error never delays a shot by a whole step. */
const EPS = 1e-6;

export interface WeaponInput {
  trigger: boolean;
  reload: boolean;
}

export interface WeaponStepResult {
  /** Number of shots fired this step (each shot may have several pellets). */
  shots: number;
  reloadStarted: boolean;
  reloadFinished: boolean;
  /** Trigger pulled on an empty weapon with nothing to reload. */
  dryFire: boolean;
}

/**
 * Pure, render-independent weapon timing: fire rate, bursts, pump/bolt cycling,
 * magazine and per-shell reloads. Advanced by the fixed simulation step.
 */
export class WeaponState {
  ammo: number;
  reserve: number;
  /** Seconds until the next shot may fire. May go negative while the trigger is held so
   *  fire rate stays exact when the interval isn't a multiple of the sim step. */
  private cooldown = 0;
  private reloadTimer = 0;
  reloading = false;
  private burstLeft = 0;
  private triggerWasHeld = false;

  constructor(readonly def: WeaponDef) {
    this.ammo = def.magSize;
    this.reserve = def.reserve;
  }

  get shotInterval(): number {
    const base = 60 / this.def.rpm;
    return this.def.cycleMs ? Math.max(base, this.def.cycleMs / 1000) : base;
  }

  /** 0..1 progress of the current reload (per-shell: progress of the current insert). */
  get reloadProgress(): number {
    if (!this.reloading) return 0;
    const total =
      this.def.reloadStyle === 'perShell' ? (this.def.insertMs ?? 500) / 1000 : this.def.reloadTime;
    return 1 - Math.max(0, this.reloadTimer) / total;
  }

  canReload(): boolean {
    return !this.reloading && this.ammo < this.def.magSize && this.reserve > 0;
  }

  startReload(): boolean {
    if (!this.canReload()) return false;
    this.reloading = true;
    this.burstLeft = 0;
    this.reloadTimer =
      this.def.reloadStyle === 'perShell' ? (this.def.insertMs ?? 500) / 1000 : this.def.reloadTime;
    return true;
  }

  cancelReload(): void {
    this.reloading = false;
    this.reloadTimer = 0;
  }

  step(dt: number, input: WeaponInput): WeaponStepResult {
    const res: WeaponStepResult = { shots: 0, reloadStarted: false, reloadFinished: false, dryFire: false };
    const wasHeld = this.triggerWasHeld;
    const pressed = input.trigger && !wasHeld;
    this.triggerWasHeld = input.trigger;

    // Negative cooldown (time credit) only carries over during continuous fire;
    // otherwise the first shot after idling would get a free step of credit.
    if (wasHeld || this.burstLeft > 0) this.cooldown -= dt;
    else this.cooldown = Math.max(this.cooldown - dt, 0);

    if (this.reloading) {
      // Shell-by-shell reloads can be interrupted by firing if a round is chambered.
      if (this.def.reloadStyle === 'perShell' && pressed && this.ammo > 0) {
        this.cancelReload();
        res.reloadFinished = true;
      } else {
        this.stepReload(dt, res);
        if (this.reloading) return res;
      }
    }

    if (input.reload && this.startReload()) {
      res.reloadStarted = true;
      return res;
    }

    const interval = this.shotInterval;
    if (this.burstLeft > 0) {
      const burstInterval = (this.def.burst?.intervalMs ?? 80) / 1000;
      while (this.cooldown <= EPS && this.burstLeft > 0 && this.ammo > 0) {
        this.fireOne(res);
        this.burstLeft--;
        this.cooldown += this.burstLeft > 0 ? burstInterval : interval;
      }
      if (this.ammo === 0) this.burstLeft = 0;
    } else if (this.cooldown <= EPS) {
      if (this.ammo === 0) {
        if (pressed) {
          if (this.startReload()) res.reloadStarted = true;
          else res.dryFire = true;
        }
        return res;
      }
      switch (this.def.fireMode) {
        case 'auto':
          while (input.trigger && this.cooldown <= EPS && this.ammo > 0) {
            this.fireOne(res);
            this.cooldown += interval;
          }
          break;
        case 'burst':
          if (pressed) {
            this.burstLeft = this.def.burst?.count ?? 3;
            const burstInterval = (this.def.burst?.intervalMs ?? 80) / 1000;
            while (this.cooldown <= EPS && this.burstLeft > 0 && this.ammo > 0) {
              this.fireOne(res);
              this.burstLeft--;
              this.cooldown += this.burstLeft > 0 ? burstInterval : interval;
            }
          }
          break;
        case 'semi':
        case 'pump':
        case 'bolt':
          if (pressed) {
            this.fireOne(res);
            this.cooldown = Math.max(this.cooldown, 0) + interval;
          }
          break;
      }
    }
    return res;
  }

  private fireOne(res: WeaponStepResult): void {
    this.ammo--;
    res.shots++;
  }

  private stepReload(dt: number, res: WeaponStepResult): void {
    this.reloadTimer -= dt;
    if (this.def.reloadStyle === 'perShell') {
      const insert = (this.def.insertMs ?? 500) / 1000;
      while (this.reloadTimer <= 0 && this.reloading) {
        this.ammo++;
        this.reserve--;
        if (this.ammo >= this.def.magSize || this.reserve <= 0) {
          this.reloading = false;
          res.reloadFinished = true;
        } else {
          this.reloadTimer += insert;
        }
      }
    } else if (this.reloadTimer <= 0) {
      const take = Math.min(this.def.magSize - this.ammo, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
      res.reloadFinished = true;
    }
  }
}
