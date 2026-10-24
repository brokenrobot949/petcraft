// Treasure (docs/design.md "Treasure"): maps drop while harvesting (harvest.completeAction) and are
// bag items, one kind per zone. The player digs a zone's map up with the Shovel: a timed task like
// harvesting, whose progress is kept per zone when the player switches task. A finished dig uses
// the map and pays coins, loot from data/treasure.json, sometimes a Sanctuary Relic or an egg.
// state.treasure = { progress: { zone: ms }, rng } (docs/architecture.md "Phase 7").
import { random, randomInt, chance } from '../core/rng.js';
import { addItem, removeItem } from './bag.js';
import { earnCoins } from './coins.js';
import { zoneUnlocked, isHarvestTask, mapItemFor } from './harvest.js';

export const id = 'treasure';
export { mapItemFor };

const EPS = 1e-6;

export function init(state, ctx) {
  if (state.stats.digs == null) state.stats.digs = 0;
  if (state.stats.maps == null) state.stats.maps = 0;
  const w = state.workers.player;
  if (w.task?.skill === 'treasure' && !mapItemFor(ctx.data, w.task.zone)) {
    w.task = null;
    w.progressMs = 0;
  }
}

function zoneById(data, zoneId) {
  return data.zones.zones.find((z) => z.id === zoneId) || null;
}

// ---- selectors ----

export function mapCount(state, data, zoneId) {
  const item = mapItemFor(data, zoneId);
  return item ? state.bag[item] || 0 : 0;
}

// Length of one dig with the equipped Shovel (its tier and quality only change the speed).
export function digMs(state, data) {
  const b = data.balance.treasure;
  const eq = state.tools.shovel;
  const tier = data.items.items[eq?.item]?.tier || 1;
  const speed = 1 + b.shovelSpeedPerTier * (tier - 1) + (data.balance.harvest.toolQualitySpeed[eq?.quality] || 0);
  return (b.digMinutes * 60000) / speed;
}

export function digInfo(state, data, zoneId) {
  const t = state.workers.player.task;
  return {
    maps: mapCount(state, data, zoneId),
    ms: state.treasure.progress[zoneId] || 0,
    total: digMs(state, data),
    digging: t?.skill === 'treasure' && t.zone === zoneId,
  };
}

// Every zone the player holds maps for: [{ zone, item, count }] in zone order.
export function mapList(state, data) {
  return data.zones.zones
    .map((z) => ({ zone: z.id, item: mapItemFor(data, z.id), count: mapCount(state, data, z.id) }))
    .filter((e) => e.count > 0);
}

// ---- time ----

// The current dig finishing: the tick stops there so the next task starts on time.
export function nextBoundaryMs(state, ctx) {
  const t = state.workers.player.task;
  if (t?.skill !== 'treasure') return Infinity;
  const left = digMs(state, ctx.data) - (state.treasure.progress[t.zone] || 0);
  return left > EPS ? left : Infinity;
}

function pickWeighted(stream, list) {
  const total = list.reduce((sum, e) => sum + (e.weight || 1), 0);
  let r = random(stream) * total;
  for (const e of list) {
    r -= e.weight || 1;
    if (r < 0) return e;
  }
  return list[list.length - 1];
}

// Uses one map and rolls the reward (from the treasure stream).
function finishDig(state, ctx, zoneId) {
  const { data } = ctx;
  const b = data.balance.treasure;
  const tr = state.treasure;
  removeItem(state, mapItemFor(data, zoneId), 1);
  const tier = zoneById(data, zoneId).tier;
  const i = Math.min(tier, b.byTier.rolls.length) - 1;
  const [lo, hi] = b.byTier.coins[i];
  const coins = randomInt(tr, lo, hi);
  earnCoins(state, coins);
  const items = {};
  const add = (item, n) => {
    items[item] = (items[item] || 0) + n;
  };
  const loot = data.treasure.loot[String(tier)] || [];
  for (let r = 0; r < b.byTier.rolls[i] && loot.length; r++) {
    const pick = pickWeighted(tr, loot);
    add(pick.item, randomInt(tr, pick.qty[0], pick.qty[1]));
  }
  if (chance(tr, b.byTier.relic[i])) add(data.treasure.relicItem, 1);
  if (chance(tr, b.eggChance)) add(data.treasure.eggItem, 1);
  for (const [item, n] of Object.entries(items)) addItem(state, item, n);
  state.stats.digs += 1;
  ctx.emit?.({ type: 'dig', zone: zoneId, coins, items });
}

// No maps left: back to the harvest task from before digging (with the rest of the span), or idle.
function stopDigging(w, leftMs) {
  w.task = w.resume || null;
  w.resume = null;
  w.progressMs = w.task ? leftMs : 0;
}

export function advance(state, ms, ctx) {
  const w = state.workers.player;
  if (w.task?.skill !== 'treasure') return;
  const zoneId = w.task.zone;
  const p = state.treasure.progress;
  let left = ms;
  while (left > EPS) {
    if (mapCount(state, ctx.data, zoneId) <= 0) {
      stopDigging(w, left);
      return;
    }
    const total = digMs(state, ctx.data);
    const step = Math.min(left, Math.max(0, total - (p[zoneId] || 0)));
    p[zoneId] = (p[zoneId] || 0) + step;
    left -= step;
    if (p[zoneId] >= total - EPS) {
      delete p[zoneId];
      finishDig(state, ctx, zoneId);
    }
  }
  if (mapCount(state, ctx.data, zoneId) <= 0) stopDigging(w, 0);
}

// ---- commands ----

export const commands = {
  // The player digs up this zone's maps one after another. A harvest task is remembered and taken
  // up again when the maps run out.
  'treasure/dig': (state, { zone: zoneId }, ctx) => {
    const zone = zoneById(ctx.data, zoneId);
    if (!zone || !mapItemFor(ctx.data, zoneId)) throw new Error("There's no treasure to find there.");
    if (!zoneUnlocked(state, ctx.data, zoneId)) throw new Error(`${zone.name} isn't open yet.`);
    if (mapCount(state, ctx.data, zoneId) <= 0) throw new Error(`You have no ${zone.name} maps. They turn up while harvesting.`);
    const w = state.workers.player;
    if (w.task?.skill === 'treasure' && w.task.zone === zoneId) return;
    if (isHarvestTask(ctx.data, w.task)) w.resume = w.task;
    w.task = { zone: zoneId, skill: 'treasure', node: 'dig' };
    w.progressMs = 0;
  },
};
