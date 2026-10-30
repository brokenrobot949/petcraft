// Pet wishes and tricks (Phase 12, docs/design.md "Pet life" 1 and 7): read-only helpers. The pets system
// rolls, counts and grants wishes and teaches tricks (js/systems/pets.js); these say what a wish could ask for,
// whether one still makes sense, and what to show. Words come from data/wishes.json and data/tricks.json,
// numbers from balance.petLife.wishes and balance.petLife.tricks. Since Phase 13 also the Pet Yard (toys) and day trips
// (balance.petLife.yard, balance.petLife.trips, data/trips.json).
import { itemDef, itemLabel } from './bag.js';
import { zoneUnlocked, workableNodes } from './harvest.js';
import { stationTier } from './crafting.js';
import { skillLevel } from './skills.js';
import { petHearts, petMaxEnergy } from './petstats.js';
import { buildingTier } from './buildings.js';

const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

export function wishKind(data, kind) {
  return data.wishes?.kinds.find((k) => k.id === kind) || null;
}

// Cooked Kitchen meals the player can make now (materials aside): what a Taste wish may ask for.
function cookableMeals(state, data) {
  if (stationTier(state, 'kitchen') < 1) return [];
  const cats = data.balance.pets.energy.autoFeedCategories;
  const out = new Set();
  for (const r of data.recipes.recipes) {
    if (r.station !== 'kitchen') continue;
    const def = itemDef(data, r.output);
    if (!def?.food || def.category !== 'meal' || !cats.includes(def.category)) continue;
    if (r.scroll && !state.crafting.known[r.id]) continue;
    if (skillLevel(state, 'cooking') < (r.level || 1)) continue;
    if (Object.entries(r.needs || {}).some(([s, lvl]) => skillLevel(state, s) < lvl)) continue;
    out.add(r.output);
  }
  return [...out].sort();
}

// What each kind of wish could ask of this pet right now ({ kind: [choices] }); a kind with no choices
// isn't rolled, so every wish can be granted. Play and Trick have one choice: true.
export function wishOptions(state, data, pet) {
  const here = state.workers[pet.id]?.task?.zone || null;
  const zones = data.zones.zones.filter((z) => zoneUnlocked(state, data, z.id)).map((z) => z.id);
  return {
    taste: cookableMeals(state, data),
    outing: zones.length > 1 ? zones.filter((z) => z !== here) : [],
    buddy: Object.keys(state.pets.list).filter((id) => id !== pet.id).sort(),
    play: [true],
    trick: trickInfo(data, pet).canLearn ? [true] : [],
    // Phase 13: a liked toy that isn't in the Pet Yard yet (owned or one the player can make), a trip somewhere.
    toy: toyChoices(state, data, pet),
    trip: Object.keys(state.pets.list).length > 1 ? tripZones(state, data) : [], // an only pet keeps working
  };
}

// Does the pet's wish still make sense (its buddy is still here, its dish and zone still exist)?
export function wishValid(state, data, pet) {
  const w = pet.wish;
  if (!w || !wishKind(data, w.kind)) return false;
  if (w.kind === 'taste') return !!itemDef(data, w.item);
  if (w.kind === 'toy') return itemDef(data, w.item)?.category === 'toy';
  if (w.kind === 'trip') return data.zones.zones.some((z) => z.id === w.zone);
  if (w.kind === 'outing') return data.zones.zones.some((z) => z.id === w.zone);
  if (w.kind === 'buddy') return !!state.pets.list[w.buddy] && w.buddy !== pet.id;
  return true;
}

// Does work time count toward an Outing or Buddy wish? zoneOf: { petId: zone of its task } for the active
// pets with a task (taken at the start of the tick, so a buddy's later steps don't matter).
export function wishWorkCounts(pet, task, zoneOf) {
  const w = pet.wish;
  if (!w || !task) return false;
  if (w.kind === 'outing') return task.zone === w.zone;
  if (w.kind === 'buddy') return zoneOf[w.buddy] != null && zoneOf[w.buddy] === task.zone;
  return false;
}

// For display: { line (what the pet says), need (how to grant it), progress (0..1, Outing / Buddy) or null }.
export function wishText(state, data, pet) {
  const w = pet.wish;
  const def = w && wishKind(data, w.kind);
  if (!def) return null;
  const vars = {
    name: pet.name,
    item: w.item ? itemLabel(data, w.item) : '',
    zone: data.zones.zones.find((z) => z.id === w.zone)?.name || w.zone || '',
    buddy: state.pets.list[w.buddy]?.name || 'a friend',
  };
  const line = fmt(def.lines[(w.line || 0) % def.lines.length], vars);
  const timed = w.kind === 'outing' || w.kind === 'buddy';
  return { line, need: fmt(def.need, vars), progress: timed ? Math.min(1, (w.progressMs || 0) / data.balance.petLife.wishes.workMs) : null };
}

// ---- tricks ----

export function trickDef(data, trickId) {
  return data.tricks?.tricks.find((t) => t.id === trickId) || null;
}

// A pet's tricks: { learned: [defs], current: { def, n } (the one being taught) or null, choices: [defs] it
// could start, slots (one per Bond heart), canStart, canLearn, sessions (lessons per trick) }.
export function trickInfo(data, pet) {
  const sessions = data.balance.petLife.tricks.sessions;
  const all = data.tricks?.tricks || [];
  const started = all.filter((t) => (pet.tricks?.[t.id] || 0) > 0);
  const learned = started.filter((t) => pet.tricks[t.id] >= sessions);
  const cur = started.find((t) => pet.tricks[t.id] < sessions) || null;
  const slots = petHearts(data, pet).hearts;
  const choices = all.filter((t) => !started.includes(t));
  const canStart = !cur && started.length < slots && choices.length > 0;
  return {
    learned, current: cur ? { def: cur, n: pet.tricks[cur.id] } : null, choices, slots, sessions,
    canStart, canLearn: !!cur || canStart,
  };
}

// ---- toys and the Pet Yard (Phase 13) ----

export function isToy(data, itemId) {
  return itemDef(data, itemId)?.category === 'toy';
}

// Toy spots in the Pet Yard: one more per Stable tier (balance.petLife.yard.spotsByStableTier).
export function yardSpots(state, data) {
  const list = data.balance.petLife.yard.spotsByStableTier;
  return list[Math.max(0, Math.min(list.length, buildingTier(state, 'stable')) - 1)] || 0;
}

// Is a toy this pet's archetype likes in the Pet Yard?
export function likesYard(state, data, pet) {
  return (state.yard?.toys || []).some((t) => itemDef(data, t)?.likes === pet.archetype);
}

// A stabled pet at home: not in an active slot, not posted at a station, not on a day trip.
export function atHome(state, pet) {
  return !state.pets.active.includes(pet.id) && !pet.trip && !Object.values(state.crafting?.assists || {}).includes(pet.id);
}

// Can the player make this toy now (station built, skill level, needs; materials aside)?
function toyRecipeOpen(state, data, toyId) {
  const r = data.recipes.recipes.find((x) => x.output === toyId);
  const station = r && data.recipes.stations.find((s) => s.id === r.station);
  if (!station || stationTier(state, r.station) < 1) return false;
  if (skillLevel(state, station.skill) < (r.level || 1)) return false;
  return !Object.entries(r.needs || {}).some(([s, lvl]) => skillLevel(state, s) < lvl);
}

// Toys a Toy wish may ask for: liked by the pet, not in the yard yet, owned or makeable.
function toyChoices(state, data, pet) {
  if (yardSpots(state, data) < 1) return [];
  const placed = new Set(state.yard?.toys || []);
  return Object.entries(data.items.items)
    .filter(([id, d]) => d.category === 'toy' && d.likes === pet.archetype && !placed.has(id)
      && ((state.bag[id] || 0) > 0 || toyRecipeOpen(state, data, id)))
    .map(([id]) => id)
    .sort();
}

// ---- day trips (Phase 13) ----

// Zones a pet can visit: unlocked, with at least one node the player can work.
export function tripZones(state, data) {
  return data.zones.zones.filter((z) => zoneUnlocked(state, data, z.id) && workableNodes(state, data, z.id).length).map((z) => z.id);
}

// Energy a trip of `hours` costs this pet (balance.petLife.trips.energyFracPerHour of its max energy an hour).
export function tripCost(data, pet, hours) {
  return petMaxEnergy(data, pet) * data.balance.petLife.trips.energyFracPerHour * hours;
}

// Can the pet leave on a trip? { can, reason }.
export function tripInfo(state, data, petId, zoneId, hours) {
  const pet = state.pets.list[petId];
  const no = (reason) => ({ can: false, reason });
  if (!pet) return no("That pet isn't here.");
  if (pet.trip) return no(`${pet.name} is already on a trip.`);
  if (state.pets.active.includes(petId)) return no(`${pet.name} is working. Send them to the Stable first.`);
  if (Object.values(state.crafting?.assists || {}).includes(petId)) return no(`${pet.name} is helping at a station. Call them back first.`);
  if (!data.balance.petLife.trips.hours.includes(hours)) return no('Choose how long the trip lasts.');
  if (!tripZones(state, data).includes(zoneId)) return no("Your pet can't go there yet.");
  if (pet.energy + 1e-6 < tripCost(data, pet, hours)) return no(`${pet.name} needs more energy for a trip that long.`);
  return { can: true, reason: '' };
}
