// The Garden (docs/design.md "Homestead"): plots by Garden tier (balance.buildings.gardenPlotsByTier,
// none while the plot is empty). Plant a seed from the bag (seeds come from the market, pine seeds
// from pine trees); it grows for its seed's minutes (items.json "seed"), then its crop goes
// straight to the bag. With auto-replant on (the default) the plot plants another seed of the same
// kind from the bag and carries the leftover time, so a stocked garden keeps going offline.
// Each plot rolls from its own random stream, so any chunk size gives the same harvests (the one
// exception: two plots replanting from the last seeds in the bag in the same chunk).
// Not built yet: fertilizer (Alchemy) and the Terraced Gardens bonus.
import { deriveSeed, randomInt } from '../core/rng.js';
import { addItem, removeItem } from './bag.js';
import { buildingTier } from './buildings.js';

export const id = 'garden';

const EPS = 1e-6;

export function init(state, ctx) {
  if (!Number.isFinite(state.stats.garden)) state.stats.garden = 0;
  ensurePlots(state, ctx.data);
}

export function plotCount(state, data) {
  const tier = buildingTier(state, 'garden');
  const list = data.balance.buildings.gardenPlotsByTier;
  return tier > 0 ? list[Math.min(list.length, tier) - 1] : 0;
}

// Plots only ever get added (an upgrade); they are never taken away.
function ensurePlots(state, data) {
  const g = state.garden;
  const n = plotCount(state, data);
  while (g.plots.length < n) g.plots.push({ seed: null, ms: 0, auto: true, rng: deriveSeed(g.rng, g.plots.length + 1) });
}

export function seedDef(data, itemId) {
  return data.items.items[itemId]?.seed || null;
}

// One crop's growing time (ms) at the current speed.
export function growMs(data, itemId) {
  const s = seedDef(data, itemId);
  return s ? (s.minutes * 60000) / data.balance.garden.growSpeed : Infinity;
}

// ---- selectors ----

// [{ index, seed, crop, ms, growMs, left, auto }] (seed and crop are item ids, null when empty).
export function plotList(state, data) {
  return state.garden.plots.map((p, index) => {
    const s = p.seed && seedDef(data, p.seed);
    const total = p.seed ? growMs(data, p.seed) : 0;
    return { index, seed: p.seed, crop: s?.crop || null, ms: p.ms, growMs: total, left: Math.max(0, total - p.ms), auto: p.auto };
  });
}

// Seeds in the bag that can be planted: [{ id, item, count, crop, minutes, yield }].
export function seedList(state, data) {
  return Object.entries(state.bag)
    .filter(([key, n]) => n > 0 && seedDef(data, key))
    .map(([id, count]) => ({ id, item: data.items.items[id], count, ...seedDef(data, id) }));
}

// ---- time ----

export function advance(state, ms, ctx) {
  const { data } = ctx;
  ensurePlots(state, data);
  state.garden.plots.forEach((p, index) => {
    if (!p.seed) return;
    p.ms += ms;
    let dur = growMs(data, p.seed);
    while (p.seed && p.ms >= dur - EPS) {
      const s = seedDef(data, p.seed);
      const qty = randomInt(p, s.yield[0], s.yield[1]);
      addItem(state, s.crop, qty);
      state.stats.garden += 1;
      ctx.emit?.({ type: 'gardenHarvest', plot: index, seed: p.seed, item: s.crop, qty });
      p.ms = Math.max(0, p.ms - dur);
      if (!(p.auto && removeItem(state, p.seed, 1))) {
        p.seed = null;
        p.ms = 0;
      }
      dur = p.seed ? growMs(data, p.seed) : Infinity;
    }
  });
}

// ---- commands ----

function plotAt(state, data, index) {
  ensurePlots(state, data);
  const p = state.garden.plots[index];
  if (!p) throw new Error(state.garden.plots.length ? "There's no such plot." : 'Build the Garden first.');
  return p;
}

export const commands = {
  'garden/plant': (state, { plot, seed }, ctx) => {
    const p = plotAt(state, ctx.data, plot);
    if (p.seed) throw new Error('Something is already growing there.');
    if (!seedDef(ctx.data, seed)) throw new Error("That won't grow in a garden.");
    if (!removeItem(state, seed, 1)) throw new Error(`You don't have any ${ctx.data.items.items[seed]?.name || 'seeds'}.`);
    p.seed = seed;
    p.ms = 0;
  },
  // Digs up a growing crop; its seed comes back.
  'garden/clear': (state, { plot }, ctx) => {
    const p = plotAt(state, ctx.data, plot);
    if (!p.seed) return;
    addItem(state, p.seed, 1);
    p.seed = null;
    p.ms = 0;
  },
  'garden/auto': (state, { plot, on }, ctx) => {
    plotAt(state, ctx.data, plot).auto = !!on;
  },
};

