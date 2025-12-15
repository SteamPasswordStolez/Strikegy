import { ECONOMY } from "../data/economy.js";

export class EconomyManager {
  constructor(playerProfile) {
    this.p = playerProfile;
    this._acc = 0;
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

  addMoney(amount) {
    this.p.money = Math.min((this.p.money ?? 0) + amount, ECONOMY.MAX_MONEY);
  }

  spendMoney(amount) {
    if ((this.p.money ?? 0) < amount) return false;
    this.p.money -= amount;
    return true;
  }
}
