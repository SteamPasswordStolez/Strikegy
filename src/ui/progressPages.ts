/**
 * The progression's menu pages (step 5; progression-data.md P): 상점 (the
 * week's shop with the boosters, supply boxes, the depot, the exchange), 무기고
 * (camo on each gun, card / emblem / name plate, the collection) and 진급표
 * (the rank and its level rewards, each gun's camo challenges, missions and
 * attendance, the mailbox). Everything goes through `shopAction` (the server
 * for an account, this browser for a guest), then the page draws again.
 */
import { t, type MessageKey } from '@/i18n';
import { uiSound } from '@/audio/uiSounds';
import { settledProfile, shopAction } from '@/net/account';
import { levelOf, rankAt, nextRank } from '@/progression/levels';
import { weaponLevelOf } from '@/progression/unlocks';
import { CRAFT_PARTS, ITEMS, PRICE, RARITIES, SERIES, item, levelRewards, seriesItems, type Item, type Rarity } from '@/progression/catalog';
import { CAMO_TIERS, SPECIAL, camoLookOf, camoNameOf, tierTarget } from '@/progression/camo';
import { DAILY, MISSION, WEEKLY, missionDef } from '@/progression/missions';
import {
  BOOSTERS,
  ECON,
  SALARY,
  WEAPON_CLASSES,
  camoChoices,
  depotOffer,
  econOf,
  weeklyOffer,
  type BoostItem,
  type BoostKind,
  type BoxResult,
  type Offer,
  type ShopOp,
} from '@/progression/economy';
import { nextDayAt, nextWeekAt } from '@/progression/calendar';
import type { Profile } from '@/progression/profile';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { cardCanvas, camoSwatch, emblemSvg, itemPicture, nameOf } from './cosmetics';
import { insigniaAt, rankLabel, rankName, rankTitle } from './rankInsignia';
import { weaponPortrait, weaponPortraitNow } from './weaponPortraits';
import { icon } from './icons';
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

function tabs(parent: HTMLElement, page: string, list: readonly string[], o: PageOptions): string {
  const cur = tab[page] && list.includes(tab[page]!) ? tab[page]! : list[0]!;
  const bar = el('div', 'ds-tabs pp-tabs', parent);
  for (const id of list) {
    const b = el('button', `ds-tab${id === cur ? ' sel' : ''}`, bar, t(`pp.${page}.${id}` as MessageKey));
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

const PAGE_TABS = {
  shop: ['weekly', 'boxes', 'depot', 'exchange'],
  armory: ['weapons', 'identity', 'storage'],
  ranks: ['rank', 'weapons', 'missions', 'mail'],
} as const;

/** The wallet line: supply tickets, parts, boxes. */
function wallet(parent: HTMLElement, p: Profile): void {
  const e = econOf(p);
  const w = el('div', 'pp-wallet', parent);
  const chip = (ic: Parameters<typeof icon>[0], label: string, v: number) => {
    const c = el('span', 'pp-chip', w);
    c.innerHTML = icon(ic);
    el('span', 'ds-label', c, label);
    el('span', 'ds-num', c, n(v));
  };
  chip('star', t('pp.tickets'), e.tickets);
  chip('settings', t('pp.parts'), e.parts);
  chip('ammo', t('pp.boxes'), e.boxes);
}

async function act(o: PageOptions, op: ShopOp, ok?: (result: unknown) => void): Promise<void> {
  const r = await shopAction(op);
  if (r.error) {
    uiSound('error');
    toast(o.root, t(`pp.err.${r.error}` as MessageKey) || r.error);
  } else {
    uiSound('select');
    ok?.(r.result);
  }
  o.redraw();
}

function toast(root: HTMLElement, text: string): void {
  const d = el('div', 'ds-toast pp-toast', root, text);
  setTimeout(() => d.remove(), 3500);
}

const until = (at: number) => {
  const s = Math.max(0, Math.round((at - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h >= 24 ? t('pp.days').replace('{n}', String(Math.floor(h / 24))) : `${h}:${String(m).padStart(2, '0')}`;
};

function rarityBadge(parent: HTMLElement, r: Rarity): void {
  el('span', `pp-rar r-${r}`, parent, t(`pp.rarity.${r}` as MessageKey));
}

/** One item as a card: picture, name, rarity, and what to do with it. */
function itemCard(parent: HTMLElement, it: Item, owned: boolean): HTMLElement {
  const c = el('div', `pp-item r-${it.rarity}${owned ? ' owned' : ''}`, parent);
  itemPicture(el('div', 'pp-item-pic', c), it, 52);
  el('div', 'pp-item-name', c, nameOf(it.name));
  const meta = el('div', 'pp-item-meta', c);
  rarityBadge(meta, it.rarity);
  el('span', 'ds-label', meta, t(`pp.kind.${it.kind}` as MessageKey));
  return c;
}

// ---------------------------------------------------------------------------
// 상점

export function renderShop(body: HTMLElement, o: PageOptions): void {
  const p = settledProfile();
  const e = econOf(p);
  body.classList.add('pp');
  const head = el('div', 'pp-head', body);
  const cur = tabs(head, 'shop', PAGE_TABS.shop, o);
  wallet(head, p);
  const main = el('div', 'pp-main', body);
  if (cur === 'weekly') {
    el('div', 'ds-label pp-sec', main, `${t('pp.boosters')} · ${t('pp.boostersNote')}`);
    const boosts = el('div', 'pp-boosts', main);
    for (const kind of Object.keys(BOOSTERS) as BoostKind[]) {
      const b = el('div', 'pp-boost', boosts);
      el('div', 'pp-boost-name', b, t(`pp.boost.${kind}` as MessageKey));
      const left = e.boosters.left[kind] ?? 0;
      el('div', 'ds-dim', b, left > 0 ? t('pp.boostLeft').replace('{m}', String(Math.ceil(left / 60))) : t('pp.boostOff'));
      const row = el('div', 'pp-boost-buys', b);
      for (const [min, price] of Object.entries(BOOSTERS[kind].price)) {
        const id = `${kind}${min}` as BoostItem;
        const owned = e.boosters.owned[id] ?? 0;
        const col = el('div', 'pp-boost-opt', row);
        el('span', 'ds-label', col, t('pp.minutes').replace('{n}', min));
        const buy = el('button', 'ds-btn', col, `${n(price!)}`);
        buy.addEventListener('click', () => void act(o, { op: 'booster', item: id }));
        if (owned) {
          const use = el('button', 'ds-btn primary', col, `${t('pp.activate')} ×${owned}`);
          use.addEventListener('click', () => void act(o, { op: 'activate', item: id }));
        }
      }
    }
    el('div', 'ds-label pp-sec', main, `${t('pp.weekly')} · ${t('pp.refresh').replace('{t}', until(nextWeekAt(Date.now())))}`);
    offers(main, weeklyOffer(Date.now()), p, o);
  } else if (cur === 'depot') {
    el('div', 'ds-label pp-sec', main, t('pp.depotNote'));
    offers(main, depotOffer(Date.now()), p, o);
  } else if (cur === 'boxes') {
    renderBoxes(main, p, o);
  } else {
    renderExchange(main, p, o);
  }
}

function offers(parent: HTMLElement, list: Offer[], p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const grid = el('div', 'pp-grid', parent);
  for (const offer of list) {
    const its = offer.items.map((id) => item(id)!).filter(Boolean);
    const owned = its.every((it) => e.items[it.id]);
    if (offer.bundle) {
      const c = el('div', `pp-item pp-bundle${owned ? ' owned' : ''}`, grid);
      const pics = el('div', 'pp-item-pic', c);
      for (const it of its) itemPicture(pics, it, 34);
      el('div', 'pp-item-name', c, t(`pp.bundle.${offer.bundle}` as MessageKey));
      el('div', 'ds-dim', c, its.map((it) => nameOf(it.name)).join(' · '));
      buyButton(c, offer, owned, o);
      continue;
    }
    const c = itemCard(grid, its[0]!, owned);
    buyButton(c, offer, owned, o);
  }
}

function buyButton(c: HTMLElement, offer: Offer, owned: boolean, o: PageOptions): void {
  const b = el('button', `ds-btn${owned ? '' : ' primary'} pp-buy`, c, owned ? t('pp.owned') : n(offer.price));
  if (!owned) {
    b.insertAdjacentHTML('afterbegin', icon('star'));
    b.addEventListener('click', () => void act(o, { op: 'buy', key: offer.key }));
  } else b.disabled = true;
}

function renderBoxes(main: HTMLElement, p: Profile, o: PageOptions): void {
  const e = econOf(p);
  const top = el('div', 'pp-boxtop', main);
  const box = el('div', 'pp-box', top);
  box.innerHTML = icon('ammo');
  el('div', 'pp-box-name', box, nameOf(SERIES.name));
  el('div', 'ds-dim', box, t('pp.boxOwned').replace('{n}', String(e.boxes)));
  const btns = el('div', 'pp-box-btns', box);
  const open = el('button', 'ds-btn primary', btns, t('pp.open'));
  open.disabled = e.boxes < 1;
  open.addEventListener('click', () => void act(o, { op: 'open' }, (r) => showBox(o.root, r as BoxResult)));
  const b1 = el('button', 'ds-btn', btns, `${t('pp.buyBox')} · ${n(ECON.boxPrice)}`);
  b1.addEventListener('click', () => void act(o, { op: 'box', count: 1 }));
  const b10 = el('button', 'ds-btn', btns, `${t('pp.buyBox10')} · ${n(ECON.boxPrice * 10)}`);
  b10.addEventListener('click', () => void act(o, { op: 'box', count: 10 }));
  const info = el('div', 'pp-odds', top);
  el('div', 'ds-label', info, t('pp.odds'));
  for (const r of RARITIES) {
    const row = el('div', 'pp-odds-row', info);
    rarityBadge(row, r);
    el('span', 'ds-num', row, `${(ECON.odds[r] * 100).toFixed(0)}%`);
  }
  el('div', 'ds-dim', info, t('pp.pity').replace('{e}', String(ECON.pity.epic - e.box.sinceEpic)).replace('{l}', String(ECON.pity.legendary - e.box.sinceLegend)));
  el('div', 'ds-dim', info, t('pp.noDup'));
  const items = seriesItems();
  const have = items.filter((i) => e.items[i.id]).length;
  el('div', 'ds-label pp-sec', main, `${t('pp.collection')} ${have} / ${items.length}`);
  const grid = el('div', 'pp-grid small', main);
  for (const it of items) itemCard(grid, it, !!e.items[it.id]);
}

function showBox(root: HTMLElement, r: BoxResult): void {
  const shade = el('div', 'dlg-shade ds-root pp-reveal', root);
  shade.dataset.dsTheme = 'bfv';
  const box = el('div', `ds-dialog pp-reveal-box r-${r.rarity}`, shade);
  rarityBadge(box, r.rarity);
  const it = r.item ? item(r.item) : undefined;
  if (it) {
    itemPicture(el('div', 'pp-reveal-pic', box), it, 96);
    el('h3', '', box, nameOf(it.name));
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
  el('div', 'ds-dim', top, t('pp.exchangeNote'));
  const bp = el('button', 'ds-btn', top, t('pp.buyParts').replace('{p}', n(ECON.partsPack.price)).replace('{n}', n(ECON.partsPack.parts)));
  bp.addEventListener('click', () => void act(o, { op: 'parts' }));
  const grid = el('div', 'pp-grid', main);
  for (const it of seriesItems()) {
    const owned = !!e.items[it.id];
    const c = itemCard(grid, it, owned);
    const b = el('button', `ds-btn${owned ? '' : ' primary'} pp-buy`, c, owned ? t('pp.owned') : `${n(CRAFT_PARTS[it.rarity])} ${t('pp.partsShort')}`);
    if (owned) b.disabled = true;
    else b.addEventListener('click', () => void act(o, { op: 'craft', item: it.id }));
  }
}

// ---------------------------------------------------------------------------
// 무기고

let armoryWeapon: WeaponId = 'ar1';

export function renderArmory(body: HTMLElement, o: PageOptions): void {
  const p = settledProfile();
  const e = econOf(p);
  body.classList.add('pp');
  const head = el('div', 'pp-head', body);
  const cur = tabs(head, 'armory', PAGE_TABS.armory, o);
  const total = ITEMS.length;
  const have = Object.keys(e.items).filter((id) => item(id)).length;
  el('div', 'pp-count ds-label', head, `${t('pp.owned')} ${have} / ${total}`);
  const main = el('div', 'pp-main', body);
  if (cur === 'weapons') {
    const wrap = el('div', 'pp-armory', main);
    const list = el('div', 'pp-wlist', wrap);
    let group = '';
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const w = WEAPONS[id];
      if (w.class !== group) {
        group = w.class;
        el('div', 'ds-label pp-wgroup', list, t(`wclass.${w.class}` as MessageKey));
      }
      const b = el('button', `ds-row pp-wrow${id === armoryWeapon ? ' sel' : ''}`, list);
      el('span', 'ds-row-main', b, w.name);
      const tier = e.camo[id]?.tier ?? 0;
      const dots = el('span', 'pp-dots', b);
      for (let i = 1; i <= 6; i++) el('i', i <= tier ? 'on' : '', dots);
      el('span', 'ds-row-side', b, `Lv ${weaponLevelOf(p.weapons[id]?.xp ?? 0).level}`);
      b.addEventListener('click', () => {
        uiSound('select');
        armoryWeapon = id;
        o.redraw();
      });
    }
    const right = el('div', 'pp-wpick', wrap);
    const id = armoryWeapon;
    const worn = e.equip.camo[id];
    const pic = el('div', 'pp-wpic', right);
    const img = el('img', 'pp-wpic-img', pic);
    img.alt = '';
    const now = weaponPortraitNow(id, undefined, worn);
    if (now) img.src = now;
    else void weaponPortrait(id, undefined, worn).then((u) => u && (img.src = u));
    el('div', 'pp-wname', right, `${WEAPONS[id].name} · ${worn ? nameOf(camoNameOf(worn)) : t('pp.noCamo')}`);
    el('div', 'ds-label pp-sec', right, t('pp.challenge'));
    const tiers = el('div', 'pp-tiers', right);
    const st = e.camo[id] ?? { tier: 0, prog: 0 };
    const cls = WEAPONS[id].class;
    CAMO_TIERS.forEach((tr, i) => {
      const done = st.tier > i;
      const c = el('button', `pp-tier${done ? ' done' : ''}${worn === tr.id ? ' sel' : ''}`, tiers);
      const sw = el('img', 'cos-camo', c);
      sw.src = camoSwatch(tr.look, 40);
      el('span', 'pp-tier-name', c, nameOf(tr.name));
      const goal = tr.kind === 'special' ? nameOf(SPECIAL[cls].name) : t(`pp.goal.${tr.kind}` as MessageKey);
      const need = tierTarget(i, cls);
      el('span', 'ds-dim', c, done ? t('pp.done') : st.tier === i ? `${goal} ${st.prog} / ${need}` : `${goal} ${need}`);
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
      el('span', 'ds-dim', c, open ? t('pp.done') : t(`pp.how.${special}` as MessageKey));
      if (open) c.addEventListener('click', () => void act(o, { op: 'equip', slot: 'camo', weapon: id, value: worn === special ? undefined : special }));
      else c.disabled = true;
    }
    const shared = camoChoices(e, id).filter((c) => item(c));
    el('div', 'ds-label pp-sec', right, `${t('pp.sharedCamo')} (${shared.length})`);
    const grid = el('div', 'pp-grid small', right);
    for (const cid of shared) {
      const it = item(cid)!;
      const c = itemCard(grid, it, true);
      c.classList.toggle('sel', worn === cid);
      const b = el('button', 'ds-btn pp-buy', c, worn === cid ? t('pp.unequip') : t('pp.equip'));
      b.addEventListener('click', () => void act(o, { op: 'equip', slot: 'camo', weapon: id, value: worn === cid ? undefined : cid }));
      const all = el('button', 'ds-btn ghost pp-buy', c, t('pp.allGuns'));
      all.addEventListener('click', () => {
        void (async () => {
          for (const w of Object.keys(WEAPON_CLASSES)) await shopAction({ op: 'equip', slot: 'camo', weapon: w, value: cid });
          uiSound('select');
          o.redraw();
        })();
      });
    }
    if (!shared.length) el('div', 'ds-dim', right, t('pp.sharedNone'));
  } else if (cur === 'identity') {
    for (const slot of ['card', 'emblem', 'plate'] as const) {
      el('div', 'ds-label pp-sec', main, t(`pp.kind.${slot}` as MessageKey));
      const grid = el('div', 'pp-grid small', main);
      const worn = e.equip[slot];
      const none = el('button', `pp-item${!worn ? ' sel' : ''}`, grid, t('pp.default'));
      none.addEventListener('click', () => void act(o, { op: 'equip', slot, value: undefined }));
      for (const id of Object.keys(e.items)) {
        const it = item(id);
        if (!it || it.kind !== slot) continue;
        const c = itemCard(grid, it, true);
        c.classList.toggle('sel', worn === id);
        c.addEventListener('click', () => void act(o, { op: 'equip', slot, value: id }));
      }
    }
    el('div', 'ds-label pp-sec', main, t('pp.preview'));
    const prev = el('div', 'pp-idprev', main);
    const card = e.equip.card ? item(e.equip.card) : undefined;
    if (card?.card) prev.appendChild(cardCanvas(card.card, 280, 70));
    const line = el('div', 'pp-idline', prev);
    const emb = e.equip.emblem ? item(e.equip.emblem) : undefined;
    if (emb?.emblem) line.insertAdjacentHTML('beforeend', emblemSvg(emb.emblem, 28));
    line.insertAdjacentHTML('beforeend', insigniaAt(levelOf(p.xp).level));
    const plate = e.equip.plate ? item(e.equip.plate) : undefined;
    const nm = el('span', 'pp-plate', line, rankLabel(levelOf(p.xp).level));
    if (plate?.plate !== undefined) nm.style.setProperty('--c', `#${plate.plate.toString(16).padStart(6, '0')}`);
  } else {
    // The collection: everything, owned first; how to get what isn't.
    const fresh = Object.entries(e.items).filter(([, v]) => !v.seen).map(([k]) => k);
    if (fresh.length) void shopAction({ op: 'seen', items: fresh });
    for (const kind of ['camo', 'card', 'emblem', 'plate'] as const) {
      const all = ITEMS.filter((i) => i.kind === kind);
      const owned = all.filter((i) => e.items[i.id]).length;
      el('div', 'ds-label pp-sec', main, `${t(`pp.kind.${kind}` as MessageKey)} ${owned} / ${all.length}`);
      const grid = el('div', 'pp-grid small', main);
      for (const it of [...all].sort((a, b) => Number(!!e.items[b.id]) - Number(!!e.items[a.id]) || RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity))) {
        const c = itemCard(grid, it, !!e.items[it.id]);
        if (fresh.includes(it.id)) c.classList.add('new');
        el('div', 'ds-dim pp-how', c, e.items[it.id] ? t(`pp.from.${e.items[it.id]!.from}` as MessageKey) || '' : howToGet(it));
      }
    }
  }
}

function howToGet(it: Item): string {
  if (it.source === 'level') return t('pp.howLevel').replace('{l}', String(it.level)).replace('{r}', rankName(it.level ?? 1));
  if (it.source === 'box') return `${t('pp.howBox')} · ${nameOf(SERIES.name)}`;
  return t('pp.howShop').replace('{p}', n(PRICE[it.rarity]));
}

// ---------------------------------------------------------------------------
// 진급표

export function renderRanks(body: HTMLElement, o: PageOptions): void {
  const p = settledProfile();
  const e = econOf(p);
  body.classList.add('pp');
  const head = el('div', 'pp-head', body);
  const cur = tabs(head, 'ranks', PAGE_TABS.ranks, o);
  if (e.mail.length) el('span', 'pp-mailcount ds-badge accent', head, t('pp.mailN').replace('{n}', String(e.mail.length)));
  wallet(head, p);
  const main = el('div', 'pp-main', body);
  const at = levelOf(p.xp);
  if (cur === 'rank') {
    const top = el('div', 'pp-rankhead', main);
    el('div', 'pp-rankpic', top).innerHTML = insigniaAt(at.level);
    const txt = el('div', '', top);
    el('div', 'pp-rankname', txt, `${rankName(at.level)} · Lv ${at.level}`);
    el('div', 'ds-dim', txt, rankTitle(rankAt(at.level).id));
    const bar = el('div', 'ds-progress pp-rankbar', txt);
    bar.style.setProperty('--p', (at.into / at.need).toFixed(3));
    el('div', 'ds-dim', txt, t('rec.toNext').replace('{n}', n(at.need - at.into)));
    const nr = nextRank(at.level);
    if (nr) el('div', 'ds-dim', txt, t('pp.nextRank').replace('{r}', rankName(nr.from)).replace('{n}', String(nr.from - at.level)));
    // Boosters running.
    const live = Object.entries(e.boosters.left).filter(([, v]) => (v ?? 0) > 0);
    if (live.length) el('div', 'pp-live', txt, live.map(([k, v]) => `${t(`pp.boost.${k}` as MessageKey)} ${Math.ceil((v ?? 0) / 60)}${t('pp.min')}`).join(' · '));
    // The level reward track around the current level.
    el('div', 'ds-label pp-sec', main, t('pp.track'));
    const track = el('div', 'pp-track', main);
    const from = Math.max(2, at.level - 3);
    for (let l = from; l < from + 40; l++) {
      const promo = rankAt(l).from === l;
      const c = el('div', `pp-lv${l <= at.level ? ' got' : ''}${l === at.level + 1 ? ' next' : ''}${promo ? ' promo' : ''}`, track);
      el('div', 'pp-lv-n', c, `Lv ${l}`);
      const pics = el('div', 'pp-lv-pics', c);
      if (promo) pics.innerHTML = insigniaAt(l);
      for (const it of levelRewards(l)) itemPicture(pics, it, 30);
      el('div', 'ds-dim pp-lv-t', c, `+${ECON.levelTickets(l)}`);
      if (promo) el('div', 'pp-lv-promo', c, rankName(l));
    }
    track.querySelector('.next')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  } else if (cur === 'weapons') {
    const grid = el('div', 'pp-wgrid', main);
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const w = WEAPONS[id];
      const lv = weaponLevelOf(p.weapons[id]?.xp ?? 0);
      const c = el('div', 'pp-wcard', grid);
      el('div', 'pp-wcard-name', c, w.name);
      el('div', 'ds-label', c, `Lv ${lv.level}`);
      el('i', 'ds-progress', c).style.setProperty('--p', lv.need ? (lv.into / lv.need).toFixed(3) : '1');
      const st = e.camo[id] ?? { tier: 0, prog: 0 };
      const dots = el('div', 'pp-dots', c);
      for (let i = 1; i <= 6; i++) el('i', i <= st.tier ? 'on' : '', dots);
      if (st.tier < 5) {
        const tr = CAMO_TIERS[st.tier]!;
        const goal = tr.kind === 'special' ? nameOf(SPECIAL[w.class].name) : t(`pp.goal.${tr.kind}` as MessageKey);
        el('div', 'ds-dim', c, `${goal} ${st.prog} / ${tierTarget(st.tier, w.class)}`);
      } else el('div', 'ds-dim', c, st.tier >= 6 ? nameOf(camoNameOf('brass')) : t('pp.brassSoon'));
    }
  } else if (cur === 'missions') {
    el('div', 'ds-label pp-sec', main, `${t('pp.daily')} · ${t('pp.refresh').replace('{t}', until(nextDayAt(Date.now())))}`);
    const used = e.day.rerolls;
    e.missions.daily.forEach((m, i) => {
      const def = missionDef(true, m.id);
      if (!def) return;
      const row = missionRow(main, nameOf(def.name), m.prog, def.n, m.done, `${n(MISSION.daily.xp)} XP · ${MISSION.daily.tickets}`);
      if (!m.done && used < MISSION.rerollFree + MISSION.rerollPaid) {
        const price = used < MISSION.rerollFree ? t('pp.free') : n(MISSION.rerollPrice);
        const b = el('button', 'ds-btn ghost pp-reroll', row, `${t('pp.reroll')} (${price})`);
        b.addEventListener('click', () => void act(o, { op: 'reroll', index: i }));
      }
    });
    el('div', 'ds-label pp-sec', main, `${t('pp.weeklyM')} · ${t('pp.refresh').replace('{t}', until(nextWeekAt(Date.now())))} · ${t('pp.weeklyBonus').replace('{n}', String(MISSION.weekly.allBoxes))}${e.missions.weeklyBonus ? ' ✓' : ''}`);
    for (const m of e.missions.weekly) {
      const def = missionDef(false, m.id);
      if (def) missionRow(main, nameOf(def.name), m.prog, def.n, m.done, `${n(MISSION.weekly.xp)} XP · ${MISSION.weekly.tickets}`);
    }
    el('div', 'ds-label pp-sec', main, t('pp.attendance'));
    const att = el('div', 'pp-att', main);
    ECON.attendance.forEach((v, i) => {
      const c = el('div', `pp-att-day${i < e.att.cycle ? ' got' : ''}${i === e.att.cycle ? ' next' : ''}`, att);
      el('div', 'ds-label', c, t('pp.day').replace('{n}', String(i + 1)));
      el('div', 'ds-num', c, i === 6 ? `${t('pp.boxes')} ×${ECON.attendanceBoxes}` : String(v));
    });
    el('div', 'ds-dim', main, t('pp.month').replace('{n}', String(e.att.days)).replace('{m}', String(ECON.month.days)));
    const rank = rankAt(at.level).id;
    el('div', 'ds-dim', main, t('pp.salary').replace('{n}', String(Math.min(e.week.matches, ECON.salaryMatches))).replace('{m}', String(ECON.salaryMatches)).replace('{p}', n(SALARY[rank])));
    void DAILY;
    void WEEKLY;
  } else {
    if (!e.mail.length) el('div', 'ds-dim', main, t('pp.mailNone'));
    else {
      const all = el('button', 'ds-btn primary', main, t('pp.claimAll'));
      all.addEventListener('click', () => void act(o, { op: 'claim' }));
      for (const m of e.mail) {
        const row = el('div', 'ds-row pp-mail', main);
        el('span', 'ds-row-main', row, t(`pp.mail.${m.reason}` as MessageKey));
        const what: string[] = [];
        if (m.tickets) what.push(`${n(m.tickets)} ${t('pp.tickets')}`);
        if (m.boxes) what.push(`${t('pp.boxes')} ×${m.boxes}`);
        if (m.parts) what.push(`${n(m.parts)} ${t('pp.partsShort')}`);
        if (m.booster) what.push(t(`pp.boost.${m.booster.replace(/\d+$/, '')}` as MessageKey) + ` ${m.booster.replace(/^\D+/, '')}${t('pp.min')}`);
        el('span', 'ds-row-side', row, what.join(' · '));
        const b = el('button', 'ds-btn', row, t('pp.claim'));
        b.addEventListener('click', () => void act(o, { op: 'claim', id: m.id }));
      }
    }
  }
}

function missionRow(parent: HTMLElement, name: string, prog: number, need: number, done: boolean, reward: string): HTMLElement {
  const row = el('div', `pp-mission${done ? ' done' : ''}`, parent);
  const txt = el('div', 'pp-mission-txt', row);
  el('div', 'pp-mission-name', txt, name);
  el('i', 'ds-progress', txt).style.setProperty('--p', Math.min(1, prog / need).toFixed(3));
  el('div', 'ds-dim', txt, `${n(Math.min(prog, need))} / ${n(need)} · ${reward}`);
  if (done) el('span', 'ds-badge accent', row, t('pp.done'));
  return row;
}
