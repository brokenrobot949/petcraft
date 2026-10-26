// Pets (docs/design.md "Pets", "Pet energy", "Evolution and talents"): the starter egg, active
// slots, energy, rest, auto-feed from the pantry, pet XP, Bond and the daily pat; since Phase 8
// evolution (calling -> branch -> catalyst), talent picks, gift talents, a personal favorite dish,
// Heart 4 gifts, station assistants and Scout pets digging treasure.
// Active pets are harvest workers (state.workers[petId]); this system decides when they work. A
// working pet drains energy, eats from the pantry when it gets low (auto-feed), and rests at 0
// until full. Time is stepped event by event (an action or dig finishing, energy reaching the feed
// line or 0, a Bond point from work), so any chunk size gives the same result.
// Random rolls: harvest and gifts from the pet's worker stream; talent offers, gift talents and the
// favorite dish from the pet's own stream (pet.rng).
import { deriveSeed, random, chance, randomInt } from '../core/rng.js';
import { petSeed } from '../core/state.js';
import { addItem, removeItem, itemDef, itemLabel, parseKey } from './bag.js';
import { actionProfile, completeAction, dropStaleTask } from './harvest.js';
import {
  HOUR_MS, archetypeOf, petLevelCap, petXpToNext, petHearts, petMaxEnergy, petDrainPerHour,
  petRestPerHour, petFeedThreshold, petStage, branchDef, talentDef, effectValue, canDig, petSpecies, mythicDef,
} from './petstats.js';
import { sanctuaryBonus } from './sanctuary.js';
import { petCapacity, buildingTier } from './buildings.js';
import { mapCount, digMs, finishDig, pickLoot } from './treasure.js';
import { recordPet } from './bestiary.js';

export const id = 'pets';

const EPS = 1e-6;
// Safety stop for one advance call (16 h of fast actions is far below this).
const MAX_STEPS = 200000;

export function init(state, ctx) {
  const { data } = ctx;
  const b = data.balance.pets;
  const p = state.pets;
  if (p.starter === undefined) p.starter = null;
  if (state.stats.released == null) state.stats.released = 0;
  if (!state.stats.evolved) state.stats.evolved = { juvenile: 0, adult: 0 };
  if (state.stats.talentPicks == null) state.stats.talentPicks = 0;
  if (state.stats.petGifts == null) state.stats.petGifts = 0;
  while (p.active.length < b.activeSlots) p.active.push(null);
  for (const pet of Object.values(p.list)) {
    if (!archetypeOf(data, pet.archetype)) continue; // unknown archetype: keep the pet, skip defaults
    pet.actions = pet.actions || {};
    if (pet.workMs == null) pet.workMs = 0;
    if (pet.resting == null) pet.resting = false;
    if (pet.autoFeed == null) pet.autoFeed = true;
    if (!Number.isInteger(pet.rng)) pet.rng = petSeed(state.rng, pet.id);
    if (!Array.isArray(pet.talents)) pet.talents = [];
    if (!Array.isArray(pet.gifts)) pet.gifts = [];
    if (pet.offer === undefined) pet.offer = null;
    if (pet.favoriteKnown == null) pet.favoriteKnown = false;
    if (pet.heirloom === undefined) pet.heirloom = null;
    if (pet.parent === undefined) pet.parent = null;
    // A form or branch the data no longer has falls back to the hatchling.
    const known = pet.form === 'mythic' ? !!mythicDef(data, pet.archetype) : branchDef(data, pet.archetype, pet.branch);
    if (pet.form !== 'hatchling' && !known) {
      pet.form = 'hatchling';
      pet.branch = null;
    }
    pet.talents = pet.talents.filter((t) => talentDef(data, t));
    pet.gifts = pet.gifts.filter((t) => talentDef(data, t));
    if (pet.heirloom && !talentDef(data, pet.heirloom)) pet.heirloom = null;
    if (pet.offer) pet.offer = pet.offer.filter((t) => talentDef(data, t) && !holds(pet, t));
    if (pet.offer && !pet.offer.length) pet.offer = null;
    rollBirthTraits(data, pet);
    ensureOffer(ctx, pet);
    pet.energy = Math.min(pet.energy, petMaxEnergy(data, pet));
  }
  // Exactly the active pets have worker entries.
  const active = new Set(p.active.filter(Boolean));
  for (const wid of Object.keys(state.workers)) if (wid !== 'player' && !active.has(wid)) delete state.workers[wid];
  for (const pid of active) if (!state.workers[pid]) state.workers[pid] = newWorker(state, pid);
  for (const pid of active) {
    const w = state.workers[pid];
    if (w.resume === undefined) w.resume = null;
    if (w.task?.skill === 'treasure' && !canDig(data, p.list[pid])) {
      w.task = null;
      w.progressMs = 0;
    }
  }
}

function newWorker(state, petId) {
  return { task: null, progressMs: 0, rng: deriveSeed(state.rng, 1000 + Number(petId.replace(/\D/g, '')) || 0), resume: null };
}

// ---- birth traits and talent offers (from the pet's own stream) ----

const holds = (pet, t) => pet.talents.includes(t) || pet.gifts.includes(t) || pet.heirloom === t;

function pickDistinct(pet, list, n) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(random(pet) * pool.length), 1)[0]);
  return out;
}

// Gift talents for the pet's quality (rolled once; a save from before Phase 8 gets them on load) and
// a personal favorite dish (a cooked meal up to personalDishMaxTier; a favorite that isn't one is rerolled).
function rollBirthTraits(data, pet) {
  const want = data.balance.pets.qualities[pet.quality]?.gifts || 0;
  if (pet.gifts.length < want && data.talents) {
    const pool = (data.talents.pools.gift || []).filter((t) => talentDef(data, t) && !holds(pet, t));
    pet.gifts.push(...pickDistinct(pet, pool, want - pet.gifts.length));
  }
  if (!pet.favorite || itemDef(data, pet.favorite)?.category !== 'meal' || !canAutoFeed(data, pet.favorite)) {
    const maxTier = data.balance.pets.bond.personalDishMaxTier;
    const kitchen = new Set((data.recipes?.recipes || []).filter((r) => r.station === 'kitchen').map((r) => r.output));
    const meals = Object.entries(data.items.items)
      .filter(([itemId, d]) => d.category === 'meal' && d.food && (d.tier || 1) <= maxTier && kitchen.has(itemId)
        && canAutoFeed(data, itemId))
      .map(([itemId]) => itemId)
      .sort();
    pet.favorite = meals.length ? meals[Math.floor(random(pet) * meals.length)] : null;
    pet.favoriteKnown = false;
  }
}

// Talent picks the pet has earned but not made yet.
export function talentPicksDue(data, pet) {
  const levels = data.balance.pets.talents.pickLevels;
  return Math.max(0, levels.filter((l) => l <= pet.level).length - pet.talents.length);
}

// The pool for the pet's next pick: the hatchling pool up to the first evolution level, then its
// branch's pool (mythics: the 'mythic' pool). A pool that runs short is topped up from the hatchling pool.
function nextPickCandidates(data, pet) {
  const levels = data.balance.pets.talents.pickLevels;
  const level = levels[pet.talents.length];
  const pools = data.talents?.pools || {};
  const usable = (list) => (list || []).filter((t) => talentDef(data, t) && !holds(pet, t));
  const poolId = pet.form === 'mythic' ? 'mythic' : pet.branch;
  const branchPool = level > data.balance.pets.stageLevelCaps[0] && poolId ? usable(pools[poolId]) : [];
  const own = branchPool.length ? branchPool : usable(pools.hatchling);
  const n = data.balance.pets.talents.choices;
  if (own.length >= n) return { list: own, n };
  return { list: [...own, ...usable(pools.hatchling).filter((t) => !own.includes(t))], n, short: own };
}

// Rolls the choices for the pet's next talent pick, if one is due and none is on offer.
function ensureOffer(ctx, pet) {
  if (pet.offer || talentPicksDue(ctx.data, pet) <= 0) return;
  const { list, n, short } = nextPickCandidates(ctx.data, pet);
  const offer = short ? [...short, ...pickDistinct(pet, list.filter((t) => !short.includes(t)), n - short.length)] : pickDistinct(pet, list, n);
  if (!offer.length) return;
  pet.offer = offer;
  ctx.emit?.({ type: 'talentReady', pet: pet.id });
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

// Can a pet eat this item? Only cooked food (balance.pets.energy.autoFeedCategories: meals and
// tonics), by hand or on its own (Rob, 2026-10-26). Raw food is for cooking.
export function canAutoFeed(data, key) {
  return isFood(data, key) && data.balance.pets.energy.autoFeedCategories.includes(itemDef(data, key).category);
}

// Is auto-feed allowed to use this item? (pantry toggle; on unless the player turned it off)
export function pantryAllows(state, itemId) {
  return state.pantry[itemId] !== false;
}

// Cooked food in the bag, for hand-feeding: [{ id (bag key), item, label, food, count, auto, on }], smallest
// first. auto: auto-feed can use it (always, now that pets eat only cooked food); on: its pantry toggle.
export function foodList(state, data) {
  return Object.entries(state.bag)
    .filter(([id, n]) => n > 0 && canAutoFeed(data, id))
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


// ---- evolution, talents and assists (selectors) ----

// What the pet's next evolution needs. next: 'juvenile' | 'adult' | null (fully grown).
// branches: the archetype's two branches with calling progress (hatchlings) or the pet's own branch.
export function evolveInfo(state, data, petId) {
  const pet = state.pets.list[petId];
  const b = data.balance.pets;
  const arch = archetypeOf(data, pet.archetype);
  const stage = petStage(data, pet);
  const next = stage === 1 ? 'juvenile' : stage === 2 ? 'adult' : null;
  const levelNeed = next ? b.stageLevelCaps[stage - 1] : null;
  const branches = (arch?.branches || []).map((br) => {
    const have = Math.floor(pet.actions?.[br.calling] || 0);
    return { ...br, have: Math.min(have, b.callingActions), need: b.callingActions, unlocked: have >= b.callingActions };
  });
  const out = { stage, form: pet.form, next, levelNeed, level: pet.level, branches, ready: false, reason: '', heartsNeed: null, hearts: petHearts(data, pet).hearts, catalyst: null };
  if (!next) return out;
  if (pet.level < levelNeed) {
    out.reason = `Reaches level ${levelNeed} first.`;
  } else if (next === 'juvenile') {
    out.ready = branches.some((br) => br.unlocked);
    if (!out.ready) out.reason = `Needs ${b.callingActions} actions of one path's skill to choose it.`;
  }
  if (next === 'adult') {
    const br = branchDef(data, pet.archetype, pet.branch);
    out.heartsNeed = b.evolve.adultHearts;
    out.catalyst = br?.catalyst ? { item: br.catalyst, have: state.bag[br.catalyst] || 0 } : null;
    if (!out.reason) {
      if (out.hearts < out.heartsNeed) out.reason = `Needs Bond heart ${out.heartsNeed}.`;
      else if (out.catalyst && out.catalyst.have < 1) out.reason = `Needs a ${itemDef(data, out.catalyst.item)?.name || out.catalyst.item} from the Alchemy Lab.`;
      else out.ready = true;
    }
  }
  return out;
}

// Talents: { gifts: [id], picks: [{ level, talent | null }], due, offer: [id] | null }.
export function talentInfo(state, data, petId) {
  const pet = state.pets.list[petId];
  const picks = data.balance.pets.talents.pickLevels.map((level, i) => ({ level, talent: pet.talents[i] || null }));
  return { gifts: [...pet.gifts], picks, due: talentPicksDue(data, pet), offer: pet.offer ? [...pet.offer] : null };
}

// The station this pet's branch can assist at (null for Scouts and young pets), and whether it can
// be posted now. { station, posted, can, reason }
export function assistInfo(state, data, petId) {
  const pet = state.pets.list[petId];
  const br = branchDef(data, pet.archetype, pet.branch);
  const station = br?.assist?.station || null;
  const posted = Object.keys(state.crafting.assists).find((s) => state.crafting.assists[s] === petId) || null;
  let reason = '';
  if (pet.form === 'mythic') reason = `${petSpecies(data, pet)} roams the fields instead of helping at a station.`;
  else if (!station) reason = pet.form === 'adult' ? `${petSpecies(data, pet)} digs for treasure instead of helping at a station.` : 'Adults can help at a crafting station.';
  else if (pet.form !== 'adult') reason = 'Adults can help at a crafting station.';
  else if (isActive(state, petId)) reason = 'Send it to the Stable first: only resting pets can help.';
  else if (buildingTier(state, station) < 1) reason = 'Build that station first.';
  return { station, posted, can: !reason, reason, bonus: br?.assist || null };
}

// Is this a valid assistant for the station right now? (adult, stabled, its branch's station)
export function assistValid(state, data, stationId, petId) {
  const pet = state.pets.list[petId];
  if (!pet || pet.form !== 'adult' || isActive(state, petId)) return false;
  return branchDef(data, pet.archetype, pet.branch)?.assist?.station === stationId && buildingTier(state, stationId) > 0;
}

// Pets tab badge: a pet can evolve or has a talent to pick.
export function petNotice(state, data) {
  return Object.values(state.pets.list).some((pet) => archetypeOf(data, pet.archetype) && (pet.offer || evolveInfo(state, data, pet.id).ready));
}

// How long one dig takes this pet (the player's Shovel, faster with the Scout's dig bonus).
export function petDigMs(state, data, pet) {
  return digMs(state, data) / (1 + effectValue(data, pet, 'dig'));
}
// ---- changes ----

export function cleanName(name, data) {
  const max = data.balance.pets.nameMaxLength;
  return String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// Makes a new pet. It takes the first free active slot, or goes to the Stable.
// Refused when every active slot and Stable space is taken (saves already over the limit keep their pets),
// unless force is set: a trap that was set with a space held for its catch always delivers it.
// Its gift talents (from its quality) and favorite dish are rolled from its own stream.
// mythic: a single-form mythic pet (Heartgrove). heirloom / parent: an heir egg's inherited talent and elder.
export function createPet(state, ctx, { archetype, quality, name, mythic = false, heirloom = null, parent = null }, { force = false } = {}) {
  const { data } = ctx;
  const p = state.pets;
  if (!force && Object.keys(p.list).length >= petCapacity(state, data)) {
    throw new Error('The Stable is full. Upgrade it to make room for more pets.');
  }
  const petId = `pet${p.nextId++}`;
  const species = mythic ? mythicDef(data, archetype)?.species : archetypeOf(data, archetype).species;
  const pet = {
    id: petId,
    name: cleanName(name, data) || species,
    archetype,
    quality,
    form: mythic ? 'mythic' : 'hatchling',
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
    offer: null,
    favorite: null,
    favoriteKnown: false,
    heirloom: heirloom && talentDef(data, heirloom) ? heirloom : null,
    parent,
    rng: petSeed(state.rng, petId),
  };
  rollBirthTraits(data, pet);
  pet.energy = petMaxEnergy(data, pet);
  p.list[petId] = pet;
  const slot = p.active.indexOf(null);
  if (slot >= 0) {
    p.active[slot] = petId;
    state.workers[petId] = newWorker(state, petId);
  }
  ctx.emit?.({ type: 'petHatched', pet: petId });
  recordPet(state, ctx, pet);
  return pet;
}

// Adds XP (callers include the pet's xp talents) and levels up to the stage cap; a talent pick is
// offered at each pick level.
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
  ensureOffer(ctx, pet);
}

// XP the pet earns from work, after its xp talents.
function earnedXp(data, pet, xp) {
  return xp * (1 + effectValue(data, pet, 'xp'));
}

export function addBond(state, ctx, pet, amount) {
  const before = petHearts(ctx.data, pet).hearts;
  pet.bond += amount * (1 + effectValue(ctx.data, pet, 'bond'));
  const after = petHearts(ctx.data, pet).hearts;
  if (after > before) ctx.emit?.({ type: 'petHeart', pet: pet.id, hearts: after });
}

function eat(state, ctx, pet, itemId, auto) {
  const { data } = ctx;
  const hall = itemDef(data, itemId)?.category === 'meal' ? sanctuaryBonus(state, data, 'mealStrength') : 0; // the Feast Hall
  const food = foodValue(data, itemId) * (1 + effectValue(data, pet, 'meal')) * (1 + hall);
  if (!removeItem(state, itemId, 1)) return false;
  pet.energy = Math.min(petMaxEnergy(data, pet), pet.energy + food);
  const favorite = isFavoriteDish(data, pet, itemId);
  const personal = !!pet.favorite && parseKey(itemId).id === pet.favorite;
  ctx.emit?.({ type: 'petAte', pet: pet.id, item: itemId, energy: food, auto, favorite, personal });
  if (favorite) addBond(state, ctx, pet, data.balance.pets.bond.favoriteDish);
  if (personal) {
    addBond(state, ctx, pet, data.balance.pets.bond.personalDish);
    if (!pet.favoriteKnown) {
      pet.favoriteKnown = true;
      ctx.emit?.({ type: 'favoriteFound', pet: pet.id, item: pet.favorite });
    }
  }
  return true;
}

// Heart 4+: each Bond point from work may come with a gift, one roll from the treasure loot of the
// zone the pet works in (from the pet's worker stream).
function maybeGift(state, ctx, pet, w) {
  const { data } = ctx;
  const g = data.balance.pets.heartGifts;
  if (petHearts(data, pet).hearts < g.minHearts) return;
  if (!chance(w, g.chancePerBondPoint * (1 + effectValue(data, pet, 'gift')))) return;
  const tier = data.zones.zones.find((z) => z.id === w.task.zone)?.tier || 1;
  const pick = pickLoot(w, data, tier);
  if (!pick) return;
  const qty = randomInt(w, pick.qty[0], pick.qty[1]);
  addItem(state, pick.item, qty);
  state.stats.petGifts += 1;
  ctx.emit?.({ type: 'petGift', pet: pet.id, item: pick.item, qty });
}

// ---- time ----

// No maps left for a digging pet: back to the harvest task it had before, or idle.
function stopDigging(w) {
  w.task = w.resume || null;
  w.resume = null;
  w.progressMs = 0;
}

// One pet's time: rest, idle recovery, or work (harvesting or digging) broken into steps at each event.
function advancePet(state, ctx, pet, ms) {
  const { data } = ctx;
  const b = data.balance.pets;
  const max = petMaxEnergy(data, pet);
  const active = isActive(state, pet.id);
  const w = state.workers[pet.id];
  if (w) dropStaleTask(data, w);
  if (w?.task?.skill === 'treasure' && mapCount(state, data, w.task.zone) <= 0) stopDigging(w);
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
  // Per-action values change only when the pet levels up (or gains a heart, for speed): see actionProfile.
  let prof = null;
  let seenLevel = -1;
  let threshold = 0;
  let drain = 0;
  let guard = 0;
  while (left > EPS && guard++ < MAX_STEPS) {
    if (!w.task) {
      // Stopped digging with nothing to go back to: idle recovery for the rest of the span.
      const rate = petRestPerHour(state, data, pet) / HOUR_MS;
      pet.energy = Math.min(max, pet.energy + rate * left);
      if (pet.energy >= max - EPS) pet.resting = false;
      break;
    }
    const digging = w.task.skill === 'treasure';
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
    if (pet.level !== seenLevel) {
      seenLevel = pet.level;
      threshold = petFeedThreshold(data, pet);
      drain = petDrainPerHour(data, pet) / HOUR_MS;
    }
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
    if (!digging) prof = actionProfile(state, data, pet.id, prof);
    const dur = digging ? petDigMs(state, data, pet) : prof.ms;
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
      maybeGift(state, ctx, pet, w);
    }
    if (w.progressMs >= dur - EPS) {
      w.progressMs = Math.max(0, w.progressMs - dur);
      if (digging) {
        finishDig(state, ctx, w.task.zone, w, pet.id);
        addPetXp(state, ctx, pet, earnedXp(data, pet, data.balance.treasure.petDigXp));
        if (mapCount(state, data, w.task.zone) <= 0) stopDigging(w);
      } else {
        const skill = w.task.skill;
        const { xp } = completeAction(state, ctx, pet.id, prof);
        pet.actions[skill] = (pet.actions[skill] || 0) + 1;
        addPetXp(state, ctx, pet, earnedXp(data, pet, xp));
      }
    }
  }
  return { workMs, restMs };
}

// A digging pet's dig finishing (it uses up a map the player may also be digging): the tick stops
// there. Resting and eating only make the real finish later, so this is never past it.
export function nextBoundaryMs(state, ctx) {
  let next = Infinity;
  for (const pid of state.pets.active) {
    const w = pid && state.workers[pid];
    const pet = pid && state.pets.list[pid];
    if (!w || !pet || w.task?.skill !== 'treasure' || pet.resting) continue;
    const left = petDigMs(state, ctx.data, pet) - w.progressMs;
    if (left > EPS) next = Math.min(next, left);
  }
  return next;
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

// The pet stops helping at any station.
function unpost(state, petId) {
  const a = state.crafting.assists;
  for (const s of Object.keys(a)) if (a[s] === petId) delete a[s];
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
    if (!canAutoFeed(ctx.data, item)) throw new Error('Pets only eat cooked meals and tonics. Cook it in the Kitchen first.');
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
  // Put a pet in an active slot. A pet already there moves to the Stable. An assistant leaves its
  // station to go out working.
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
    unpost(state, petId);
    if (!state.workers[petId]) state.workers[petId] = newWorker(state, petId);
  },
  // Return a pet to the wild. It leaves a few materials behind (pets.json archetype `release`).
  'pets/release': (state, { pet: petId }, ctx) => {
    const pet = needPet(state, petId);
    const p = state.pets;
    if (Object.keys(p.list).length <= 1) throw new Error(`${pet.name} is your only pet. Keep them close!`);
    const i = p.active.indexOf(petId);
    if (i >= 0) p.active[i] = null;
    unpost(state, petId);
    delete state.workers[petId];
    delete p.list[petId];
    const items = { ...(archetypeOf(ctx.data, pet.archetype)?.release || {}) };
    for (const [item, n] of Object.entries(items)) addItem(state, item, n);
    state.stats.released += 1;
    ctx.emit?.({ type: 'petReleased', pet: petId, name: pet.name, items });
  },
  'pets/stable': (state, { pet: petId }) => {
    needPet(state, petId);
    const p = state.pets;
    const i = p.active.indexOf(petId);
    if (i < 0) return;
    p.active[i] = null;
    delete state.workers[petId];
  },
  // Evolve: a hatchling at the first stage cap picks a branch whose calling it has done enough;
  // a juvenile at the second cap with enough Bond uses its branch's catalyst. Permanent.
  'pets/evolve': (state, { pet: petId, branch = null }, ctx) => {
    const { data } = ctx;
    const pet = needPet(state, petId);
    const info = evolveInfo(state, data, petId);
    if (!info.next) throw new Error(`${pet.name} is fully grown.`);
    if (info.next === 'juvenile') {
      const br = info.branches.find((x) => x.id === branch);
      if (!br) throw new Error('Choose a path first.');
      if (pet.level < info.levelNeed) throw new Error(info.reason);
      if (!br.unlocked) throw new Error(`The ${br.name} path needs ${br.need} actions of its skill.`);
      pet.branch = br.id;
    } else {
      if (!info.ready) throw new Error(info.reason);
      if (info.catalyst) removeItem(state, info.catalyst.item, 1);
    }
    pet.form = info.next;
    state.stats.evolved[pet.form] = (state.stats.evolved[pet.form] || 0) + 1;
    ctx.emit?.({ type: 'petEvolved', pet: petId, form: pet.form, branch: pet.branch, species: petSpecies(data, pet) });
    recordPet(state, ctx, pet);
    addPetXp(state, ctx, pet, 0); // banked XP counts toward the new stage's levels
  },
  // Choose one of the talents on offer.
  'pets/pickTalent': (state, { pet: petId, talent }, ctx) => {
    const pet = needPet(state, petId);
    if (!pet.offer) throw new Error(`${pet.name} has no talent to choose right now.`);
    if (!pet.offer.includes(talent)) throw new Error('Choose one of the talents on offer.');
    pet.talents.push(talent);
    pet.offer = null;
    state.stats.talentPicks += 1;
    ctx.emit?.({ type: 'talentPicked', pet: petId, talent });
    ensureOffer(ctx, pet);
    pet.energy = Math.min(pet.energy, petMaxEnergy(ctx.data, pet));
  },
  // Post a stabled adult at its branch's station (station: null to call it back). One assistant per
  // station; a pet already posted there goes back to resting.
  'pets/assist': (state, { pet: petId, station = null }, ctx) => {
    const pet = needPet(state, petId);
    if (station === null) {
      unpost(state, petId);
      return;
    }
    const info = assistInfo(state, ctx.data, petId);
    if (!info.can) throw new Error(info.reason);
    if (info.station !== station) throw new Error(`${pet.name} can only help at one kind of station.`);
    unpost(state, petId);
    state.crafting.assists[station] = petId;
    ctx.emit?.({ type: 'assistSet', pet: petId, station });
  },
};
