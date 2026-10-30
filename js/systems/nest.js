// The Nest (docs/design.md "Eggs", "Homestead"): egg items (from treasure or the merchant) are
// placed in the Nest's slots, where they warm for hatchHours of game time (shorter at higher Nest
// tiers, offline too). A ready egg waits until the player hatches and names it. The archetype and
// quality are rolled when the egg is placed (from the Nest's own stream); the UI shows the egg's
// colors (its archetype) but keeps the quality a surprise until it hatches.
// state.nest = { slots: [NestEgg | null], rng } (docs/architecture.md "Phase 7").
import { randomInt } from '../core/rng.js';
import { removeItem, itemDef, itemLabel } from './bag.js';
import { buildingTier } from './buildings.js';
import { createPet, cleanName } from './pets.js';
import { rollQuality, freePetSpaces } from './taming.js';
import { takeHeirEgg } from './elders.js';

export const id = 'nest';

const EPS = 1e-6;
const HOUR_MS = 3600 * 1000;

export function init(state, ctx) {
  if (state.stats.hatched == null) state.stats.hatched = 0;
  const slots = state.nest.slots;
  const n = eggSlots(state, ctx.data);
  while (slots.length < n) slots.push(null);
  // Never drop an egg; only empty slots beyond the tier's count go.
  while (slots.length > n && slots[slots.length - 1] === null) slots.pop();
}

// ---- selectors ----

export function eggSlots(state, data) {
  const tier = buildingTier(state, 'nest');
  const list = data.balance.buildings.nestEggSlotsByTier;
  return tier < 1 ? 0 : list[Math.min(tier, list.length) - 1];
}

export function hatchMs(state, data) {
  const tier = Math.max(1, buildingTier(state, 'nest'));
  return data.balance.nest.hatchHours * HOUR_MS * Math.max(0, 1 - data.balance.buildings.nestHatchCutPerTier * (tier - 1));
}

// [{ slot, egg, archetype, msLeft, total, ready }]; egg is the item def (null for an empty slot).
export function nestList(state, data) {
  const total = hatchMs(state, data);
  const n = Math.max(eggSlots(state, data), state.nest.slots.length);
  const list = [];
  for (let slot = 0; slot < n; slot++) {
    const e = state.nest.slots[slot] || null;
    list.push({
      slot,
      egg: e ? itemDef(data, e.item) : null,
      archetype: e ? e.archetype : null,
      heir: e?.heir ? { ...e.heir, name: state.elders.list.find((x) => x.id === e.heir.elder)?.name || '' } : null, // an heir egg: its elder parent

      msLeft: e ? e.msLeft : 0,
      total,
      ready: !!e && e.msLeft <= EPS,
    });
  }
  return list;
}

// Egg items in the bag: [{ key, item, count }].
export function eggList(state, data) {
  return Object.entries(state.bag)
    .filter(([key, n]) => n > 0 && itemDef(data, key)?.egg)
    .map(([key, count]) => ({ key, item: itemDef(data, key), count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// Badge: an egg is ready to hatch.
export function nestNotice(state) {
  return state.nest.slots.some((e) => e && e.msLeft <= EPS);
}

// ---- time ----

export function advance(state, ms, ctx) {
  state.nest.slots.forEach((e, slot) => {
    if (!e || e.msLeft <= EPS) return;
    e.msLeft = Math.max(0, e.msLeft - ms);
    if (e.msLeft <= EPS) ctx.emit?.({ type: 'eggReady', slot });
  });
}

// ---- commands ----

export const commands = {
  'nest/place': (state, { item, slot = null }, ctx) => {
    const { data } = ctx;
    const def = itemDef(data, item);
    if (!def?.egg) throw new Error("That isn't an egg.");
    if (!state.bag[item]) throw new Error(`You don't have a ${itemLabel(data, item)}.`);
    const n = eggSlots(state, data);
    if (n <= 0) throw new Error('Build the Nest first (it opens at Renown 8).');
    const slots = state.nest.slots;
    while (slots.length < n) slots.push(null); // the Nest may have been upgraded since load
    const at = slot === null ? slots.findIndex((e, i) => !e && i < n) : slot;
    if (!Number.isInteger(at) || at < 0 || at >= n) throw new Error('Every Nest slot is taken. Upgrade the Nest for more.');
    if (slots[at]) throw new Error('That Nest slot already holds an egg.');
    removeItem(state, item, 1);
    const types = data.pets.archetypes;
    const archetype = types[randomInt(state.nest, 0, types.length - 1)].id;
    const quality = rollQuality(state.nest, data, { bands: def.egg.bands || 0, min: def.egg.min || null });
    slots[at] = { item, archetype, quality, msLeft: hatchMs(state, data) };
    ctx.emit?.({ type: 'eggPlaced', slot: at, archetype });
  },
  // An heir egg from the Elder Grove (egg: its index in the waiting list). Its archetype and quality
  // were fixed when its parent retired.
  'nest/placeHeir': (state, { egg, slot = null }, ctx) => {
    const { data } = ctx;
    if (!state.elders.eggs[egg]) throw new Error("That heir egg isn't here.");
    const n = eggSlots(state, data);
    if (n <= 0) throw new Error('Build the Nest first (it opens at Renown 8).');
    const slots = state.nest.slots;
    while (slots.length < n) slots.push(null);
    const at = slot === null ? slots.findIndex((e, i) => !e && i < n) : slot;
    if (!Number.isInteger(at) || at < 0 || at >= n) throw new Error('Every Nest slot is taken. Upgrade the Nest for more.');
    if (slots[at]) throw new Error('That Nest slot already holds an egg.');
    const h = takeHeirEgg(state, egg);
    slots[at] = { item: 'heir_egg', archetype: h.archetype, quality: h.quality, msLeft: hatchMs(state, data), heir: { elder: h.elder, heirloom: h.heirloom } };
    ctx.emit?.({ type: 'eggPlaced', slot: at, archetype: h.archetype });
  },
  'nest/hatch': (state, { slot, name }, ctx) => {
    const e = state.nest.slots[slot];
    if (!e) throw new Error("There's no egg there.");
    if (e.msLeft > EPS) throw new Error("This egg isn't ready to hatch yet.");
    if (freePetSpaces(state, ctx.data) <= 0) throw new Error('No room for another pet. Upgrade the Stable or release a pet.');
    createPet(state, ctx, { archetype: e.archetype, quality: e.quality, name: cleanName(name, ctx.data), heirloom: e.heir?.heirloom || null, parent: e.heir?.elder || null, how: e.heir ? 'heir' : 'egg' });
    state.nest.slots[slot] = null;
    state.stats.hatched += 1;
  },
};
