// Pets (docs/design.md "Pets", "Pet energy"): the starter egg, active slots, energy, rest,
// auto-feed from the pantry, pet XP, Bond and the daily pat. Active pets are harvest workers
// (state.workers[petId]); this system decides when they work. A working pet drains energy, eats
// from the pantry when it gets low (auto-feed), and rests at 0 until full.
// Time is stepped event by event (an action finishing, energy reaching the feed line or 0, a
// Bond point from work), so any chunk size gives the same result.
import { deriveSeed } from '../core/rng.js';
import { removeItem, itemDef, itemLabel, parseKey } from './bag.js';
import { actionMs, completeAction, dropStaleTask } from './harvest.js';
import {
  HOUR_MS, archetypeOf, petLevelCap, petXpToNext, petHearts, petMaxEnergy, petDrainPerHour,
  petRestPerHour, petFeedThreshold,
} from './petstats.js';

export const id = 'pets';

const EPS = 1e-6;
// Safety stop for one advance call (16 h of fast actions is far below this).
const MAX_STEPS = 200000;

export function init(state, ctx) {
  const b = ctx.data.balance.pets;
  const p = state.pets;
  if (p.starter === undefined) p.starter = null;
  while (p.active.length < b.activeSlots) p.active.push(null);
  for (const pet of Object.values(p.list)) {
    if (!archetypeOf(ctx.data, pet.archetype)) continue; // unknown archetype: keep the pet, skip defaults
    pet.actions = pet.actions || {};
    if (pet.workMs == null) pet.workMs = 0;
    if (pet.resting == null) pet.resting = false;
    if (pet.autoFeed == null) pet.autoFeed = true;
    pet.energy = Math.min(pet.energy, petMaxEnergy(ctx.data, pet));
  }
  // Exactly the active pets have worker entries.
  const active = new Set(p.active.filter(Boolean));
  for (const wid of Object.keys(state.workers)) if (wid !== 'player' && !active.has(wid)) delete state.workers[wid];
  for (const pid of active) if (!state.workers[pid]) state.workers[pid] = newWorker(state, pid);
}

function newWorker(state, petId) {
  return { task: null, progressMs: 0, rng: deriveSeed(state.rng, 1000 + Number(petId.replace(/\D/g, '')) || 0) };
}

// ---- selectors ----

export function petList(state) {
  return Object.values(state.pets.list).sort((a, b) => a.bornAt - b.bornAt || a.id.localeCompare(b.id));
}

export function getPet(state, petId) {
  return state.pets.list[petId] || null;
}

export function isActive(state, petId) {
  return state.pets.active.includes(petId);
}

export function needsStarter(state) {
  return !state.pets.starter && !Object.keys(state.pets.list).length;
}

export function canPatToday(state, petId, day) {
  const pet = state.pets.list[petId];
  return !!pet && pet.lastPatDay !== day;
}

// What the pet is doing now: 'working' | 'resting' | 'idle' (active, no task) | 'stabled'.
export function petStatus(state, petId) {
  const pet = state.pets.list[petId];
  if (!pet) return null;
  if (!isActive(state, petId)) return 'stabled';
  if (pet.resting) return 'resting';
  return state.workers[petId]?.task ? 'working' : 'idle';
}

// Energy a pet gets from eating one of this bag key (meals of better quality give more), or 0.
export function foodValue(data, key) {
  const def = itemDef(data, key);
  if (!def?.food) return 0;
  return def.quality ? def.food * (data.balance.crafting.mealQuality[parseKey(key).quality] ?? 1) : def.food;
}

export function isFood(data, key) {
  return foodValue(data, key) > 0;
}

// Does this pet's archetype love this dish (fruit, nut, fish, meat)?
export function isFavoriteDish(data, pet, key) {
  const dish = itemDef(data, key)?.dish;
  return !!dish && archetypeOf(data, pet.archetype)?.dish === dish;
}

// Can auto-feed use this item? Only cooked food (balance.pets.energy.autoFeedCategories: meals and
// tonics). Raw food can still be hand-fed; pets that gather it would otherwise never need to rest.
export function canAutoFeed(data, key) {
  return isFood(data, key) && data.balance.pets.energy.autoFeedCategories.includes(itemDef(data, key).category);
}

// Is auto-feed allowed to use this item? (pantry toggle; on unless the player turned it off)
export function pantryAllows(state, itemId) {
  return state.pantry[itemId] !== false;
}

// All food in the bag, for hand-feeding: [{ id (bag key), item, label, food, count, auto, on }], smallest
// first. auto: auto-feed can use it; on: its pantry toggle.
export function foodList(state, data) {
  return Object.entries(state.bag)
    .filter(([id, n]) => n > 0 && isFood(data, id))
    .map(([id, count]) => ({
      id, item: itemDef(data, id), label: itemLabel(data, id), food: foodValue(data, id), count,
      auto: canAutoFeed(data, id), on: pantryAllows(state, id),
    }))
    .sort((a, b) => a.food - b.food || a.id.localeCompare(b.id));
}

// The Pantry: food auto-feed can use (same entries as foodList).
export function pantryList(state, data) {
  return foodList(state, data).filter((e) => e.auto);
}

// The item auto-feed would eat next, or null.
export function nextPantryFood(state, data) {
  return pantryList(state, data).find((e) => e.on)?.id || null;
}

// Hours of work left on the current bar (ignoring food).
export function workHoursLeft(data, pet) {
  return pet.energy / petDrainPerHour(data, pet);
}

// ---- changes ----

export function cleanName(name, data) {
  const max = data.balance.pets.nameMaxLength;
  return String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// Makes a new pet. It takes the first free active slot, or goes to the Stable.
export function createPet(state, ctx, { archetype, quality, name }) {
  const { data } = ctx;
  const p = state.pets;
  const petId = `pet${p.nextId++}`;
  const pet = {
    id: petId,
    name: cleanName(name, data) || archetypeOf(data, archetype).species,
    archetype,
    quality,
    form: 'hatchling',
    branch: null,
    level: 1,
    xp: 0,
    energy: 0,
    resting: false,
    autoFeed: true,
    bond: 0,
    workMs: 0,
    lastPatDay: null,
    bornAt: ctx.now || 0,
    actions: {},
    gifts: [],
    talents: [],
  };
  pet.energy = petMaxEnergy(data, pet);
  p.list[petId] = pet;
  const slot = p.active.indexOf(null);
  if (slot >= 0) {
    p.active[slot] = petId;
    state.workers[petId] = newWorker(state, petId);
  }
  ctx.emit?.({ type: 'petHatched', pet: petId });
  return pet;
}

export function addPetXp(state, ctx, pet, amount) {
  const { data } = ctx;
  pet.xp += amount;
  const cap = petLevelCap(data, pet);
  while (pet.level < cap) {
    const need = petXpToNext(pet.level, data.balance);
    if (pet.xp < need) break;
    pet.xp -= need;
    pet.level += 1;
    ctx.emit?.({ type: 'petLevelUp', pet: pet.id, level: pet.level });
  }
}

export function addBond(state, ctx, pet, amount) {
  const before = petHearts(ctx.data, pet).hearts;
  pet.bond += amount;
  const after = petHearts(ctx.data, pet).hearts;
  if (after > before) ctx.emit?.({ type: 'petHeart', pet: pet.id, hearts: after });
}

function eat(state, ctx, pet, itemId, auto) {
  const food = foodValue(ctx.data, itemId);
  if (!removeItem(state, itemId, 1)) return false;
  pet.energy = Math.min(petMaxEnergy(ctx.data, pet), pet.energy + food);
  const favorite = isFavoriteDish(ctx.data, pet, itemId);
  ctx.emit?.({ type: 'petAte', pet: pet.id, item: itemId, energy: food, auto, favorite });
  if (favorite) addBond(state, ctx, pet, ctx.data.balance.pets.bond.favoriteDish);
  return true;
}

// ---- time ----

// One pet's time: rest, idle recovery, or work broken into steps at each event.
function advancePet(state, ctx, pet, ms) {
  const { data } = ctx;
  const b = data.balance.pets;
  const max = petMaxEnergy(data, pet);
  const active = isActive(state, pet.id);
  const w = state.workers[pet.id];
  if (w) dropStaleTask(data, w);
  let left = ms;
  let workMs = 0;
  let restMs = 0;

  // Not working (stabled, or active with no task): recover energy, no XP.
  if (!active || !w?.task) {
    const rate = petRestPerHour(state, data, pet, { stabled: !active }) / HOUR_MS;
    pet.energy = Math.min(max, pet.energy + rate * ms);
    if (pet.energy >= max - EPS) {
      pet.energy = max;
      pet.resting = false;
    }
    return { workMs, restMs: pet.resting ? ms : 0 };
  }

  const pointMs = b.bond.workMinutesPerPoint * 60000;
  let guard = 0;
  while (left > EPS && guard++ < MAX_STEPS) {
    if (pet.resting) {
      const rate = petRestPerHour(state, data, pet) / HOUR_MS;
      const t = Math.min(left, (max - pet.energy) / rate);
      pet.energy += rate * t;
      left -= t;
      restMs += t;
      if (pet.energy >= max - EPS) {
        pet.energy = max;
        pet.resting = false;
        ctx.emit?.({ type: 'petWoke', pet: pet.id });
      }
      continue;
    }
    const threshold = petFeedThreshold(data, pet);
    if (pet.autoFeed && pet.energy <= threshold + EPS) {
      const food = nextPantryFood(state, data);
      if (food && eat(state, ctx, pet, food, true)) continue;
    }
    if (pet.energy <= EPS) {
      pet.energy = 0;
      pet.resting = true;
      ctx.emit?.({ type: 'petRest', pet: pet.id });
      continue;
    }
    const drain = petDrainPerHour(data, pet) / HOUR_MS;
    const dur = actionMs(state, data, pet.id, w.task);
    const toAction = Math.max(0, dur - w.progressMs);
    const toFeed = pet.autoFeed && pet.energy > threshold + EPS ? (pet.energy - threshold) / drain : Infinity;
    const toZero = drain > 0 ? pet.energy / drain : Infinity;
    const toBond = Math.max(0, pointMs - pet.workMs);
    const t = Math.min(left, toAction, toFeed, toZero, toBond);
    w.progressMs += t;
    pet.energy = Math.max(0, pet.energy - drain * t);
    pet.workMs += t;
    left -= t;
    workMs += t;
    if (pet.workMs >= pointMs - EPS) {
      pet.workMs = Math.max(0, pet.workMs - pointMs);
      addBond(state, ctx, pet, 1);
    }
    if (w.progressMs >= dur - EPS) {
      w.progressMs = Math.max(0, w.progressMs - dur);
      const skill = w.task.skill;
      const { xp } = completeAction(state, ctx, pet.id);
      pet.actions[skill] = (pet.actions[skill] || 0) + 1;
      addPetXp(state, ctx, pet, xp);
    }
  }
  return { workMs, restMs };
}

export function advance(state, ms, ctx) {
  for (const pet of Object.values(state.pets.list)) {
    if (!archetypeOf(ctx.data, pet.archetype)) continue;
    const { workMs, restMs } = advancePet(state, ctx, pet, ms);
    if (workMs > 0 || restMs > 0) ctx.emit?.({ type: 'petTime', pet: pet.id, workMs, restMs });
  }
}

// ---- commands ----

function needPet(state, petId) {
  const pet = state.pets.list[petId];
  if (!pet) throw new Error("That pet isn't here.");
  return pet;
}

export const commands = {
  // The first pet: one of the four eggs from the ruins. It hatches straight away at the starter
  // quality, with the name the player gave it.
  'pets/hatchStarter': (state, { archetype, name }, ctx) => {
    if (!needsStarter(state)) throw new Error('You already have your first pet.');
    if (!archetypeOf(ctx.data, archetype)) throw new Error("That egg isn't here.");
    if (!cleanName(name, ctx.data)) throw new Error('Give your pet a name first.');
    state.pets.starter = archetype;
    createPet(state, ctx, { archetype, quality: ctx.data.balance.pets.starterQuality, name });
  },
  'pets/rename': (state, { pet: petId, name }, ctx) => {
    const pet = needPet(state, petId);
    const clean = cleanName(name, ctx.data);
    if (!clean) throw new Error('A name needs at least one letter.');
    pet.name = clean;
  },
  // The daily pat: Bond once per local calendar day.
  'pets/pat': (state, { pet: petId }, ctx) => {
    const pet = needPet(state, petId);
    if (pet.lastPatDay === ctx.day) throw new Error(`${pet.name} already had a pat today. Come back tomorrow!`);
    pet.lastPatDay = ctx.day;
    addBond(state, ctx, pet, ctx.data.balance.pets.bond.pat);
    ctx.emit?.({ type: 'petPat', pet: petId, bond: ctx.data.balance.pets.bond.pat });
  },
  // Hand-feed one item. Feeding a resting pet wakes it up.
  'pets/feed': (state, { pet: petId, item }, ctx) => {
    const pet = needPet(state, petId);
    if (!isFood(ctx.data, item)) throw new Error("Pets can't eat that.");
    if (!state.bag[item]) throw new Error(`You don't have any ${itemLabel(ctx.data, item)}.`);
    if (pet.energy >= petMaxEnergy(ctx.data, pet) - EPS) throw new Error(`${pet.name} is full of energy.`);
    eat(state, ctx, pet, item, false);
    pet.resting = false;
  },
  'pets/setAutoFeed': (state, { pet: petId, on }) => {
    needPet(state, petId).autoFeed = !!on;
  },
  'pets/setPantry': (state, { item, on }, ctx) => {
    if (!canAutoFeed(ctx.data, item)) throw new Error('Pets only eat cooked meals and tonics on their own.');
    if (on) delete state.pantry[item];
    else state.pantry[item] = false;
  },
  // Put a pet in an active slot. A pet already there moves to the Stable.
  'pets/setActive': (state, { pet: petId, slot }) => {
    needPet(state, petId);
    const p = state.pets;
    if (!Number.isInteger(slot) || slot < 0 || slot >= p.active.length) throw new Error('There is no such slot.');
    const from = p.active.indexOf(petId);
    if (from === slot) return;
    const other = p.active[slot];
    if (from >= 0) p.active[from] = null;
    if (other) delete state.workers[other];
    p.active[slot] = petId;
    if (!state.workers[petId]) state.workers[petId] = newWorker(state, petId);
  },
  'pets/stable': (state, { pet: petId }) => {
    needPet(state, petId);
    const p = state.pets;
    const i = p.active.indexOf(petId);
    if (i < 0) return;
    p.active[i] = null;
    delete state.workers[petId];
  },
};
