// Taming (docs/design.md "Taming and treasure"): the player tracks in a zone to find a wild
// encounter, then sets a crafted trap with optional bait on it. The trap runs trapMinutes of game
// time (offline too) and either catches the monster as a new pet or lets it escape.
// state.taming = { encounters: { zone: Encounter }, traps: { zone: Trap }, lure, results, seen, rng }
// (docs/architecture.md "Phase 7"). Tracking rolls from the player's own stream; each trap rolls
// from its own stream (seeded when it is set), so live play and offline catch-up agree.
import { random, randomInt, chance, deriveSeed } from '../core/rng.js';
import { addItem, removeItem, itemDef, itemLabel } from './bag.js';
import { addXp, skillLevel, masterySpeed } from './skills.js';
import { buffSpeed } from './buffs.js';
import { zoneUnlocked, isHarvestTask, playerCrafting, leaveStations } from './harvest.js';
import { createPet } from './pets.js';
import { archetypeOf, bestEffect, mythicDef } from './petstats.js';
import { petCapacity } from './buildings.js';
import { sanctuaryBonus } from './sanctuary.js';

export const id = 'taming';
export { isHarvestTask };

const EPS = 1e-6;
const HOUR_MS = 3600 * 1000;

export function init(state, ctx) {
  const { data } = ctx;
  const t = state.taming;
  if (state.stats.tamed == null) state.stats.tamed = 0;
  // Drop anything that points at a zone or archetype the data no longer has.
  for (const [zone, e] of Object.entries(t.encounters)) {
    if (!zoneById(data, zone) || !archetypeOf(data, e.archetype)) {
      delete t.encounters[zone];
      delete t.traps[zone];
    }
  }
  for (const zone of Object.keys(t.traps)) if (!t.encounters[zone]) delete t.traps[zone];
  if (t.lure && !(t.lure.msLeft > EPS)) t.lure = null;
  if (!Number.isFinite(t.mythicMs) || t.mythicMs < 0) t.mythicMs = 0;
  for (const e of Object.values(t.encounters)) if (e.mythic && !mythicDef(data, e.archetype)) e.mythic = false;
  const w = state.workers.player;
  if (w.resume === undefined) w.resume = null;
  if (w.task?.skill === 'taming' && !zoneById(data, w.task.zone)) {
    w.task = null;
    w.progressMs = 0;
  }
}

// ---- lookups ----

function zoneById(data, zoneId) {
  return data.zones.zones.find((z) => z.id === zoneId) || null;
}

const qualityIds = (data) => data.pets.qualities.map((q) => q.id);

// ---- selectors ----

// A pet quality id. Base odds from balance.pets.qualities; luck multiplies every band above the
// first by (1 + luck); bands moves the result that many bands higher; min is a floor.
export function rollQuality(stream, data, { bands = 0, luck = 0, min = null } = {}) {
  const ids = qualityIds(data);
  const odds = ids.map((q, i) => (data.balance.pets.qualities[q]?.odds || 0) * (i > 0 ? 1 + luck : 1));
  const total = odds.reduce((a, b) => a + b, 0);
  let r = random(stream) * total;
  let i = 0;
  while (i < ids.length - 1 && r >= odds[i]) r -= odds[i++];
  i = Math.min(ids.length - 1, i + bands);
  if (min) i = Math.max(i, ids.indexOf(min));
  return ids[i];
}

// Length of one tracking action in a zone (slower in higher-tier zones, like harvesting).
function baseTrackMs(data, zone) {
  return data.balance.taming.trackSeconds * 1000 * data.balance.harvest.tierDurationMult[zone.tier - 1];
}

export function trackMs(state, data, zoneId) {
  return baseTrackMs(data, zoneById(data, zoneId)) / (1 + buffSpeed(state, 'taming') + masterySpeed(state, data, 'taming'));
}

// Chance per tracking action of finding an encounter (when the zone has none). The best tracker
// among the active pets (Scout branch, talents) adds its track bonus; so does the Heart Shrine.
export function revealChance(state, data) {
  const b = data.balance.taming;
  const helpers = state.pets.active.filter(Boolean).map((id) => state.pets.list[id]).filter(Boolean);
  return b.revealBase + b.revealPerLevel * skillLevel(state, 'taming') + bestEffect(data, helpers, 'track') + sanctuaryBonus(state, data, 'reveal');
}

// Pet spaces left for new pets: Stable capacity minus pets and traps already set (a set trap
// holds a space so its catch always has somewhere to go).
export function freePetSpaces(state, data) {
  return petCapacity(state, data) - Object.keys(state.pets.list).length - Object.keys(state.taming.traps).length;
}

// Catch chance for a trap and bait on the zone's encounter, with its parts (fractions 0..1).
// A mythic needs a mythic trap and mythic bait (otherwise the chance is 0); its chance does not
// depend on the trap tier or on the bait matching.
export function catchChance(state, data, zoneId, trapKey, baitKey = null) {
  const c = data.balance.taming.catch;
  const zone = zoneById(data, zoneId);
  const enc = state.taming.encounters[zoneId];
  if (enc?.mythic) {
    const m = data.balance.taming.mythic;
    const ok = !!itemDef(data, trapKey)?.trap?.mythic && !!(baitKey && itemDef(data, baitKey)?.bait?.mythic);
    const level = m.catchPerLevel * skillLevel(state, 'taming');
    const raw = ok ? m.catchBase + level : 0;
    return { chance: Math.min(m.cap, raw), base: ok ? m.catchBase : 0, trap: 0, bait: 0, level: ok ? level : 0, capped: raw > m.cap, mythic: true, ok };
  }
  const trapTier = itemDef(data, trapKey)?.trap?.tier ?? zone.tier;
  const dish = baitKey ? itemDef(data, baitKey)?.bait?.dish : null;
  const base = c.base;
  const trap = c.perTrapTier * (trapTier - zone.tier);
  const bait = enc && dish && archetypeOf(data, enc.archetype)?.dish === dish ? c.bait : 0;
  const level = c.perLevel * skillLevel(state, 'taming');
  const raw = base + trap + bait + level;
  return { chance: Math.max(0, Math.min(c.cap, raw)), base, trap, bait, level, capped: raw > c.cap };
}

// What the player sees of a zone's encounter, or null. quality is null until Taming is high enough
// to read it; hint is always there.
export function encounterInfo(state, data, zoneId) {
  const e = state.taming.encounters[zoneId];
  if (!e) return null;
  const b = data.balance.taming;
  const ids = qualityIds(data);
  const special = ids.indexOf(e.quality) >= ids.indexOf(b.specialFrom);
  const reads = skillLevel(state, 'taming') >= b.qualityRevealLevel;
  const tr = state.taming.traps[zoneId];
  return {
    archetype: e.archetype,
    mythic: !!e.mythic,
    species: (e.mythic ? mythicDef(data, e.archetype)?.species : archetypeOf(data, e.archetype)?.species) || e.archetype,
    quality: reads ? e.quality : null,
    special,
    hint: reads ? data.pets.qualities.find((q) => q.id === e.quality)?.name || e.quality : special ? 'Something special' : 'Looks ordinary',
    msLeft: e.msLeft,
    trap: tr ? { item: tr.trap, bait: tr.bait, chance: tr.chance, msLeft: tr.msLeft } : null,
  };
}

// Can a trap be set in this zone right now (ignoring which trap)? { ok, reason }
export function trapCheck(state, data, zoneId) {
  const zone = zoneById(data, zoneId);
  if (!zone) return { ok: false, reason: "There's nothing like that here." };
  if (!zoneUnlocked(state, data, zoneId)) return { ok: false, reason: `${zone.name} isn't open yet.` };
  if (!state.taming.encounters[zoneId]) return { ok: false, reason: 'Track a wild monster here first.' };
  if (state.taming.traps[zoneId]) return { ok: false, reason: 'A trap is already set here.' };
  if (freePetSpaces(state, data) <= 0) return { ok: false, reason: 'No room for another pet. Upgrade the Stable or release a pet.' };
  return { ok: true, reason: '' };
}

// Traps in the bag for this zone: [{ key, item, tier, count, ok, reason }], lowest usable tier first.
export function trapOptions(state, data, zoneId) {
  const zone = zoneById(data, zoneId);
  const mythic = !!state.taming.encounters[zoneId]?.mythic;
  return Object.entries(state.bag)
    .filter(([key, n]) => n > 0 && itemDef(data, key)?.trap)
    .map(([key, count]) => {
      const item = itemDef(data, key);
      const tier = item.trap.tier;
      const ok = mythic ? !!item.trap.mythic : tier >= zone.tier;
      const reason = ok ? '' : mythic ? 'Only a Starmetal Trap can hold a mythic.' : `Needs a tier ${zone.tier} trap or better.`;
      return { key, item, tier, count, ok, reason };
    })
    .sort((a, b) => b.ok - a.ok || a.tier - b.tier || a.key.localeCompare(b.key));
}

// Bait in the bag: [{ key, item, count, match }]; match = the zone's encounter loves this dish.
export function baitOptions(state, data, zoneId) {
  const enc = state.taming.encounters[zoneId];
  const dish = enc ? archetypeOf(data, enc.archetype)?.dish : null;
  return Object.entries(state.bag)
    .filter(([key, n]) => n > 0 && itemDef(data, key)?.bait)
    .map(([key, count]) => {
      const item = itemDef(data, key);
      const match = enc?.mythic ? !!item.bait.mythic : !!dish && item.bait.dish === dish;
      return { key, item, count, match };
    })
    .sort((a, b) => b.match - a.match || a.key.localeCompare(b.key));
}

export function lureInfo(state, data) {
  const l = state.taming.lure;
  return l ? { item: l.item, def: itemDef(data, l.item), msLeft: l.msLeft, bands: l.bands } : null;
}

// Lures in the bag: [{ key, item, count, minutes }].
export function lureList(state, data) {
  return Object.entries(state.bag)
    .filter(([key, n]) => n > 0 && itemDef(data, key)?.lure)
    .map(([key, count]) => ({ key, item: itemDef(data, key), count, minutes: itemDef(data, key).lure.minutes }))
    .sort((a, b) => a.minutes - b.minutes || a.key.localeCompare(b.key));
}

// World tab badge: a trap finished since the player last looked.
export function tamingNotice(state) {
  return !state.taming.seen;
}

// ---- time ----

// Traps finishing and escaped encounters leaving: the tick stops there so a caught pet starts
// at the same moment live and offline.
export function nextBoundaryMs(state) {
  const t = state.taming;
  let next = Infinity;
  for (const tr of Object.values(t.traps)) if (tr.msLeft > EPS) next = Math.min(next, tr.msLeft);
  for (const [zone, e] of Object.entries(t.encounters)) {
    if (e.msLeft !== null && !t.traps[zone] && e.msLeft > EPS) next = Math.min(next, e.msLeft);
  }
  return next;
}

function resolveTrap(state, ctx, zoneId) {
  const { data } = ctx;
  const b = data.balance.taming;
  const t = state.taming;
  const tr = t.traps[zoneId];
  const enc = t.encounters[zoneId];
  delete t.traps[zoneId];
  const caught = chance(tr, tr.chance);
  const trapKept = chance(tr, caught ? b.trapKeptOnCatch : b.trapKeptOnEscape);
  if (trapKept) addItem(state, tr.trap, 1);
  let pet = null;
  if (caught) {
    delete t.encounters[zoneId];
    pet = createPet(state, ctx, { archetype: enc.archetype, quality: enc.quality, name: '', mythic: !!enc.mythic }, { force: true }).id;
    state.stats.tamed += 1;
    addXp(state, ctx, 'taming', b.catchXp * zoneById(data, zoneId).tier);
  } else {
    enc.msLeft = b.escapeStayHours * HOUR_MS;
  }
  const result = { zone: zoneId, archetype: enc.archetype, quality: enc.quality, mythic: !!enc.mythic, caught, pet, trap: tr.trap, trapKept };
  t.results.push(result);
  if (t.results.length > b.maxResults) t.results.splice(0, t.results.length - b.maxResults);
  t.seen = false;
  ctx.emit?.({ type: 'trapDone', ...result });
}

// One finished tracking action: Taming XP, and maybe an encounter. Returns true when the player
// went back to the task they were doing before tracking.
function trackAction(state, ctx, w) {
  const { data } = ctx;
  const b = data.balance.taming;
  const t = state.taming;
  const zone = zoneById(data, w.task.zone);
  const xp = (baseTrackMs(data, zone) / 1000) * b.xpPerTrackSecond;
  ctx.emit?.({ type: 'tracked', zone: zone.id, xp });
  addXp(state, ctx, 'taming', xp);
  if (t.encounters[zone.id] || !zone.archetypes?.length || !chance(w, revealChance(state, data))) return false;
  // Mythics (zones with `mythics`): at most one per cooldown; one the player has never had first.
  const mythic = !!zone.mythics && t.mythicMs <= EPS && chance(w, b.mythic.revealShare);
  let choices = zone.archetypes;
  if (mythic) {
    const all = zone.archetypes.filter((a) => mythicDef(data, a));
    const missing = all.filter((a) => !Object.keys(state.bestiary[`mythic.${a}`] || {}).length);
    choices = missing.length ? missing : all;
  }
  const archetype = choices[randomInt(w, 0, choices.length - 1)];
  const quality = rollQuality(w, data, { bands: t.lure?.bands || 0, luck: b.qualityLuckPerLevel * skillLevel(state, 'taming') });
  t.encounters[zone.id] = { archetype, quality, msLeft: null, ...(mythic ? { mythic: true } : {}) };
  if (mythic) t.mythicMs = b.mythic.cooldownHours * HOUR_MS;
  ctx.emit?.({ type: 'encounter', zone: zone.id, archetype, quality, mythic });
  if (!w.resume) return false;
  w.task = w.resume;
  w.resume = null;
  w.progressMs = 0;
  return true;
}

export function advance(state, ms, ctx) {
  const t = state.taming;
  // The player's tracking and the lure, stepped together so each action sees the lure as it was.
  const w = state.workers.player;
  let left = ms;
  while (left > EPS) {
    const tracking = w.task?.skill === 'taming' && !playerCrafting(state); // tracking waits while the player crafts
    if (!tracking && !t.lure) break;
    const dur = tracking ? trackMs(state, ctx.data, w.task.zone) : Infinity;
    const step = Math.min(left, tracking ? Math.max(0, dur - w.progressMs) : Infinity, t.lure ? t.lure.msLeft : Infinity);
    left -= step;
    t.mythicMs = Math.max(0, t.mythicMs - step); // stepped with tracking, so each action sees it as it was
    if (tracking) w.progressMs += step;
    if (t.lure) {
      t.lure.msLeft -= step;
      if (t.lure.msLeft <= EPS) {
        t.lure = null;
        ctx.emit?.({ type: 'lureEnded' });
      }
    }
    if (tracking && w.progressMs >= dur - EPS) {
      w.progressMs = Math.max(0, w.progressMs - dur);
      // Back to harvesting: the rest of this span counts toward the harvest action.
      if (trackAction(state, ctx, w)) w.progressMs = left;
    }
  }
  t.mythicMs = Math.max(0, t.mythicMs - left);
  // Escaped monsters count down before traps finish, so one that escapes now gets its full stay.
  for (const [zone, e] of Object.entries(t.encounters)) {
    if (e.msLeft === null || t.traps[zone]) continue;
    e.msLeft = Math.max(0, e.msLeft - ms);
    if (e.msLeft <= EPS) {
      delete t.encounters[zone];
      ctx.emit?.({ type: 'encounterGone', zone });
    }
  }
  for (const [zone, tr] of Object.entries(t.traps)) {
    tr.msLeft = Math.max(0, tr.msLeft - ms);
    if (tr.msLeft <= EPS) resolveTrap(state, ctx, zone);
  }
}

// ---- commands ----

export const commands = {
  // The player tracks in a zone. A harvest task is remembered and taken up again once a monster
  // is found.
  'taming/track': (state, { zone: zoneId }, ctx) => {
    const zone = zoneById(ctx.data, zoneId);
    if (!zone || !zone.archetypes?.length) throw new Error('No wild monsters live there.');
    if (!zoneUnlocked(state, ctx.data, zoneId)) throw new Error(`${zone.name} isn't open yet.`);
    const w = state.workers.player;
    leaveStations(state);
    if (w.task?.skill === 'taming' && w.task.zone === zoneId) return;
    if (isHarvestTask(ctx.data, w.task)) w.resume = w.task;
    w.task = { zone: zoneId, skill: 'taming', node: 'track' };
    w.progressMs = 0;
  },
  'taming/setTrap': (state, { zone: zoneId, trap, bait = null }, ctx) => {
    const { data } = ctx;
    const check = trapCheck(state, data, zoneId);
    if (!check.ok) throw new Error(check.reason);
    const trapDef = itemDef(data, trap);
    if (!trapDef?.trap) throw new Error('Pick a trap first.');
    if (!state.bag[trap]) throw new Error(`You don't have a ${itemLabel(data, trap)}.`);
    const zone = zoneById(data, zoneId);
    const mythic = !!state.taming.encounters[zoneId].mythic;
    if (mythic && !trapDef.trap.mythic) throw new Error('Only a Starmetal Trap can hold a mythic.');
    if (!mythic && trapDef.trap.tier < zone.tier) throw new Error(`${zone.name} needs a tier ${zone.tier} trap or better.`);
    if (mythic && !(bait && itemDef(data, bait)?.bait?.mythic)) throw new Error('A mythic only comes close for Mythic Bait.');
    if (bait) {
      if (!itemDef(data, bait)?.bait) throw new Error("That isn't bait.");
      if (!state.bag[bait]) throw new Error(`You don't have any ${itemLabel(data, bait)}.`);
    }
    const { chance: p } = catchChance(state, data, zoneId, trap, bait);
    removeItem(state, trap, 1);
    if (bait) removeItem(state, bait, 1);
    const t = state.taming;
    t.traps[zoneId] = { trap, bait, chance: p, msLeft: data.balance.taming.trapMinutes * 60000, rng: deriveSeed(t.rng, 1) };
    t.rng = deriveSeed(t.rng, 2);
    ctx.emit?.({ type: 'trapSet', zone: zoneId, chance: p });
  },
  // Let a tracked monster go (to look for a different one).
  'taming/letGo': (state, { zone: zoneId }) => {
    const t = state.taming;
    if (!t.encounters[zoneId]) return;
    if (t.traps[zoneId]) throw new Error('A trap is already set for it.');
    delete t.encounters[zoneId];
  },
  // A lure: encounters found while it runs roll quality higher. Using another adds its time.
  'taming/useLure': (state, { item }, ctx) => {
    const def = itemDef(ctx.data, item);
    if (!def?.lure) throw new Error("That isn't a lure.");
    if (!removeItem(state, item, 1)) throw new Error(`You don't have a ${itemLabel(ctx.data, item)}.`);
    const t = state.taming;
    const ms = def.lure.minutes * 60000;
    if (t.lure) {
      t.lure.msLeft += ms;
      t.lure.bands = Math.max(t.lure.bands, def.lure.bands);
      t.lure.item = item;
    } else {
      t.lure = { item, msLeft: ms, bands: def.lure.bands };
    }
    ctx.emit?.({ type: 'lureStarted', item, msLeft: t.lure.msLeft });
  },
  'taming/seen': (state) => {
    state.taming.seen = true;
  },
};
