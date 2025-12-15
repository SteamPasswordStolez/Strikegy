export class LoadoutManager {
  constructor(playerProfile) {
    this.p = playerProfile;
  }

  applySpawnLoadout() {
    if (!this.p.inventory) return;
    // Patch 6-2a: start with pistol only
    this.p.inventory.primary = null;
    this.p.inventory.secondary = "pistol1"; // basic pistol occupies secondary slot
    this.p.inventory.grenades = [null, null, null];
    this.p.activeSlot = { type:"secondary", index:0 };
    this.resetClassItemState();
  }

  applyDeathPenalty() {
    // same as spawn loadout (weapons + grenades lost), class items kept but state reset
    this.applySpawnLoadout();
  }

  resetClassItemState() {
    // Patch 6-2a: placeholder (ammo/charges reset will be implemented when class items get behavior)
    // You may later store class-item state in p.classItemState
    this.p.classItemState = this.p.classItemState || {};
    this.p.classItemState.__resetAt = Date.now();
  }
}
