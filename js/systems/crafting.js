// Crafting stations and their queues (docs/design.md "Crafting"). Four stations (data/recipes.json)
// each keep their own queue, but the player works only workSlots stations at a time (1, or 2 from
// Cottage tier 3: balance.crafting.workSlotsByCottageTier), alongside harvesting and offline too.
// state.crafting.working lists them; the other queues wait, paused. When a worked queue runs empty
// the player moves on to the next station with work waiting (data order) and the leftover time
// carries over, so nothing sits idle while something is queued. (Phase 8: an adult pet assistant
// keeps its station running without using a slot.) A queue holds batches (one
// recipe x a quantity); the front batch makes its items one by one, then the next batch starts.
// Materials for a whole batch leave the bag when it is queued, so nothing else can use them;
// cancelling returns the materials for items not made yet.
// Items with quality (tools, meals) roll Normal / Fine / Masterwork from the station's own random
// stream. Items are stepped one at a time with leftover time carried over, so any chunk size
// gives the same results.
import { deriveSeed, random } from '../core/rng.js';
import { addItem, removeItem, itemKey, itemCount } from './bag.js';
import { addXp, skillLevel } from './skills.js';
import { buffSpeed } from './buffs.js';
import { isUpgrade, equip } from './tools.js';
import { addRenownXp } from './renown.js';

export const id = 'crafting';

const EPS = 1e-6;


export function init(state, ctx) {
  const { data } = ctx;
  const stations = state.crafting.stations;
  data.recipes.stations.forEach((s, i) => {
    if (!stations[s.id]) stations[s.id] = { queue: [], progressMs: 0, notice: false, rng: deriveSeed(state.rng, 2000 + i) };
  });
  if (!state.stats.crafts) state.stats.crafts = {};
  if (!state.stats.quality) state.stats.quality = { fine: 0, masterwork: 0 };
  if (!Array.isArray(state.crafting.working)) state.crafting.working = [];
  if (!state.crafting.known) state.crafting.known = {};
  normalizeWorking(state, data);
}

// ---- lookups ----

export function stationDef(data, stationId) {
  return data.recipes.stations.find((s) => s.id === stationId) || null;
}

export function recipeDef(data, recipeId) {
  return data.recipes.recipes.find((r) => r.id === recipeId) || null;
}

export function recipesFor(data, stationId) {
  return data.recipes.recipes.filter((r) => r.station === stationId);
}

// A station's building tier (state.buildings, js/systems/buildings.js); 0 = not built yet.
export function stationTier(state, stationId) {
  return state.buildings[stationId]?.tier ?? 1;
}

export function queueSlots(state, data, stationId) {
  const slots = data.balance.crafting.queueSlotsByTier;
  const tier = stationTier(state, stationId);
  return tier > 0 ? slots[Math.min(slots.length, tier) - 1] : 0;
}

// How many stations the player can work at once (from the Cottage's tier).
export function workSlots(state, data) {
  const list = data.balance.crafting.workSlotsByCottageTier;
  return list[Math.min(list.length, Math.max(1, state.buildings.cottage.tier)) - 1];
}

export function isWorking(state, stationId) {
  return state.crafting.working.includes(stationId);
}

// Built and has something queued: the player could work here.
function busy(state, data, stationId) {
  return !!stationDef(data, stationId) && stationTier(state, stationId) > 0 && (state.crafting.stations[stationId]?.queue.length || 0) > 0;
}

// The first station (data order) with work queued that the player isn't working at.
function nextWaiting(state, data) {
  return data.recipes.stations.find((s) => !isWorking(state, s.id) && busy(state, data, s.id))?.id || null;
}

// Keeps state.crafting.working to busy stations, at most workSlots, filling free slots in data order.
function normalizeWorking(state, data) {
  const c = state.crafting;
  const slots = workSlots(state, data);
  c.working = c.working.filter((sid, i, a) => a.indexOf(sid) === i && busy(state, data, sid)).slice(0, slots);
  while (c.working.length < slots) {
    const next = nextWaiting(state, data);
    if (!next) break;
    c.working.push(next);
  }
}

// ---- selectors ----

// Time to make one item of this recipe now, after station tier and buffs.
export function itemMs(state, data, recipe) {
  const c = data.balance.crafting;
  const skill = stationDef(data, recipe.station).skill;
  const speed = 1 + c.stationSpeedPerTier * (stationTier(state, recipe.station) - 1) + buffSpeed(state, skill);
  return (recipe.seconds * 1000) / speed;
}

// Skill XP for one item.
export function itemXp(data, recipe) {
  const c = data.balance.crafting;
  return recipe.seconds * c.xpPerCraftSecond * (1 + (recipe.level || 1) * c.xpPerRecipeLevel);
}

export function makesQuality(data, recipe) {
  return !!data.items.items[recipe.output]?.quality;
}

// Chance of Fine and Masterwork for one item at the player's current level, with an optional
// Focus result ('good' | 'perfect'; anything else = base odds). { fine, masterwork } as 0..1.
export function qualityOdds(state, data, recipe, focus = null) {
  if (!makesQuality(data, recipe)) return { fine: 0, masterwork: 0 };
  const q = data.balance.crafting.quality;
  const above = Math.max(0, skillLevel(state, stationDef(data, recipe.station).skill) - (recipe.level || 1));
  const mult = data.balance.crafting.focus.mult[focus] ?? 1;
  const mw = Math.min(q.masterworkFocusCap, Math.min(q.masterworkCap, q.masterworkBase + q.masterworkPerLevel * above) * mult);
  const fine = Math.min(q.fineFocusCap, Math.min(q.fineCap, q.fineBase + q.finePerLevel * above) * mult, 1 - mw);
  return { fine, masterwork: mw };
}

// Can the player queue `qty` of this recipe? { ok, reason, max } with a player-readable reason;
// max is how many the bag has materials for (ignoring queue space).
export function recipeCheck(state, data, recipeId, qty = 1) {
  const recipe = recipeDef(data, recipeId);
  if (!recipe) return { ok: false, reason: "There's no such recipe.", max: 0 };
  const station = stationDef(data, recipe.station);
  const skill = data.skills.skills.find((s) => s.id === station.skill);
  let max = data.balance.crafting.maxBatch;
  for (const [itemId, n] of Object.entries(recipe.inputs)) max = Math.min(max, Math.floor(itemCount(state, itemId) / n));
  const fail = (reason) => ({ ok: false, reason, max });
  if (stationTier(state, recipe.station) < 1) return fail(`Needs the ${station.name}: build it on the Home tab.`);
  if (recipe.scroll && !state.crafting.known[recipe.id]) return fail('Needs a recipe scroll from the Mossbrook market.');
  if (skillLevel(state, station.skill) < (recipe.level || 1)) return fail(`Needs ${skill.name} level ${recipe.level}.`);
  for (const [s, lvl] of Object.entries(recipe.needs || {})) {
    if (skillLevel(state, s) < lvl) return fail(`Needs ${data.skills.skills.find((x) => x.id === s)?.name || s} level ${lvl}.`);
  }
  if (max < 1) return fail('Not enough materials.');
  if (!(qty >= 1) || qty > max) return fail(`You have materials for ${max}.`);
  if (state.crafting.stations[recipe.station].queue.length >= queueSlots(state, data, recipe.station)) {
    return fail(`The ${station.name} queue is full.`);
  }
  return { ok: true, reason: '', max };
}

// Stations for display: [{ id, name, skill, tier, slots, queue, progressMs, notice, working, status }].
// status: 'unbuilt' | 'working' | 'paused' (work queued, the player is at another station) | 'idle'.
export function stationList(state, data) {
  return data.recipes.stations.map((s) => {
    const st = state.crafting.stations[s.id];
    const tier = stationTier(state, s.id);
    const working = isWorking(state, s.id);
    const status = tier < 1 ? 'unbuilt' : working ? 'working' : st.queue.length ? 'paused' : 'idle';
    return { ...s, tier, slots: queueSlots(state, data, s.id), queue: st.queue, progressMs: st.progressMs, notice: st.notice, working, status };
  });
}

// Time left on a station's whole queue at the current speed (ms), and on its front item.
export function stationTimeLeft(state, data, stationId) {
  const st = state.crafting.stations[stationId];
  let total = 0;
  let item = 0;
  st.queue.forEach((b, i) => {
    const recipe = recipeDef(data, b.recipe);
    if (!recipe) return;
    const dur = itemMs(state, data, recipe);
    const left = (b.qty - b.done) * dur - (i === 0 ? st.progressMs : 0);
    if (i === 0) item = Math.max(0, dur - st.progressMs);
    total += Math.max(0, left);
  });
  return { total, item };
}

// True when a queue ran empty since the player last looked at the Craft tab (the tab badge).
export function craftNotice(state) {
  return Object.values(state.crafting.stations).some((s) => s.notice);
}

// ---- time ----

function rollQuality(state, data, st, recipe, focus) {
  const odds = qualityOdds(state, data, recipe, focus);
  if (!odds.fine && !odds.masterwork) return 'normal';
  const r = random(st);
  if (r < odds.masterwork) return 'masterwork';
  if (r < odds.masterwork + odds.fine) return 'fine';
  return 'normal';
}

function finishItem(state, ctx, stationId, st, batch, recipe) {
  const { data } = ctx;
  const skill = stationDef(data, stationId).skill;
  const quality = rollQuality(state, data, st, recipe, batch.focus);
  const key = itemKey(recipe.output, quality);
  addItem(state, key, recipe.qty);
  batch.done += 1;
  batch.made[key] = (batch.made[key] || 0) + recipe.qty;
  const first = !state.stats.crafts[recipe.id];
  state.stats.crafts[recipe.id] = (state.stats.crafts[recipe.id] || 0) + 1;
  if (quality !== 'normal') state.stats.quality[quality] = (state.stats.quality[quality] || 0) + 1;
  if (first) addRenownXp(state, ctx, data.balance.renown.firstCraft, 'firstCraft');
  const xp = itemXp(data, recipe);
  ctx.emit?.({ type: 'craft', station: stationId, recipe: recipe.id, item: key, qty: recipe.qty, quality, xp, skill });
  addXp(state, ctx, skill, xp);
  if (isUpgrade(state, data, key)) equip(state, ctx, key);
}

// Runs one station for ms. Returns the time left over when its queue ran empty (0 otherwise).
function advanceStation(state, ctx, stationId, st, ms) {
  const { data } = ctx;
  st.progressMs += ms;
  while (st.queue.length) {
    const batch = st.queue[0];
    const recipe = recipeDef(data, batch.recipe);
    if (!recipe) {
      refund(state, batch);
      st.queue.shift();
      continue;
    }
    const dur = itemMs(state, data, recipe);
    if (st.progressMs < dur - EPS) return 0;
    st.progressMs = Math.max(0, st.progressMs - dur);
    finishItem(state, ctx, stationId, st, batch, recipe);
    if (batch.done >= batch.qty) {
      st.queue.shift();
      ctx.emit?.({ type: 'batchDone', station: stationId, recipe: recipe.id, made: batch.made });
      if (!st.queue.length) {
        st.notice = true;
        ctx.emit?.({ type: 'stationIdle', station: stationId });
      }
    }
  }
  const left = st.progressMs;
  st.progressMs = 0; // an empty station doesn't bank time
  return left;
}

// Stop the tick when a worked station is about to finish a tool (it may be equipped at once, which
// changes how fast the workers harvest from that moment on), and when a worked queue runs empty
// while another waits (the player moves there, and what it makes may be a tool).
export function nextBoundaryMs(state, ctx) {
  const { data } = ctx;
  let next = Infinity;
  const waiting = !!nextWaiting(state, data);
  for (const stationId of state.crafting.working) {
    const st = state.crafting.stations[stationId];
    const batch = st?.queue[0];
    const recipe = batch && recipeDef(data, batch.recipe);
    if (!recipe || !stationDef(data, stationId)) continue;
    if (data.items.items[recipe.output]?.tool) next = Math.min(next, itemMs(state, data, recipe) - st.progressMs);
    if (waiting) next = Math.min(next, stationTimeLeft(state, data, stationId).total);
  }
  return next;
}

export function advance(state, ms, ctx) {
  const { data } = ctx;
  const c = state.crafting;
  normalizeWorking(state, data);
  for (let i = 0; i < c.working.length; i++) {
    let sid = c.working[i];
    let left = ms;
    while (left > EPS) {
      left = advanceStation(state, ctx, sid, c.stations[sid], left);
      if (left <= EPS) break;
      // This queue ran empty: the rest of the time goes to the next station with work waiting.
      const next = nextWaiting(state, data);
      if (!next) break;
      c.working[i] = next;
      sid = next;
    }
  }
  normalizeWorking(state, data);
}

function refund(state, batch) {
  const left = batch.qty - batch.done;
  for (const [itemId, n] of Object.entries(batch.inputs)) addItem(state, itemId, n * left);
}

// ---- commands ----

export const commands = {
  // Queue a batch. focus: 'perfect' | 'good' | 'miss' | null (the Focus tap result; skip = null).
  'crafting/start': (state, { recipe: recipeId, qty, focus = null }, ctx) => {
    const { data } = ctx;
    const n = Math.floor(qty);
    const check = recipeCheck(state, data, recipeId, n);
    if (!check.ok) throw new Error(check.reason);
    const recipe = recipeDef(data, recipeId);
    for (const [itemId, per] of Object.entries(recipe.inputs)) removeItem(state, itemId, per * n);
    const st = state.crafting.stations[recipe.station];
    if (!st.queue.length) st.progressMs = 0;
    st.queue.push({
      recipe: recipeId, qty: n, done: 0,
      focus: focus === 'good' || focus === 'perfect' ? focus : null,
      inputs: { ...recipe.inputs }, made: {},
    });
    st.notice = false;
    normalizeWorking(state, data); // a free working slot picks this station up
  },
  // Work at this station now. With every working slot taken, the station worked longest pauses.
  'crafting/work': (state, { station }, ctx) => {
    const { data } = ctx;
    const def = stationDef(data, station);
    if (!def) throw new Error("There's no such station.");
    if (isWorking(state, station)) return;
    if (!busy(state, data, station)) throw new Error(`Queue something at the ${def.name} first.`);
    const c = state.crafting;
    c.working.push(station);
    while (c.working.length > workSlots(state, data)) c.working.shift();
  },
  // Cancel a queued batch; materials for the items not made yet come back.
  'crafting/cancel': (state, { station, index }, ctx) => {
    const st = state.crafting.stations[station];
    const batch = st?.queue[index];
    if (!batch) throw new Error('That batch has already finished.');
    refund(state, batch);
    st.queue.splice(index, 1);
    if (index === 0) st.progressMs = 0;
    normalizeWorking(state, ctx.data);
  },
  // The player looked at the Craft tab: clear the "queue ran empty" badge.
  'crafting/seen': (state) => {
    for (const st of Object.values(state.crafting.stations)) st.notice = false;
  },
};

