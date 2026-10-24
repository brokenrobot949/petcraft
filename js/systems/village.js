// Mossbrook, the village down the road (docs/design.md "Village and economy"): the market (sell
// anything at a fixed price; buy seeds, blueprints and recipe scrolls), the Commission Board
// (3 requests a day, reset at local midnight, 1 free reroll a day), the weekly Great Commission and
// the traveling merchant (3 rotating offers a day, changing at local midnight like the board).
// Days and weeks change only through the village/newDay command (the UI sends it on load, when
// the page comes back and once a minute; the balance simulator at every check-in), because
// advance() never reads the clock. Each board is rolled from the village's own random stream.
import { random, randomInt } from '../core/rng.js';
import { addItem, removeItem, itemCount, itemKey, parseKey, itemDef } from './bag.js';
import { skillLevel } from './skills.js';
import { zoneUnlocked } from './harvest.js';
import { addRenownXp } from './renown.js';
import { earnCoins, spendCoins } from './coins.js';

export const id = 'village';

export function init(state) {
  const st = state.stats;
  for (const k of ['coinsEarned', 'coinsSpent', 'sold', 'commissions', 'greats']) if (!Number.isFinite(st[k])) st[k] = 0;
}

// ---- lookups ----

// Week number for a local day number: weeks start on Monday (balance.village.weekStartOffset).
export function weekOf(data, day) {
  return Math.floor((day + data.balance.village.weekStartOffset) / 7);
}

// The highest material tier the player can actually gather: an open zone they have a tool for.
export function reachableTier(state, data) {
  let best = 1;
  const toolTiers = data.tools.kinds.filter((k) => k.skill).map((k) => data.items.items[state.tools[k.id]?.item]?.tier || 0);
  const topTool = Math.max(1, ...toolTiers);
  for (const z of data.zones.zones) {
    if (z.tier > best && z.tier <= topTool && zoneUnlocked(state, data, z.id) && Object.keys(z.harvest || {}).length) best = z.tier;
  }
  return best;
}

function templateDef(data, templateId) {
  const c = data.commissions;
  return c.daily.find((t) => t.id === templateId) || c.great.find((t) => t.id === templateId) || null;
}

function needsMet(state, t) {
  return Object.entries(t.needs || {}).every(([skill, lvl]) => skillLevel(state, skill) >= lvl);
}

// Templates the board may offer now: within tierSpread of the reachable tier, needs met.
function eligible(state, data, list) {
  const reach = reachableTier(state, data);
  const ok = list.filter((t) => t.tier <= reach && needsMet(state, t));
  const near = ok.filter((t) => t.tier >= reach - data.balance.village.tierSpread);
  return near.length >= data.balance.village.boardSize ? near : ok;
}

function pick(stream, list) {
  return list[Math.floor(random(stream) * list.length)] || null;
}

function pickWeighted(stream, list) {
  const total = list.reduce((s, e) => s + (e.weight || 1), 0);
  let r = random(stream) * total;
  for (const e of list) {
    r -= e.weight || 1;
    if (r < 0) return e;
  }
  return list[list.length - 1] || null;
}

function valueOf(data, items) {
  return Object.entries(items).reduce((sum, [id, n]) => sum + (data.items.items[id]?.sell || 0) * n, 0);
}

// Rolls one commission from a template: { template, items, coins, renown, bonus, done }.
function roll(state, data, t, great) {
  const v = state.village;
  const cfg = great ? data.balance.village.great : data.balance.village.daily;
  const items = {};
  for (const e of t.items) items[e.item] = (items[e.item] || 0) + randomInt(v, e.qty[0], e.qty[1]);
  const coins = Math.max(cfg.minCoins, Math.round(valueOf(data, items) * cfg.coinMult));
  const renown = great ? cfg.renown : randomInt(v, cfg.renown[0], cfg.renown[1]);
  let bonus = null;
  const reach = reachableTier(state, data);
  const pool = data.commissions.bonus.filter((b) => b.tier <= reach);
  if (great || (pool.length && random(v) < cfg.bonusChance)) {
    const b = pickWeighted(v, pool);
    if (b) bonus = { [b.item]: randomInt(v, b.qty[0], b.qty[1]) };
  }
  return { template: t.id, items, coins, renown, bonus, done: false };
}

function rollDaily(state, data, exclude) {
  const list = eligible(state, data, data.commissions.daily);
  const fresh = list.filter((t) => !exclude.includes(t.id));
  const t = pick(state.village, fresh.length ? fresh : list);
  return t ? roll(state, data, t, false) : null;
}

function rollMerchant(state, data) {
  const v = state.village;
  const pool = data.market.merchant.filter((m) => state.renown.rank >= (m.renown || 1));
  const out = [];
  for (let i = 0; i < data.balance.village.merchant.slots && pool.length; i++) {
    const m = pickWeighted(v, pool);
    pool.splice(pool.indexOf(m), 1);
    out.push({ item: m.item, price: m.price, left: m.qty || 1 });
  }
  return out;
}

// Fills a new day's board and merchant stock, and a new week's Great Commission. Idempotent.
export function newDay(state, ctx) {
  const { data } = ctx;
  const v = state.village;
  if (v.day !== ctx.day) {
    v.day = ctx.day;
    v.rerolls = 0;
    v.board = [];
    for (let i = 0; i < data.balance.village.boardSize; i++) {
      const c = rollDaily(state, data, v.board.map((b) => b.template));
      if (c) v.board.push(c);
    }
    v.merchant = rollMerchant(state, data);
    v.seen = false;
    ctx.emit?.({ type: 'newBoard', day: ctx.day });
  }
  const week = weekOf(data, ctx.day);
  if (v.week !== week) {
    v.week = week;
    v.great = null;
  }
  // A brand-new player may not meet any Great Commission's needs yet: keep trying until one fits.
  if (!v.great) {
    const list = eligible(state, data, data.commissions.great);
    if (list.length) v.great = roll(state, data, pick(v, list), true);
  }
}

// How many of a base item id the bag holds across qualities (deliveries accept any quality).
function countAny(state, itemId) {
  let n = 0;
  for (const [k, c] of Object.entries(state.bag)) if (parseKey(k).id === itemId) n += c;
  return n;
}

// Takes n of an item, Normal copies first, then Fine, then Masterwork.
function takeAny(state, data, itemId, n) {
  let left = n;
  for (const q of data.tools.qualities) {
    if (left <= 0) break;
    const key = itemKey(itemId, q.id);
    const take = Math.min(left, itemCount(state, key));
    if (take > 0) {
      removeItem(state, key, take);
      left -= take;
    }
  }
}

// ---- selectors ----

function describe(state, data, c, slot) {
  const t = templateDef(data, c.template);
  const items = Object.entries(c.items).map(([item, need]) => ({ item, need, have: countAny(state, item) }));
  return {
    slot, template: c.template, giver: t?.giver || 'A villager', note: t?.note || '', items,
    coins: c.coins, renown: c.renown, bonus: c.bonus, done: c.done,
    canDeliver: !c.done && items.every((i) => i.have >= i.need),
  };
}

// Today's board: [{ slot, template, giver, note, items: [{ item, need, have }], coins, renown, bonus, done, canDeliver }].
export function boardList(state, data) {
  return state.village.board.map((c, i) => describe(state, data, c, i));
}

// This week's Great Commission in the same shape (slot 'great'), or null.
export function greatCommission(state, data) {
  return state.village.great ? describe(state, data, state.village.great, 'great') : null;
}

// { free: rerolls left free today, cost: coins for the next one }
export function rerollInfo(state, data) {
  const free = Math.max(0, data.balance.village.freeRerolls - state.village.rerolls);
  return { free, cost: free > 0 ? 0 : data.balance.village.rerollCost };
}

// Badge: today's board is unseen, or something on it (or the Great Commission) can be delivered.
export function villageNotice(state, data) {
  if (!state.village.seen) return true;
  return boardList(state, data).some((c) => c.canDeliver) || !!greatCommission(state, data)?.canDeliver;
}

// What the market pays for one of this bag key (0 = it doesn't buy it).
export function sellPrice(data, key) {
  const def = itemDef(data, key);
  if (!def || !(def.sell > 0)) return 0;
  const mult = data.balance.village.sellQualityMult[parseKey(key).quality] ?? 1;
  return Math.floor(def.sell * mult);
}

// Bag entries the market buys: [{ key, item, count, price }] (bag order is left to the UI).
export function sellList(state, data) {
  return Object.entries(state.bag)
    .filter(([key, n]) => n > 0 && sellPrice(data, key) > 0)
    .map(([key, count]) => ({ key, item: itemDef(data, key), count, price: sellPrice(data, key) }));
}

const lockReason = (state, renown) => (state.renown.rank < (renown || 1) ? `Opens at Renown ${renown}.` : null);

// The market's fixed stock: [{ item, def, price, locked (reason or null), have }].
export function shopList(state, data) {
  return data.market.shop.map((s) => ({ item: s.item, def: data.items.items[s.item], price: s.price, locked: lockReason(state, s.renown), have: itemCount(state, s.item) }));
}

// Recipe scrolls: [{ recipe, def (the recipe), output (item def), price, known, locked }].
export function scrollList(state, data) {
  return data.market.scrolls.map((s) => {
    const r = data.recipes.recipes.find((x) => x.id === s.recipe);
    return { recipe: s.recipe, def: r, output: r && data.items.items[r.output], price: s.price, known: !!state.crafting.known[s.recipe], locked: lockReason(state, s.renown) };
  });
}

// Today's merchant offers: [{ index, item, def, price, left, normal (shop price or null) }].
export function merchantList(state, data) {
  return state.village.merchant.map((m, index) => ({
    index, item: m.item, def: data.items.items[m.item], price: m.price, left: m.left,
    normal: data.market.shop.find((s) => s.item === m.item)?.price ?? null,
  }));
}

// ---- changes ----

function commissionAt(state, slot) {
  const v = state.village;
  return slot === 'great' ? v.great : v.board[slot];
}

export const commands = {
  'village/newDay': (state, _p, ctx) => newDay(state, ctx),
  'village/seen': (state) => {
    state.village.seen = true;
  },
  // slot: 0..boardSize-1, or 'great'
  'village/deliver': (state, { slot }, ctx) => {
    const { data } = ctx;
    const c = commissionAt(state, slot);
    if (!c) throw new Error('That commission is gone.');
    if (c.done) throw new Error('You already delivered that one.');
    for (const [item, n] of Object.entries(c.items)) {
      if (countAny(state, item) < n) throw new Error(`You need ${n - countAny(state, item)} more ${data.items.items[item]?.name || item}.`);
    }
    for (const [item, n] of Object.entries(c.items)) takeAny(state, data, item, n);
    c.done = true;
    earnCoins(state, c.coins);
    for (const [item, n] of Object.entries(c.bonus || {})) addItem(state, item, n);
    if (slot === 'great') state.stats.greats += 1;
    else state.stats.commissions += 1;
    ctx.emit?.({ type: 'commissionDone', slot, template: c.template, coins: c.coins, renown: c.renown, bonus: c.bonus });
    addRenownXp(state, ctx, c.renown, slot === 'great' ? 'great' : 'commission');
  },
  'village/reroll': (state, { slot }, ctx) => {
    const { data } = ctx;
    const v = state.village;
    const c = v.board[slot];
    if (!c) throw new Error('That commission is gone.');
    if (c.done) throw new Error('That one is already delivered.');
    const { cost } = rerollInfo(state, data);
    const next = rollDaily(state, data, v.board.map((b) => b.template));
    if (!next) throw new Error('Nobody else needs anything today.');
    spendCoins(state, cost);
    v.rerolls += 1;
    v.board[slot] = next;
  },
  'market/sell': (state, { item: key, qty }, ctx) => {
    const n = Math.floor(qty);
    const price = sellPrice(ctx.data, key);
    if (!price) throw new Error("Mossbrook's market doesn't buy that.");
    if (!(n >= 1)) throw new Error('Pick how many to sell.');
    if (!removeItem(state, key, n)) throw new Error(`You only have ${itemCount(state, key)}.`);
    earnCoins(state, price * n);
    state.stats.sold += n;
    ctx.emit?.({ type: 'sold', item: key, qty: n, coins: price * n });
  },
  'market/buy': (state, { item, qty = 1 }, ctx) => {
    const s = ctx.data.market.shop.find((x) => x.item === item);
    if (!s) throw new Error("The market doesn't sell that.");
    const locked = lockReason(state, s.renown);
    if (locked) throw new Error(locked);
    const n = Math.floor(qty);
    if (!(n >= 1)) throw new Error('Pick how many to buy.');
    spendCoins(state, s.price * n);
    addItem(state, item, n);
    ctx.emit?.({ type: 'bought', item, qty: n, coins: s.price * n });
  },
  // Buying a scroll teaches its recipe for good (state.crafting.known).
  'market/learn': (state, { recipe }, ctx) => {
    const s = ctx.data.market.scrolls.find((x) => x.recipe === recipe);
    if (!s) throw new Error("The market doesn't have that scroll.");
    if (state.crafting.known[recipe]) throw new Error('You already know that recipe.');
    const locked = lockReason(state, s.renown);
    if (locked) throw new Error(locked);
    spendCoins(state, s.price);
    state.crafting.known[recipe] = true;
    ctx.emit?.({ type: 'learned', recipe, coins: s.price });
  },
  'market/buyMerchant': (state, { index }, ctx) => {
    const m = state.village.merchant[index];
    if (!m) throw new Error('The merchant has moved on.');
    if (m.left < 1) throw new Error('Sold out until next week.');
    spendCoins(state, m.price);
    m.left -= 1;
    addItem(state, m.item, 1);
    ctx.emit?.({ type: 'bought', item: m.item, qty: 1, coins: m.price, merchant: true });
  },
};
