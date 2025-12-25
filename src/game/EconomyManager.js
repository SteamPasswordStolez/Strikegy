import { ECONOMY } from "../data/economy.js";

export class EconomyManager {
  constructor(playerProfile) {
    this.p = playerProfile;
    this._acc = 0;
    // Optional UI hook (Patch 9-4D): caller can subscribe to reward events.
    this.onReward = null;
  }

  initOnGameStart() {
    if (typeof this.p.money !== "number") this.p.money = 0;
    this.p.money = ECONOMY.START_MONEY;
  }

  tick(dtSec) {
    this._acc += dtSec;
    while (this._acc >= ECONOMY.PASSIVE_PAY_INTERVAL_SEC) {
      this._acc -= ECONOMY.PASSIVE_PAY_INTERVAL_SEC;
      this.addMoney(ECONOMY.PASSIVE_PAY, "passive");
    }
  }

  addMoney(amount, reason = "") {
    const before = Number(this.p.money ?? 0) || 0;
    const after = Math.min(before + (Number(amount)||0), ECONOMY.MAX_MONEY);
    this.p.money = after;
    const delta = after - before;
    if(delta !== 0 && typeof this.onReward === 'function'){
      try{ this.onReward({ amount: delta, reason }); }catch(e){}
    }
  }

  // --- Rewards (Patch 9-3C economy linkage)
  rewardKill() {
    this.addMoney(ECONOMY.REWARD_KILL, "kill");
  }

  rewardDamage(dmg, headshot = false) {
    const d = Math.max(0, Number(dmg) || 0);
    const mul = headshot ? (ECONOMY.REWARD_HEADSHOT_MULT || 2) : 1;
    const per = Number(ECONOMY.REWARD_PER_DAMAGE || 1);
    const money = Math.round(d * per * mul);
    if (money > 0) this.addMoney(money, headshot ? "damage_head" : "damage");
  }

  rewardZoneCapturing(dtSec, splitCount = 1) {
    const dt = Math.max(0, Number(dtSec) || 0);
    const n = Math.max(1, Number(splitCount) || 1);
    const total = (ECONOMY.REWARD_ZONE_CAPTURING_PER_SEC || 10) * dt;
    const each = Math.floor(total / n);
    if (each > 0) this.addMoney(each, "zone_tick");
  }

  rewardZoneCapture(splitCount = 1) {
    const n = Math.max(1, Number(splitCount) || 1);
    const each = Math.floor((ECONOMY.REWARD_ZONE_CAPTURE || 200) / n);
    if (each > 0) this.addMoney(each, "zone_capture");
  }

  spendMoney(amount) {
    if ((this.p.money ?? 0) < amount) return false;
    this.p.money -= amount;
    return true;
  }
}
