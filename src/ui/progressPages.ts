/**
 * The progression's menu pages (steps 5-6; progression-data.md P), laid out
 * like a game's own store and locker (owner, 2026-10-25: the first pass was
 * too crowded and didn't feel like a game shop):
 * - 상점: 추천 (the week's bundle large, today's deal, two featured pieces,
 *   then the week's shelf), 보급 상자, 보급창 (everything else, by kind), 교환소,
 *   부스터. A click on anything opens it large with what it does and its price.
 * - 무기고: each gun (its level, camo challenges, and camo / skin / charm /
 *   kill effect to wear), vehicle skins by family, identity, the collection.
 * - 진급: the rank (insignia, the way to the next promotion, every rank on a
 *   ladder, the level reward track) and the missions with attendance.
 * Mail opens as a dialog from the main menu. Everything goes through
 * `shopAction` (the server for an account, this browser for a guest).
 */
import { t, type MessageKey } from '@/i18n';
import { uiSound } from '@/audio/uiSounds';
import { settledProfile, shopAction } from '@/net/account';
import { RANKS, levelOf, nextRank, rankAt, xpForLevel, type Rank } from '@/progression/levels';
import { weaponLevelOf } from '@/progression/unlocks';
import { BUNDLES, BUNDLE_SHARE, CRAFT_PARTS, ITEMS, PRICE, RARITIES, SERIES, VEHICLE_CLASSES, item, levelRewards, seriesItems, weeklyPool, type Item, type ItemKind, type Rarity, type VehicleClass } from '@/progression/catalog';
import { CAMO_TIERS, SPECIAL, camoLookOf, camoNameOf, tierTarget } from '@/progression/camo';
import { MISSION, missionDef } from '@/progression/missions';
import {
  BOOSTERS,
  DEAL_SHARE,
  ECON,
  SALARY,
  WEAPON_CLASSES,
  camoChoices,
  dailyDeal,
  depotOffer,
  econOf,
  weeklyOffer,
  type BoostItem,
  type BoostKind,
  type BoxResult,
  type EquipSlot,
  type Offer,
  type ShopOp,
} from '@/progression/economy';
import { nextDayAt, nextWeekAt } from '@/progression/calendar';
import type { Profile } from '@/progression/profile';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { cardCanvas, camoSwatch, emblemSvg, itemPicture, nameOf, vehicleSkinSvg } from './cosmetics';
import { insigniaAt, insigniaSvg, rankLabel, rankName, rankTitle } from './rankInsignia';
import { weaponPortrait, weaponPortraitNow } from './weaponPortraits';
import { icon, type IconName } from './icons';
import './progressPages.css';

export interface PageOptions {
  /** Draw the page again (after an action). */
  redraw: () => void;
  /** Where dialogs go. */
  root: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const n = (v: number) => Math.round(v).toLocaleString();
const tab: Record<string, string> = {};

const PAGE_TABS = {
  shop: ['featured', 'boxes', 'depot', 'exchange', 'boosters'],
  armory: ['weapons', 'vehicles', 'identity', 'storage'],
  ranks: ['rank', 'missions'],
} as const;
const TAB_ICON: Record<string, IconName> = {
  featured: 'star',
  boxes: 'ammo',
  depot: 'base',
  exchange: 'refresh',
  boosters: 'up',
  weapons: 'target',
  vehicles: 'tank',
  identity: 'user',
  storage: 'trophy',
  rank: 'star',
  missions: 'check',
};

function tabs(parent: HTMLElement, page: keyof typeof PAGE_TABS, o: PageOptions): string {
  const list: readonly string[] = PAGE_TABS[page];
  const cur = tab[page] && list.includes(tab[page]!) ? tab[page]! : list[0]!;
  const bar = el('div', 'pp-tabs', parent);
  for (const id of list) {
    const b = el('button', `pp-tab${id === cur ? ' sel' : ''}`, bar);
    b.innerHTML = icon(TAB_ICON[id] ?? 'star');
    el('span', '', b, t(`pp.${page}.${id}` as MessageKey));
    b.addEventListener('pointerenter', () => uiSound('hover'));
    b.addEventListener('click', () => {
      if (id === cur) return;
      uiSound('move');
      tab[page] = id;
      o.redraw();
    });
  }
  return cur;
}

/** Steps the page's tabs (Q / E). */
export function stepTab(page: 'shop' | 'armory' | 'ranks', d: number): void {
  const list: readonly string[] = PAGE_TABS[page];
  const i = Math.max(0, list.indexOf(tab[page] ?? list[0]!));
  tab[page] = list[(i + d + list.length) % list.length]!;
}

/** The wallet: supply tickets, parts, boxes. */
function wallet(parent: HTMLElement, p: Profile): void {
  const e = econOf(p);
  const w = el('div', 'pp-wallet', parent);
  const chip = (ic: IconName, label: string, v: number, cls: string) => {
    const c = el('span', `pp-chip ${cls}`, w);
    c.innerHTML = icon(ic);
    el('span', 'ds-num', c, n(v));
    c.title = label;
  };
  chip('star', t('pp.tickets'), e.tickets, 'tickets');
  chip('settings', t('pp.parts'), e.parts, 'parts');
  chip('ammo', t('pp.boxes'), e.boxes, 'boxes');
}

async function act(o: PageOptions, op: ShopOp, ok?: (result: unknown) => void): Promise<boolean> {
  const r = await shopAction(op);
  if (r.error) {
    uiSound('error');
    toast(o.root, t(`pp.err.${r.error}` as MessageKey) || r.error);
  } else {
    uiSound('select');
    ok?.(r.result);
  }
  o.redraw();
  return !r.error;
}

function toast(root: HTMLElement, text: string): void {
  const d = el('div', 'ds-toast pp-toast', root, text);
  setTimeout(() => d.remove(), 3500);
}

const until = (at: number) => {
  const s = Math.max(0, Math.round((at - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h >= 24 ? t('pp.daysHours').replace('{d}', String(Math.floor(h / 24))).replace('{h}', String(h % 24)) : t('pp.hoursMin').replace('{h}', String(h)).replace('{m}', String(m));
};

const duration = (sec: number) => {
  const h = sec / 3600;
  return h >= 1 ? t('pp.aboutHours').replace('{n}', h >= 10 ? String(Math.round(h)) : h.toFixed(1)) : t('pp.aboutMin').replace('{n}', String(Math.max(1, Math.round(sec / 60))));
};

function rarityBadge(parent: HTMLElement, r: Rarity): void {
  el('span', `pp-rar r-${r}`, parent, t(`pp.rarity.${r}` as MessageKey));
}

/** What kind of thing an item is, with its gun or vehicle family. */
function kindLine(it: Item): string {
  const k = t(`pp.kind.${it.kind}` as MessageKey);
  if (it.kind === 'skin' && it.weapon) return `${k} · ${WEAPONS[it.weapon as WeaponId]?.name ?? it.weapon}`;
  if (it.kind === 'vskin' && it.vclass) return `${k} · ${t(`pp.vclass.${it.vclass}` as MessageKey)}`;
  return k;
}

/** A store card: a tall picture on a rarity-lit backdrop, name, kind, and a price or state along the bottom. */
function storeCard(parent: HTMLElement, it: Item, opts: { owned: boolean; price?: number; old?: number; size?: 'big' | 'mid'; tag?: string; onClick: () => void }): HTMLElement {
  const c = el('button', `pp-card r-${it.rarity}${opts.owned ? ' owned' : ''}${opts.size ? ` ${opts.size}` : ''}`, parent);
  const pic = el('div', 'pp-card-pic', c);
  itemPicture(pic, it, opts.size === 'big' ? 110 : opts.size === 'mid' ? 70 : 54);
  if (opts.tag) el('span', 'pp-card-tag', c, opts.tag);
  const info = el('div', 'pp-card-info', c);
  el('div', 'pp-card-name', info, nameOf(it.name));
  const meta = el('div', 'pp-card-meta', info);
  rarityBadge(meta, it.rarity);
  el('span', 'pp-card-kind', meta, kindLine(it));
  const foot = el('div', 'pp-card-foot', c);
  if (opts.owned) {
    foot.innerHTML = icon('check');
    el('span', '', foot, t('pp.owned'));
  } else if (opts.price !== undefined) {
    if (opts.old) el('s', 'pp-old', foot, n(opts.old));
    foot.insertAdjacentHTML('beforeend', icon('star'));
    el('span', 'ds-num', foot, n(opts.price));
  }
  c.addEventListener('pointerenter', () => uiSound('hover'));
  c.addEventListener('click', () => {
    uiSound('open');
    opts.onClick();
  });
  return c;
}

/** One sentence on what an item does. */
function describe(it: Item): string {
  if (it.kind === 'vskin') return t('pp.desc.vskin').replace('{cls}', t(`pp.vclass.${it.vclass ?? 'armor'}` as MessageKey));
  return t(`pp.desc.${it.kind}` as MessageKey);
}

/** The slot an item is worn in, and on what (a weapon id, a vehicle family, '*'). */
function slotOf(it: Item): { slot: EquipSlot; on?: string } | null {
  if (it.kind === 'skin') return { slot: 'skin', on: it.weapon };
  if (it.kind === 'vskin') return { slot: 'vskin', on: it.vclass };
  if (it.kind === 'kfx') return { slot: 'kfx', on: '*' };
  if (it.kind === 'card' || it.kind === 'emblem' || it.kind === 'plate') return { slot: it.kind };
  return null;
}

/**
 * An item large: its picture, rarity, kind, what it does, and buying it (or
 * wearing it once owned). `offer`: how it is sold here (none: shown only).
 */
function openItem(o: PageOptions, it: Item, offer?: Offer, craftParts?: number): void {
  const shade = el('div', 'dlg-shade ds-root pp-detail-shade', o.root);
  shade.dataset.dsTheme = 'bfv';
  const box = el('div', `pp-detail r-${it.rarity}`, shade);
  const close = escToClose(shade, () => shade.remove());
  const x = el('button', 'pp-detail-x', box);
  x.innerHTML = icon('close');
  x.addEventListener('click', close);
  shade.addEventListener('click', (ev) => ev.target === shade && close());
  const pic = el('div', 'pp-detail-pic', box);
  itemPicture(pic, it, 150);
  const side = el('div', 'pp-detail-side', box);
  rarityBadge(side, it.rarity);
  el('h2', 'pp-detail-name', side, nameOf(it.name));
  el('div', 'pp-detail-kind', side, kindLine(it));
  el('p', 'pp-detail-desc', side, describe(it));
  const p = settledProfile();
  const e = econOf(p);
  const owned = !!e.items[it.id];
  const btns = el('div', 'pp-detail-btns', side);
  if (!owned && offer) {
    if (offer.deal) el('div', 'pp-detail-note', side, t('pp.dealNote').replace('{p}', String(Math.round((1 - DEAL_SHARE) * 100))));
    const buy = el('button', 'ds-btn primary pp-detail-buy', btns);
    buy.innerHTML = icon('star');
    el('span', '', buy, `${n(offer.price)} · ${t('pp.buy')}`);
    buy.disabled = e.tickets < offer.price;
    buy.addEventListener('click', () => {
      close();
      confirmBuy(o, { title: nameOf(it.name), sub: kindLine(it), pic: (pp) => itemPicture(pp, it, 70), price: offer.price }, { op: 'buy', key: offer.key }, () => openItem(o, it));
    });
    if (e.tickets < offer.price) el('div', 'pp-detail-note warn', side, t('pp.needMore').replace('{n}', n(offer.price - e.tickets)));
  } else if (!owned && craftParts !== undefined) {
    const mk = el('button', 'ds-btn primary pp-detail-buy', btns);
    mk.innerHTML = icon('settings');
    el('span', '', mk, `${n(craftParts)} · ${t('pp.craft')}`);
    mk.addEventListener('click', () => {
      close();
      confirmBuy(o, { title: nameOf(it.name), sub: kindLine(it), pic: (pp) => itemPicture(pp, it, 70), price: craftParts, parts: true }, { op: 'craft', item: it.id }, () => openItem(o, it));
    });
  } else if (owned) {
    const s = slotOf(it);
    if (s) {
      const worn = s.slot === 'card' || s.slot === 'emblem' || s.slot === 'plate' ? e.equip[s.slot] === it.id : e.equip[s.slot][s.on!] === it.id;
      const b = el('button', `ds-btn${worn ? '' : ' primary'}`, btns, worn ? t('pp.equipped') : t('pp.equipNow'));
      b.disabled = worn;
      b.addEventListener('click', () => void act(o, { op: 'equip', slot: s.slot, value: it.id, weapon: s.on }).then(() => close()));
    } else el('div', 'pp-detail-note', side, t('pp.wearInArmory'));
  } else el('div', 'pp-detail-note', side, howToGet(it));
  const shut = el('button', 'ds-btn ghost', btns, t('pp.close'));
  shut.addEventListener('click', close);
}

/**
 * Buying asks first (owner, 2026-10-25: a click never spends on its own): what it is, the price, the
 * wallet before and after, then confirm or cancel.
 */
function confirmBuy(o: PageOptions, what: { title: string; sub?: string; pic?: (parent: HTMLElement) => void; price: number; parts?: boolean }, op: ShopOp, after?: (result: unknown) => void): void {
  const shade = el('div', 'dlg-shade ds-root pp-detail-shade', o.root);
  shade.dataset.dsTheme = 'bfv';
  const box = el('div', 'pp-confirm', shade);
  const close = escToClose(shade, () => shade.remove());
  shade.addEventListener('click', (ev) => ev.target === shade && close());
  el('div', 'pp-confirm-title', box, t('pp.confirmTitle'));
  if (what.pic) what.pic(el('div', 'pp-confirm-pic', box));
  el('div', 'pp-confirm-name', box, what.title);
  if (what.sub) el('div', 'pp-confirm-sub', box, what.sub);
  const e = econOf(settledProfile());
  const have = what.parts ? e.parts : e.tickets;
  const sums = el('div', 'pp-confirm-sums', box);
  const row = (label: string, v: string, cls = '') => {
    const r = el('div', `pp-confirm-row ${cls}`, sums);
    el('span', '', r, label);
    const val = el('span', 'ds-num', r);
    val.innerHTML = icon(what.parts ? 'settings' : 'star');
    el('span', '', val, v);
  };
  row(t('pp.confirmHave'), n(have));
  row(t('pp.confirmPrice'), `−${n(what.price)}`, 'price');
  row(t('pp.confirmAfter'), n(have - what.price), have < what.price ? 'short' : 'after');
  const btns = el('div', 'pp-confirm-btns', box);
  const no = el('button', 'ds-btn ghost', btns, t('pp.cancel'));
  no.addEventListener('click', close);
  const yes = el('button', 'ds-btn primary', btns, have < what.price ? t('pp.err.funds') : t('pp.confirmBuy'));
  yes.disabled = have < what.price;
  yes.addEventListener('click', () => {
    close();
    void act(o, op, after);
  });
  setTimeout(() => (yes.disabled ? no : yes).focus(), 0);
}

/** Esc closes a dialog (before the page under it sees the key); returns the close. */
function escToClose(shade: HTMLElement, done: () => void): () => void {
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    close();
  };
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    if (shade.isConnected) {
      uiSound('back');
      done();
    }
  };
  window.addEventListener('keydown', onKey, true);
  return close;
}

// ---------------------------------------------------------------------------
// 상점

let depotKind: ItemKind | 'all' = 'all';
let depotShown = 48;

export function renderShop(body: HTMLElement, o: PageOptions): void {
  const p = settledProfile();
  body.classList.add('pp', 'pp-shop');
  const head = el('div', 'pp-head', body);
  const cur = tabs(head, 'shop', o);
  wallet(head, p);
  const main = el('div', 'pp-main', body);
  if (cur === 'featured') renderFeatured(main, p, o);
  else if (cur === 'depot') renderDepot(main, p, o);
  else if (cur === 'boxes') renderBoxes(main, p, o);
  else if (cur === 'exchange') renderExchange(main, p, o);
  else renderBoosters(main, p, o);
}

function renderFeatured(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const now = Date.now();
  const offers = weeklyOffer(now);
  const bundle = offers.find((x) => x.bundle);
  const featured = offers.filter((x) => x.featured);
  const rest = offers.filter((x) => !x.bundle && !x.featured);
  const deal = dailyDeal(now);
  const hero = el('div', 'pp-hero', main);
  // The week's bundle: large, its pieces side by side, the saving and the clock.
  if (bundle) {
    const its = bundle.items.map((id) => item(id)!).filter(Boolean);
    const owned = its.every((it) => e.items[it.id]);
    const top = its.reduce((a, b) => (RARITIES.indexOf(b.rarity) > RARITIES.indexOf(a.rarity) ? b : a));
    const c = el('div', `pp-bundle r-${top.rarity}${owned ? ' owned' : ''}`, hero);
    const tagRow = el('div', 'pp-bundle-tags', c);
    el('span', 'pp-tag', tagRow, t('pp.bundleOff').replace('{p}', String(Math.round((1 - BUNDLE_SHARE) * 100))));
    el('span', 'pp-tag ghost', tagRow, t('pp.weekEnds').replace('{t}', until(nextWeekAt(now))));
    el('h2', 'pp-bundle-name', c, nameOf(BUNDLES.find((b) => b.id === bundle.bundle)?.name));
    const pics = el('div', 'pp-bundle-pics', c);
    for (const it of its) {
      const one = el('button', `pp-bundle-item r-${it.rarity}`, pics);
      itemPicture(one, it, 64);
      el('span', '', one, nameOf(it.name));
      one.addEventListener('click', () => openItem(o, it));
    }
    const foot = el('div', 'pp-bundle-foot', c);
    const full = its.reduce((a, it) => a + PRICE[it.rarity], 0);
    if (owned) el('span', 'pp-owned-line', foot, t('pp.owned'));
    else {
      el('s', 'pp-old', foot, n(full));
      const b = el('button', 'ds-btn primary pp-bundle-buy', foot);
      b.innerHTML = icon('star');
      el('span', '', b, n(bundle.price));
      b.addEventListener('click', () =>
        confirmBuy(
          o,
          { title: nameOf(BUNDLES.find((x) => x.id === bundle.bundle)?.name), sub: its.map((it) => nameOf(it.name)).join(' · '), pic: (pp) => its.forEach((it) => itemPicture(pp, it, 44)), price: bundle.price },
          { op: 'buy', key: bundle.key },
        ),
      );
    }
  }
  const col = el('div', 'pp-hero-col', hero);
  // Today's deal.
  const dit = item(deal.items[0]!)!;
  const dc = storeCard(col, dit, { owned: !!e.items[dit.id], price: deal.price, old: PRICE[dit.rarity], size: 'mid', tag: `${t('pp.deal')} · ${until(nextDayAt(now))}`, onClick: () => openItem(o, dit, deal) });
  dc.classList.add('deal');
  for (const f of featured) {
    const it = item(f.items[0]!)!;
    storeCard(col, it, { owned: !!e.items[it.id], price: f.price, size: 'mid', tag: t('pp.featured'), onClick: () => openItem(o, it, f) });
  }
  el('div', 'pp-sec', main, t('pp.weekShelf').replace('{t}', until(nextWeekAt(now))));
  const grid = el('div', 'pp-shelf', main);
  for (const f of rest) {
    const it = item(f.items[0]!)!;
    storeCard(grid, it, { owned: !!e.items[it.id], price: f.price, onClick: () => openItem(o, it, f) });
  }
  el('div', 'pp-note', main, t('pp.poolNote').replace('{n}', n(weeklyPool().length)));
}

const DEPOT_KINDS: (ItemKind | 'all')[] = ['all', 'skin', 'camo', 'charm', 'vskin', 'kfx', 'card', 'emblem', 'plate'];

function renderDepot(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  el('div', 'pp-note top', main, t('pp.depotNote'));
  const chips = el('div', 'pp-filter', main);
  const list = depotOffer(Date.now());
  for (const k of DEPOT_KINDS) {
    const count = k === 'all' ? list.length : list.filter((x) => item(x.items[0]!)?.kind === k).length;
    const b = el('button', `pp-fchip${depotKind === k ? ' sel' : ''}`, chips, `${k === 'all' ? t('pp.all') : t(`pp.kind.${k}` as MessageKey)} ${count}`);
    b.addEventListener('click', () => {
      depotKind = k;
      depotShown = 48;
      uiSound('move');
      o.redraw();
    });
  }
  const shown = list.filter((x) => depotKind === 'all' || item(x.items[0]!)?.kind === depotKind);
  // Not owned first, then by rarity (rarest first).
  shown.sort((a, b) => Number(!!e.items[a.items[0]!]) - Number(!!e.items[b.items[0]!]) || RARITIES.indexOf(item(b.items[0]!)!.rarity) - RARITIES.indexOf(item(a.items[0]!)!.rarity));
  const grid = el('div', 'pp-shelf', main);
  for (const f of shown.slice(0, depotShown)) {
    const it = item(f.items[0]!)!;
    storeCard(grid, it, { owned: !!e.items[it.id], price: f.price, onClick: () => openItem(o, it, f) });
  }
  if (shown.length > depotShown) {
    const more = el('button', 'ds-btn pp-more', main, `${t('pp.more')} (${shown.length - depotShown})`);
    more.addEventListener('click', () => {
      depotShown += 48;
      o.redraw();
    });
  }
}

function renderBoosters(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  el('div', 'pp-note top', main, t('pp.boostersNote'));
  const boosts = el('div', 'pp-boosts', main);
  const ICON: Record<BoostKind, IconName> = { xp: 'up', weapon: 'target', tickets: 'star' };
  for (const kind of Object.keys(BOOSTERS) as BoostKind[]) {
    const b = el('div', `pp-boost k-${kind}`, boosts);
    const top = el('div', 'pp-boost-top', b);
    top.innerHTML = icon(ICON[kind]);
    el('div', 'pp-boost-name', top, t(`pp.boost.${kind}` as MessageKey));
    const left = e.boosters.left[kind] ?? 0;
    el('div', `pp-boost-state${left > 0 ? ' on' : ''}`, b, left > 0 ? t('pp.boostLeft').replace('{m}', String(Math.ceil(left / 60))) : t('pp.boostOff'));
    for (const [min, price] of Object.entries(BOOSTERS[kind].price)) {
      const id = `${kind}${min}` as BoostItem;
      const owned = e.boosters.owned[id] ?? 0;
      const row = el('div', 'pp-boost-row', b);
      el('span', 'pp-boost-min', row, t('pp.minutes').replace('{n}', min));
      if (owned) {
        const use = el('button', 'ds-btn primary', row, `${t('pp.activate')} (${owned})`);
        use.addEventListener('click', () => void act(o, { op: 'activate', item: id }));
      }
      const buy = el('button', 'ds-btn', row);
      buy.innerHTML = icon('star');
      el('span', '', buy, n(price!));
      buy.addEventListener('click', () => confirmBuy(o, { title: `${t(`pp.boost.${kind}` as MessageKey)} · ${t('pp.minutes').replace('{n}', min)}`, sub: t('pp.boostersNote'), price: price! }, { op: 'booster', item: id }));
    }
  }
}

function renderBoxes(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const top = el('div', 'pp-boxtop', main);
  const box = el('div', 'pp-crate-wrap', top);
  const crate = el('div', 'pp-crate', box);
  el('span', 'pp-crate-lid', crate);
  el('span', 'pp-crate-label', crate, nameOf(SERIES.name));
  el('span', 'pp-crate-count', crate, `×${e.boxes}`);
  const btns = el('div', 'pp-box-btns', box);
  const open = el('button', 'ds-btn primary pp-open', btns, t('pp.open'));
  open.disabled = e.boxes < 1;
  open.addEventListener('click', () => void act(o, { op: 'open' }, (r) => showBox(o.root, r as BoxResult)));
  const b1 = el('button', 'ds-btn', btns);
  b1.innerHTML = icon('star');
  el('span', '', b1, `${t('pp.buyBox')} · ${n(ECON.boxPrice)}`);
  b1.addEventListener('click', () => confirmBuy(o, { title: `${nameOf(SERIES.name)} ×1`, sub: t('pp.boxes'), price: ECON.boxPrice }, { op: 'box', count: 1 }));
  const b10 = el('button', 'ds-btn', btns);
  b10.innerHTML = icon('star');
  el('span', '', b10, `${t('pp.buyBox10')} · ${n(ECON.boxPrice * 10)}`);
  b10.addEventListener('click', () => confirmBuy(o, { title: `${nameOf(SERIES.name)} ×10`, sub: t('pp.boxes'), price: ECON.boxPrice * 10 }, { op: 'box', count: 10 }));
  const info = el('div', 'pp-odds', top);
  el('div', 'pp-odds-title', info, t('pp.odds'));
  for (const r of RARITIES) {
    const row = el('div', `pp-odds-row r-${r}`, info);
    rarityBadge(row, r);
    const bar = el('span', 'pp-odds-bar', row);
    el('i', '', bar).style.width = `${Math.max(3, ECON.odds[r] * 100)}%`;
    el('span', 'ds-num', row, `${(ECON.odds[r] * 100).toFixed(0)}%`);
  }
  el('div', 'pp-note', info, t('pp.pity').replace('{e}', String(ECON.pity.epic - e.box.sinceEpic)).replace('{l}', String(ECON.pity.legendary - e.box.sinceLegend)));
  el('div', 'pp-note', info, t('pp.noDup'));
  const items = seriesItems();
  const have = items.filter((i) => e.items[i.id]).length;
  el('div', 'pp-sec', main, `${t('pp.collection')} ${have} / ${items.length}`);
  const grid = el('div', 'pp-shelf small', main);
  for (const it of [...items].sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity))) storeCard(grid, it, { owned: !!e.items[it.id], onClick: () => openItem(o, it) });
}

function showBox(root: HTMLElement, r: BoxResult): void {
  const shade = el('div', 'dlg-shade ds-root pp-reveal', root);
  shade.dataset.dsTheme = 'bfv';
  const box = el('div', `ds-dialog pp-reveal-box r-${r.rarity}`, shade);
  rarityBadge(box, r.rarity);
  const it = r.item ? item(r.item) : undefined;
  if (it) {
    itemPicture(el('div', 'pp-reveal-pic', box), it, 110);
    el('h3', '', box, nameOf(it.name));
    el('div', 'ds-dim', box, kindLine(it));
  } else el('h3', '', box, t('pp.partsGot').replace('{n}', String(r.parts)));
  const ok = el('button', 'ds-btn primary', box, t('lobby.hint.ok'));
  const close = () => shade.remove();
  ok.addEventListener('click', close);
  shade.addEventListener('click', (ev) => {
    if (ev.target === shade) close();
  });
  setTimeout(() => ok.focus(), 0);
}

function renderExchange(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const top = el('div', 'pp-exch', main);
  el('div', 'pp-note', top, t('pp.exchangeNote'));
  const bp = el('button', 'ds-btn', top, t('pp.buyParts').replace('{p}', n(ECON.partsPack.price)).replace('{n}', n(ECON.partsPack.parts)));
  bp.addEventListener('click', () => confirmBuy(o, { title: `${t('pp.parts')} +${n(ECON.partsPack.parts)}`, price: ECON.partsPack.price }, { op: 'parts' }));
  const grid = el('div', 'pp-shelf', main);
  for (const it of seriesItems()) {
    const owned = !!e.items[it.id];
    const c = storeCard(grid, it, { owned, onClick: () => openItem(o, it, undefined, owned ? undefined : CRAFT_PARTS[it.rarity]) });
    if (!owned) {
      const foot = c.querySelector('.pp-card-foot')!;
      foot.innerHTML = icon('settings');
      el('span', 'ds-num', foot as HTMLElement, `${n(CRAFT_PARTS[it.rarity])}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 무기고

let armoryWeapon: WeaponId = 'ar1';
let armorySub: 'camo' | 'skin' | 'charm' | 'kfx' = 'skin';
let armoryVclass: VehicleClass = 'armor';
let storageKind: ItemKind = 'skin';
let storageShown = 60;

export function renderArmory(body: HTMLElement, o: PageOptions): void {
  const p = settledProfile();
  const e = econOf(p);
  body.classList.add('pp');
  const head = el('div', 'pp-head', body);
  const cur = tabs(head, 'armory', o);
  const have = Object.keys(e.items).filter((id) => item(id)).length;
  el('div', 'pp-count', head, `${t('pp.owned')} ${have} / ${ITEMS.length}`);
  const main = el('div', 'pp-main', body);
  if (cur === 'weapons') renderWeapons(main, p, o);
  else if (cur === 'vehicles') renderVehicles(main, p, o);
  else if (cur === 'identity') renderIdentity(main, p, o);
  else renderStorage(main, p, o);
}

function equipGrid(parent: HTMLElement, its: Item[], worn: string | undefined, o: PageOptions, slot: EquipSlot, on: string | undefined, noneLabel: string): void {
  const grid = el('div', 'pp-shelf small', parent);
  const none = el('button', `pp-card none${!worn ? ' worn' : ''}`, grid);
  el('div', 'pp-card-pic', none).innerHTML = icon('close');
  el('div', 'pp-card-info', none).appendChild(document.createTextNode(noneLabel));
  none.addEventListener('click', () => void act(o, { op: 'equip', slot, weapon: on, value: undefined }));
  for (const it of its) {
    const c = storeCard(grid, it, { owned: false, onClick: () => void act(o, { op: 'equip', slot, weapon: on, value: worn === it.id ? undefined : it.id }) });
    c.classList.toggle('worn', worn === it.id);
    c.querySelector('.pp-card-foot')!.textContent = worn === it.id ? t('pp.equipped') : t('pp.equip');
  }
  if (!its.length) el('div', 'pp-note', parent, t('pp.noneOwned'));
}

function renderWeapons(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const wrap = el('div', 'pp-armory', main);
  const list = el('div', 'pp-wlist', wrap);
  let group = '';
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const w = WEAPONS[id];
    if (w.class !== group) {
      group = w.class;
      el('div', 'pp-wgroup', list, t(`wclass.${w.class}` as MessageKey));
    }
    const b = el('button', `pp-wrow${id === armoryWeapon ? ' sel' : ''}`, list);
    el('span', 'pp-wrow-name', b, w.name);
    const tier = e.camo[id]?.tier ?? 0;
    const dots = el('span', 'pp-dots', b);
    for (let i = 1; i <= 6; i++) el('i', i <= tier ? 'on' : '', dots);
    el('span', 'pp-wrow-lv', b, `Lv ${weaponLevelOf(p.weapons[id]?.xp ?? 0).level}`);
    if (e.equip.skin[id]) b.insertAdjacentHTML('beforeend', icon('star', 'pp-wrow-skin'));
    b.addEventListener('click', () => {
      uiSound('select');
      armoryWeapon = id;
      o.redraw();
    });
  }
  const right = el('div', 'pp-wpick', wrap);
  const id = armoryWeapon;
  const camo = e.equip.camo[id];
  const skin = e.equip.skin[id];
  const charm = e.equip.charm[id];
  const stage = el('div', 'pp-stage', right);
  const img = el('img', 'pp-stage-img', stage);
  img.alt = '';
  const now = weaponPortraitNow(id, undefined, camo, skin, charm);
  if (now) img.src = now;
  else void weaponPortrait(id, undefined, camo, skin, charm).then((u) => u && (img.src = u));
  const cap = el('div', 'pp-stage-cap', stage);
  el('div', 'pp-stage-name', cap, WEAPONS[id].name);
  const lv = weaponLevelOf(p.weapons[id]?.xp ?? 0);
  const lvRow = el('div', 'pp-stage-lv', cap);
  el('span', '', lvRow, `Lv ${lv.level}`);
  el('i', 'ds-progress', lvRow).style.setProperty('--p', lv.need ? (lv.into / lv.need).toFixed(3) : '1');
  const wearing = el('div', 'pp-stage-wear', cap);
  const wearChip = (label: string, value: string | undefined) => {
    const c = el('span', `pp-wchip${value ? '' : ' empty'}`, wearing);
    el('b', '', c, label);
    el('span', '', c, value ?? '—');
  };
  wearChip(t('pp.sub.skin'), skin ? nameOf(item(skin)?.name) : undefined);
  wearChip(t('pp.sub.camo'), camo ? nameOf(camoNameOf(camo)) : undefined);
  wearChip(t('pp.sub.charm'), charm ? nameOf(item(charm)?.name) : undefined);
  const kfx = e.equip.kfx[id] ?? e.equip.kfx['*'];
  wearChip(t('pp.sub.kfx'), kfx ? nameOf(item(kfx)?.name) : undefined);
  // The four things to wear, one at a time.
  const seg = el('div', 'pp-seg', right);
  for (const s of ['skin', 'camo', 'charm', 'kfx'] as const) {
    const b = el('button', `pp-segb${armorySub === s ? ' sel' : ''}`, seg, t(`pp.sub.${s}` as MessageKey));
    b.addEventListener('click', () => {
      armorySub = s;
      uiSound('move');
      o.redraw();
    });
  }
  const owned = (kind: ItemKind, ok: (it: Item) => boolean = () => true) =>
    Object.keys(e.items)
      .map((x) => item(x))
      .filter((it): it is Item => !!it && it.kind === kind && ok(it))
      .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  if (armorySub === 'skin') {
    if (skin && camo) el('div', 'pp-note', right, t('pp.skinOverCamo'));
    equipGrid(right, owned('skin', (it) => it.weapon === id), skin, o, 'skin', id, t('pp.noSkin'));
  } else if (armorySub === 'charm') equipGrid(right, owned('charm'), charm, o, 'charm', id, t('pp.noCharm'));
  else if (armorySub === 'kfx') {
    equipGrid(right, owned('kfx'), e.equip.kfx[id], o, 'kfx', id, t('pp.noKfx'));
    const all = el('div', 'pp-allrow', right);
    el('span', 'pp-note', all, e.equip.kfx['*'] ? t('pp.kfxAllNow').replace('{x}', nameOf(item(e.equip.kfx['*'])?.name)) : t('pp.kfxAllNone'));
    if (e.equip.kfx[id]) {
      const b = el('button', 'ds-btn', all, t('pp.kfxForAll'));
      b.addEventListener('click', () => void act(o, { op: 'equip', slot: 'kfx', weapon: '*', value: e.equip.kfx[id] }));
    }
  } else renderCamoPick(right, p, o, id);
}

function renderCamoPick(right: HTMLElement, p: Profile, o: PageOptions, id: WeaponId): void {
  const e = econOf(p);
  const worn = e.equip.camo[id];
  el('div', 'pp-sec', right, t('pp.challenge'));
  const tiers = el('div', 'pp-tiers', right);
  const st = e.camo[id] ?? { tier: 0, prog: 0 };
  const cls = WEAPONS[id].class;
  CAMO_TIERS.forEach((tr, i) => {
    const done = st.tier > i;
    const c = el('button', `pp-tier${done ? ' done' : ''}${worn === tr.id ? ' sel' : ''}${st.tier === i ? ' now' : ''}`, tiers);
    const sw = el('img', 'cos-camo', c);
    sw.src = camoSwatch(tr.look, 40);
    el('span', 'pp-tier-name', c, nameOf(tr.name));
    const goal = tr.kind === 'special' ? nameOf(SPECIAL[cls].name) : t(`pp.goal.${tr.kind}` as MessageKey);
    const need = tierTarget(i, cls);
    el('span', 'pp-tier-goal', c, done ? t('pp.done') : st.tier === i ? `${goal} ${st.prog} / ${need}` : `${goal} ${need}`);
    if (st.tier === i && !done) el('i', 'ds-progress pp-tier-bar', c).style.setProperty('--p', Math.min(1, st.prog / need).toFixed(3));
    if (done) c.addEventListener('click', () => void act(o, { op: 'equip', slot: 'camo', weapon: id, value: worn === tr.id ? undefined : tr.id }));
    else c.disabled = true;
  });
  for (const special of ['brass', 'obsidian', 'dragon']) {
    const open = camoChoices(e, id).includes(special);
    const look = camoLookOf(special)!;
    const c = el('button', `pp-tier big${open ? ' done' : ''}${worn === special ? ' sel' : ''}`, tiers);
    const sw = el('img', 'cos-camo', c);
    sw.src = camoSwatch(look, 40);
    el('span', 'pp-tier-name', c, nameOf(camoNameOf(special)));
    el('span', 'pp-tier-goal', c, open ? t('pp.done') : t(`pp.how.${special}` as MessageKey));
    if (open) c.addEventListener('click', () => void act(o, { op: 'equip', slot: 'camo', weapon: id, value: worn === special ? undefined : special }));
    else c.disabled = true;
  }
  const shared = camoChoices(e, id).filter((c) => item(c));
  el('div', 'pp-sec', right, `${t('pp.sharedCamo')} (${shared.length})`);
  const grid = el('div', 'pp-shelf small', right);
  for (const cid of shared) {
    const it = item(cid)!;
    const c = storeCard(grid, it, { owned: false, onClick: () => void act(o, { op: 'equip', slot: 'camo', weapon: id, value: worn === cid ? undefined : cid }) });
    c.classList.toggle('worn', worn === cid);
    c.querySelector('.pp-card-foot')!.textContent = worn === cid ? t('pp.equipped') : t('pp.equip');
  }
  if (shared.length) {
    const all = el('button', 'ds-btn ghost', right, t('pp.allGuns'));
    all.addEventListener('click', () => {
      if (!worn) return;
      void (async () => {
        for (const w of Object.keys(WEAPON_CLASSES)) await shopAction({ op: 'equip', slot: 'camo', weapon: w, value: worn });
        uiSound('select');
        o.redraw();
      })();
    });
    all.disabled = !worn || !item(worn);
  } else el('div', 'pp-note', right, t('pp.sharedNone'));
}

function renderVehicles(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  el('div', 'pp-note top', main, t('pp.vskinNote'));
  const seg = el('div', 'pp-seg', main);
  for (const c of VEHICLE_CLASSES) {
    const b = el('button', `pp-segb${armoryVclass === c ? ' sel' : ''}`, seg, t(`pp.vclass.${c}` as MessageKey));
    b.addEventListener('click', () => {
      armoryVclass = c;
      uiSound('move');
      o.redraw();
    });
  }
  const worn = e.equip.vskin[armoryVclass];
  const stage = el('div', 'pp-stage vehicle', main);
  const look = worn ? item(worn)?.vskin : undefined;
  stage.insertAdjacentHTML('beforeend', vehicleSkinSvg(armoryVclass, look ?? { pattern: 'blotch', scale: 1, tones: [1, 1, 1] }, 260));
  el('div', 'pp-stage-name', stage, worn ? nameOf(item(worn)?.name) : t('pp.noVskin'));
  const its = Object.keys(e.items)
    .map((x) => item(x))
    .filter((it): it is Item => !!it && it.kind === 'vskin' && it.vclass === armoryVclass);
  equipGrid(main, its, worn, o, 'vskin', armoryVclass, t('pp.noVskin'));
}

function renderIdentity(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  el('div', 'pp-sec', main, t('pp.preview'));
  const prev = el('div', 'pp-idprev', main);
  const card = e.equip.card ? item(e.equip.card) : undefined;
  if (card?.card) prev.appendChild(cardCanvas(card.card, 320, 80));
  const line = el('div', 'pp-idline', prev);
  const emb = e.equip.emblem ? item(e.equip.emblem) : undefined;
  if (emb?.emblem) line.insertAdjacentHTML('beforeend', emblemSvg(emb.emblem, 28));
  line.insertAdjacentHTML('beforeend', insigniaAt(levelOf(p.xp).level));
  const plate = e.equip.plate ? item(e.equip.plate) : undefined;
  const nm = el('span', 'pp-plate', line, rankLabel(levelOf(p.xp).level));
  if (plate?.plate !== undefined) nm.style.setProperty('--c', `#${plate.plate.toString(16).padStart(6, '0')}`);
  for (const slot of ['card', 'emblem', 'plate'] as const) {
    el('div', 'pp-sec', main, t(`pp.kind.${slot}` as MessageKey));
    const its = Object.keys(e.items)
      .map((x) => item(x))
      .filter((it): it is Item => !!it && it.kind === slot);
    equipGrid(main, its, e.equip[slot], o, slot, undefined, t('pp.default'));
  }
}

const STORAGE_KINDS: ItemKind[] = ['skin', 'camo', 'charm', 'vskin', 'kfx', 'card', 'emblem', 'plate'];

function renderStorage(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const fresh = Object.entries(e.items).filter(([, v]) => !v.seen).map(([k]) => k);
  if (fresh.length) void shopAction({ op: 'seen', items: fresh });
  const chips = el('div', 'pp-filter', main);
  for (const k of STORAGE_KINDS) {
    const all = ITEMS.filter((i) => i.kind === k);
    const owned = all.filter((i) => e.items[i.id]).length;
    const b = el('button', `pp-fchip${storageKind === k ? ' sel' : ''}`, chips, `${t(`pp.kind.${k}` as MessageKey)} ${owned}/${all.length}`);
    b.addEventListener('click', () => {
      storageKind = k;
      storageShown = 60;
      uiSound('move');
      o.redraw();
    });
  }
  const all = ITEMS.filter((i) => i.kind === storageKind).sort((a, b) => Number(!!e.items[b.id]) - Number(!!e.items[a.id]) || RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  const grid = el('div', 'pp-shelf small', main);
  for (const it of all.slice(0, storageShown)) {
    const c = storeCard(grid, it, { owned: !!e.items[it.id], onClick: () => openItem(o, it) });
    if (fresh.includes(it.id)) c.classList.add('new');
    if (!e.items[it.id]) c.querySelector('.pp-card-foot')!.textContent = howToGet(it);
  }
  if (all.length > storageShown) {
    const more = el('button', 'ds-btn pp-more', main, `${t('pp.more')} (${all.length - storageShown})`);
    more.addEventListener('click', () => {
      storageShown += 60;
      o.redraw();
    });
  }
}

function howToGet(it: Item): string {
  if (it.source === 'level') return t('pp.howLevel').replace('{l}', String(it.level)).replace('{r}', rankName(it.level ?? 1));
  if (it.source === 'box') return `${t('pp.howBox')} · ${nameOf(SERIES.name)}`;
  if (it.source === 'challenge') return t('pp.howChallenge');
  return t('pp.howShop').replace('{p}', n(PRICE[it.rarity]));
}

// ---------------------------------------------------------------------------
// 진급

/** Rank groups on the ladder. */
const TIERS: [string, Rank['id'][]][] = [
  ['enlisted', ['pvt', 'pfc', 'cpl', 'sgt']],
  ['nco', ['ssg', 'sfc', 'msg', 'sgm']],
  ['company', ['2lt', '1lt', 'cpt']],
  ['field', ['maj', 'ltc', 'col']],
  ['general', ['bg', 'mg', 'ltg', 'gen']],
  ['marshal', ['goa']],
];

/** Bot-match XP an hour when the player's own pace isn't known yet (as the service record). */
const BOT_XP_HOUR = 90000;

export function renderRanks(body: HTMLElement, o: PageOptions): void {
  const p = settledProfile();
  body.classList.add('pp');
  const head = el('div', 'pp-head', body);
  const cur = tabs(head, 'ranks', o);
  wallet(head, p);
  const main = el('div', 'pp-main', body);
  if (cur === 'rank') renderRank(main, p);
  else renderMissions(main, p, o);
}

function renderRank(main: HTMLElement, p: Profile): void {
  const e = econOf(p);
  const at = levelOf(p.xp);
  const rank = rankAt(at.level);
  const up = nextRank(at.level);
  // The rank now, the way to the next one, and the next one.
  const hero = el('div', 'pp-rhero', main);
  const now = el('div', 'pp-rnow', hero);
  el('div', 'pp-rnow-pic', now).innerHTML = insigniaSvg(rank);
  const txt = el('div', 'pp-rnow-txt', now);
  el('div', 'pp-rnow-name', txt, rankName(at.level));
  el('div', 'pp-rnow-title', txt, rankTitle(rank.id));
  el('div', 'pp-rnow-lv', txt, `Lv ${at.level}`);
  const mid = el('div', 'pp-rmid', hero);
  // This level.
  const lvRow = el('div', 'pp-rbar-row', mid);
  el('span', 'pp-rbar-label', lvRow, t('pp.thisLevel'));
  el('span', 'pp-rbar-num ds-num', lvRow, `${n(at.into)} / ${n(at.need)} XP`);
  const lvBar = el('div', 'pp-rbar', mid);
  el('i', '', lvBar).style.width = `${((at.into / at.need) * 100).toFixed(2)}%`;
  // The whole rank to the next promotion.
  if (up) {
    const span = xpForLevel(up.from) - xpForLevel(rank.from);
    const done = p.xp - xpForLevel(rank.from);
    const share = Math.max(0, Math.min(1, done / span));
    const rkRow = el('div', 'pp-rbar-row', mid);
    el('span', 'pp-rbar-label', rkRow, t('pp.toPromotion').replace('{r}', rankName(up.from)));
    el('span', 'pp-rbar-num ds-num', rkRow, `${(share * 100).toFixed(1)}%`);
    const rkBar = el('div', 'pp-rbar big', mid);
    el('i', '', rkBar).style.width = `${(share * 100).toFixed(2)}%`;
    // Level ticks along the rank's bar.
    const levels = up.from - rank.from;
    if (levels <= 40) for (let l = 1; l < levels; l++) el('b', '', rkBar).style.left = `${(((xpForLevel(rank.from + l) - xpForLevel(rank.from)) / span) * 100).toFixed(2)}%`;
    const s = p.stats.bots;
    const rate = s.seconds > 900 && s.xp > 0 ? (s.xp / s.seconds) * 3600 : BOT_XP_HOUR;
    const facts = el('div', 'pp-rfacts', mid);
    el('span', '', facts, t('pp.levelsLeft').replace('{n}', String(up.from - at.level)));
    el('span', '', facts, t('pp.xpLeft').replace('{n}', n(xpForLevel(up.from) - p.xp)));
    el('span', '', facts, t('pp.eta').replace('{t}', duration(((xpForLevel(up.from) - p.xp) / rate) * 3600)));
    el('span', '', facts, t('pp.totalXp').replace('{n}', n(p.xp)));
    const next = el('div', 'pp-rnext', hero);
    el('div', 'pp-rnext-label', next, t('pp.nextPromotion'));
    el('div', 'pp-rnext-pic', next).innerHTML = insigniaSvg(up);
    el('div', 'pp-rnext-name', next, `${rankName(up.from)} · Lv ${up.from}`);
    const gives = el('div', 'pp-rnext-gives', next);
    const promoT = up.id === 'goa' ? ECON.promotion.marshal : RANKS.indexOf(up) >= RANKS.findIndex((r) => r.id === 'bg') ? ECON.promotion.general : RANKS.indexOf(up) >= RANKS.findIndex((r) => r.id === '2lt') ? ECON.promotion.officer : RANKS.indexOf(up) >= RANKS.findIndex((r) => r.id === 'ssg') ? ECON.promotion.nco : ECON.promotion.enlisted;
    const g = el('span', 'pp-give', gives);
    g.innerHTML = icon('star');
    el('span', '', g, n(promoT + ECON.levelTickets(up.from)));
    if (RANKS.indexOf(up) >= RANKS.findIndex((r) => r.id === 'ssg')) el('span', 'pp-give', gives, t('pp.promoBooster'));
    for (const it of levelRewards(up.from)) {
      const b = el('span', 'pp-give pic', gives);
      itemPicture(b, it, 26);
      b.title = nameOf(it.name);
    }
  } else {
    el('div', 'pp-rfacts', mid, t('rec.topRank'));
  }
  // Boosters running.
  const live = Object.entries(e.boosters.left).filter(([, v]) => (v ?? 0) > 0);
  if (live.length) el('div', 'pp-live', main, live.map(([k, v]) => `${t(`pp.boost.${k}` as MessageKey)} ${Math.ceil((v ?? 0) / 60)}${t('pp.min')}`).join(' · '));
  // Every rank on a ladder, in its groups.
  el('div', 'pp-sec', main, t('pp.ladder'));
  const ladder = el('div', 'pp-ladder', main);
  for (const [tier, ids] of TIERS) {
    const g = el('div', 'pp-ltier', ladder);
    el('div', 'pp-ltier-name', g, t(`pp.tier.${tier}` as MessageKey));
    const row = el('div', 'pp-ltier-row', g);
    for (const id of ids) {
      const r = RANKS.find((x) => x.id === id)!;
      const nextR = RANKS[RANKS.indexOf(r) + 1];
      const state = r.id === rank.id ? 'now' : r.from <= at.level ? 'got' : 'todo';
      const c = el('div', `pp-lrank ${state}`, row);
      el('div', 'pp-lrank-pic', c).innerHTML = insigniaSvg(r);
      el('div', 'pp-lrank-name', c, t(`rank.${r.id}` as MessageKey));
      el('div', 'pp-lrank-lv', c, nextR ? `Lv ${r.from}–${nextR.from - 1}` : `Lv ${r.from}+`);
      if (state === 'now' && nextR) el('i', 'pp-lrank-fill', c).style.width = `${(((p.xp - xpForLevel(r.from)) / (xpForLevel(nextR.from) - xpForLevel(r.from))) * 100).toFixed(1)}%`;
      if (state === 'got') c.insertAdjacentHTML('beforeend', icon('check', 'pp-lrank-check'));
    }
  }
  // The level reward track around now.
  el('div', 'pp-sec', main, t('pp.track'));
  const track = el('div', 'pp-track', main);
  const from = Math.max(2, at.level - 2);
  for (let l = from; l < from + 30; l++) {
    const promo = rankAt(l).from === l;
    const c = el('div', `pp-lv${l <= at.level ? ' got' : ''}${l === at.level + 1 ? ' next' : ''}${promo ? ' promo' : ''}`, track);
    el('div', 'pp-lv-n', c, `Lv ${l}`);
    const pics = el('div', 'pp-lv-pics', c);
    if (promo) pics.innerHTML = insigniaAt(l);
    for (const it of levelRewards(l)) itemPicture(pics, it, 34);
    const tk = el('div', 'pp-lv-t', c);
    tk.innerHTML = icon('star');
    el('span', '', tk, n(ECON.levelTickets(l)));
    if (promo) el('div', 'pp-lv-promo', c, rankName(l));
  }
  // Sideways only (scrollIntoView would scroll the page too).
  requestAnimationFrame(() => {
    const nx = track.querySelector<HTMLElement>('.next');
    if (nx) track.scrollLeft = nx.offsetLeft - track.offsetLeft - track.clientWidth / 2 + nx.offsetWidth / 2;
  });
}

function renderMissions(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const cols = el('div', 'pp-mcols', main);
  const left = el('div', 'pp-mcol', cols);
  el('div', 'pp-sec', left, `${t('pp.daily')} · ${t('pp.refresh').replace('{t}', until(nextDayAt(Date.now())))}`);
  const used = e.day.rerolls;
  e.missions.daily.forEach((m, i) => {
    const def = missionDef(true, m.id);
    if (!def) return;
    const row = missionRow(left, nameOf(def.name), m.prog, def.n, m.done, MISSION.daily.xp, MISSION.daily.tickets);
    if (!m.done && used < MISSION.rerollFree + MISSION.rerollPaid) {
      const price = used < MISSION.rerollFree ? t('pp.free') : n(MISSION.rerollPrice);
      const b = el('button', 'ds-btn ghost pp-reroll', row);
      b.innerHTML = icon('refresh');
      el('span', '', b, price);
      b.title = t('pp.reroll');
      b.addEventListener('click', () => void act(o, { op: 'reroll', index: i }));
    }
  });
  el('div', 'pp-sec', left, t('pp.attendance'));
  const att = el('div', 'pp-att', left);
  ECON.attendance.forEach((v, i) => {
    const c = el('div', `pp-att-day${i < e.att.cycle ? ' got' : ''}${i === e.att.cycle ? ' next' : ''}`, att);
    el('div', 'pp-att-n', c, t('pp.day').replace('{n}', String(i + 1)));
    c.insertAdjacentHTML('beforeend', icon(i === 6 ? 'ammo' : 'star'));
    el('div', 'ds-num', c, i === 6 ? `×${ECON.attendanceBoxes}` : String(v));
  });
  el('div', 'pp-note', left, t('pp.month').replace('{n}', String(e.att.days)).replace('{m}', String(ECON.month.days)));
  const rank = rankAt(levelOf(p.xp).level).id;
  el('div', 'pp-note', left, t('pp.salary').replace('{n}', String(Math.min(e.week.matches, ECON.salaryMatches))).replace('{m}', String(ECON.salaryMatches)).replace('{p}', n(SALARY[rank])));
  const right = el('div', 'pp-mcol', cols);
  const doneW = e.missions.weekly.filter((m) => m.done).length;
  el('div', 'pp-sec', right, `${t('pp.weeklyM')} ${doneW}/${e.missions.weekly.length} · ${t('pp.refresh').replace('{t}', until(nextWeekAt(Date.now())))}`);
  const bonus = el('div', `pp-wbonus${e.missions.weeklyBonus ? ' got' : ''}`, right);
  bonus.innerHTML = icon('ammo');
  el('span', '', bonus, t('pp.weeklyBonus').replace('{n}', String(MISSION.weekly.allBoxes)));
  for (const m of e.missions.weekly) {
    const def = missionDef(false, m.id);
    if (def) missionRow(right, nameOf(def.name), m.prog, def.n, m.done, MISSION.weekly.xp, MISSION.weekly.tickets);
  }
}

function missionRow(parent: HTMLElement, name: string, prog: number, need: number, done: boolean, xp: number, tickets: number): HTMLElement {
  const row = el('div', `pp-mission${done ? ' done' : ''}`, parent);
  row.insertAdjacentHTML('beforeend', icon(done ? 'check' : 'target', 'pp-mission-icon'));
  const txt = el('div', 'pp-mission-txt', row);
  el('div', 'pp-mission-name', txt, name);
  const bar = el('div', 'pp-mission-bar', txt);
  el('i', '', bar).style.width = `${(Math.min(1, prog / need) * 100).toFixed(1)}%`;
  const meta = el('div', 'pp-mission-meta', txt);
  el('span', 'ds-num', meta, `${n(Math.min(prog, need))} / ${n(need)}`);
  el('span', 'pp-mission-reward', meta, `${n(xp)} XP · ${n(tickets)}`);
  return row;
}

// ---------------------------------------------------------------------------
// The main menu's mail and missions.

/** The mailbox as a dialog (salary, attendance, gifts). */
export function openMail(root: HTMLElement, after: () => void): void {
  const shade = el('div', 'dlg-shade ds-root pp-detail-shade', root);
  shade.dataset.dsTheme = 'bfv';
  const box = el('div', 'pp-maildlg', shade);
  const close = escToClose(shade, () => {
    shade.remove();
    after();
  });
  shade.addEventListener('click', (ev) => ev.target === shade && close());
  const draw = () => {
    box.replaceChildren();
    const head = el('div', 'pp-maildlg-head', box);
    head.innerHTML = icon('chat');
    el('h2', '', head, t('pp.mail'));
    const x = el('button', 'pp-detail-x', head);
    x.innerHTML = icon('close');
    x.addEventListener('click', close);
    const e = econOf(settledProfile());
    if (!e.mail.length) {
      el('div', 'pp-note', box, t('pp.mailNone'));
      return;
    }
    const o: PageOptions = { root, redraw: draw };
    for (const m of [...e.mail].sort((a, b) => b.at - a.at)) {
      const row = el('div', 'pp-mail', box);
      row.innerHTML = icon(m.reason === 'salary' ? 'star' : m.reason === 'attendance' || m.reason === 'month' ? 'check' : 'trophy');
      const txt = el('div', 'pp-mail-txt', row);
      el('div', 'pp-mail-title', txt, t(`pp.mail.${m.reason}` as MessageKey));
      const what: string[] = [];
      if (m.tickets) what.push(`${n(m.tickets)} ${t('pp.tickets')}`);
      if (m.boxes) what.push(`${t('pp.boxes')} ×${m.boxes}`);
      if (m.parts) what.push(`${n(m.parts)} ${t('pp.partsShort')}`);
      if (m.booster) what.push(t(`pp.boost.${m.booster.replace(/\d+$/, '')}` as MessageKey) + ` ${m.booster.replace(/^\D+/, '')}${t('pp.min')}`);
      el('div', 'pp-mail-what', txt, what.join(' · '));
      const b = el('button', 'ds-btn', row, t('pp.claim'));
      b.addEventListener('click', () => void act(o, { op: 'claim', id: m.id }));
    }
    const all = el('button', 'ds-btn primary pp-mail-all', box, t('pp.claimAll'));
    all.addEventListener('click', () => void act(o, { op: 'claim' }));
  };
  draw();
}

/** The main menu's missions card: today's three with their bars, the week's count; a click opens them. */
export function missionsCard(parent: HTMLElement, onOpen: () => void): void {
  const e = econOf(settledProfile());
  const c = el('button', 'ds-card mm-missions', parent);
  const head = el('div', 'mm-missions-head', c);
  el('span', 'ds-badge accent', head, t('pp.daily'));
  el('span', 'mm-missions-time', head, until(nextDayAt(Date.now())));
  for (const m of e.missions.daily) {
    const def = missionDef(true, m.id);
    if (!def) continue;
    const row = el('div', `mm-mrow${m.done ? ' done' : ''}`, c);
    el('span', 'mm-mrow-name', row, nameOf(def.name));
    el('span', 'mm-mrow-num', row, m.done ? '✓' : `${n(Math.min(m.prog, def.n))}/${n(def.n)}`);
    const bar = el('span', 'mm-mrow-bar', row);
    el('i', '', bar).style.width = `${(Math.min(1, m.prog / def.n) * 100).toFixed(1)}%`;
  }
  const doneW = e.missions.weekly.filter((m) => m.done).length;
  el('div', 'mm-missions-week', c, `${t('pp.weeklyM')} ${doneW}/${e.missions.weekly.length}`);
  c.addEventListener('pointerenter', () => uiSound('hover'));
  c.addEventListener('click', () => {
    uiSound('open');
    tab.ranks = 'missions';
    onOpen();
  });
}
