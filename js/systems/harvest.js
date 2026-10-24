// Harvesting: workers repeat one action in one zone (docs/design.md "Core loop", "World",
// "Player tools"). Workers are the player and the active pets. This system advances the player;
// pets are advanced by the pets system (energy decides when they work), which calls
// completeAction() here. Each action takes a fixed time and each worker rolls from its own
// random stream, so live play and offline catch-up (any chunk size) give the same results.
import { chance, random, randomInt, deriveSeed } from '../core/rng.js';
import { addItem } from './bag.js';
import { addXp, skillLevel, masterySpeed, masteryStars } from './skills.js';
import { isPet, petSpeed, petRareBonus, effectValue } from './petstats.js';
import { buffSpeed } from './buffs.js';
import { sanctuaryBonus } from './sanctuary.js';
import { legacyValue } from './elders.js';

export const id = 'harvest';

export function init(state, ctx) {
  const { data } = ctx;
  for (const kind of data.tools.kinds) {
    if (!state.tools[kind.id] && kind.starter) state.tools[kind.id] = { item: kind.starter, quality: 'normal' };
  }
  for (const s of data.skills.skills) {
    if (s.type === 'harvest' && !(s.id in state.stats.actions)) state.stats.actions[s.id] = 0;
  }
  if (!state.workers.player) state.workers.player = { task: null, progressMs: 0, rng: deriveSeed(state.rng, 1) };
  // Drop a harvest task whose zone or node no longer exists in the data (tracking and digging
  // tasks are checked by the taming and treasure systems).
  for (const w of Object.values(state.workers)) dropStaleTask(data, w);
  if (state.workers.player.resume && !findNode(data, state.workers.player.resume)) state.workers.player.resume = null;
}

// ---- lookups ----

// Lookups run on every action, so the lists are indexed once (per data object).
const byIdCache = new WeakMap();
function indexed(list) {
  let m = byIdCache.get(list);
  if (!m) {
    m = new Map();
    for (const x of list) if (!m.has(x.id)) m.set(x.id, x); // first one wins, like find()
    byIdCache.set(list, m);
  }
  return m;
}

function zoneById(data, zoneId) {
  return indexed(data.zones.zones).get(zoneId) || null;
}

function skillById(data, skillId) {
  return indexed(data.skills.skills).get(skillId) || null;
}

function findNode(data, { zone, skill, node }) {
  const nodes = zoneById(data, zone)?.harvest?.[skill];
  return (nodes && indexed(nodes).get(node)) || null;
}

// Is this a harvesting task (not tracking or digging)?
export function isHarvestTask(data, task) {
  return !!task && skillById(data, task.skill)?.type === 'harvest';
}

// The map item that marks dig sites in a zone (items.json `map.zone`), or null.
const mapCache = new WeakMap();
export function mapItemFor(data, zoneId) {
  let byZone = mapCache.get(data.items);
  if (!byZone) {
    byZone = {};
    for (const [itemId, def] of Object.entries(data.items.items)) if (def.map?.zone) byZone[def.map.zone] = itemId;
    mapCache.set(data.items, byZone);
  }
  return byZone[zoneId] || null;
}

// ---- selectors (the UI may call these) ----

export function workerTask(state, workerId) {
  return state.workers[workerId]?.task || null;
}

export function zoneUnlocked(state, data, zoneId) {
  const unlock = zoneById(data, zoneId)?.unlock;
  if (!unlock) return false;
  if (unlock.renown != null) return state.renown.rank >= unlock.renown;
  if (unlock.grandProject != null) return (state.sanctuary?.done.length || 0) >= unlock.grandProject;
  return false;
}

// The equipped tool for a harvest skill: { kind, item, tier, quality }, or null.
export function toolFor(state, data, skillId) {
  const kind = skillById(data, skillId)?.tool;
  const eq = kind && state.tools[kind];
  const item = eq && data.items.items[eq.item];
  if (!item) return null;
  return { kind, item: eq.item, tier: item.tier, quality: eq.quality };
}

// Can the player harvest this node? { ok, reason } with a player-readable reason. Pets can work
// any node the player can (the player's tools and skill levels open it for everyone).
export function nodeCheck(state, data, zoneId, skillId, nodeId) {
  const zone = zoneById(data, zoneId);
  const skill = skillById(data, skillId);
  const node = findNode(data, { zone: zoneId, skill: skillId, node: nodeId });
  if (!zone || !skill || !node) return { ok: false, reason: "There's nothing like that here." };
  if (!zoneUnlocked(state, data, zoneId)) return { ok: false, reason: `${zone.name} isn't open yet.` };
  const level = node.level || 1;
  if (skillLevel(state, skillId) < level) return { ok: false, reason: `Needs ${skill.name} level ${level}.` };
  const tool = toolFor(state, data, skillId);
  if (!tool || tool.tier < zone.tier) {
    const kind = data.tools.kinds.find((k) => k.id === skill.tool);
    const tier = data.tools.tiers.find((t) => t.tier === zone.tier);
    return { ok: false, reason: `Needs a ${tier ? tier.name : `tier ${zone.tier}`} ${kind ? kind.name : 'tool'} or better.` };
  }
  return { ok: true, reason: '' };
}

// Base length of one action before speed bonuses (also sets its XP).
function baseActionMs(data, task) {
  const b = data.balance.harvest;
  const tier = zoneById(data, task.zone).tier;
  return b.actionSeconds[task.skill] * 1000 * b.tierDurationMult[tier - 1];
}

// Prestige tools (Starmetal, tools.json tier `prestige`) work faster.
function prestigeSpeed(data, tool) {
  return tool && data.tools.tiers.find((t) => t.tier === tool.tier)?.prestige ? data.balance.harvest.prestigeSpeed : 0;
}

// Length of one action for this worker, after speed bonuses: the tool (quality, prestige) and the
// Grand Projects for everyone; meals, potions and Mastery stars for the player; pet speed and
// the Elder Grove's legacy bonus for pets.
export function actionMs(state, data, workerId, task) {
  const b = data.balance.harvest;
  const tool = toolFor(state, data, task.skill);
  let speed = 1 + (tool ? b.toolQualitySpeed[tool.quality] || 0 : 0) + prestigeSpeed(data, tool) + sanctuaryBonus(state, data, 'speed', task.skill);
  if (workerId === 'player') speed += buffSpeed(state, task.skill) + masterySpeed(state, data, task.skill);
  if (isPet(state, workerId)) speed *= petSpeed(data, state.pets.list[workerId], task.skill) * (1 + legacyValue(state, data, 'speed', task.skill));
  return baseActionMs(data, task) / speed;
}

function actionXp(data, task, node) {
  const b = data.balance.harvest;
  return (baseActionMs(data, task) / 1000) * b.xpPerActionSecond * (1 + (node.level || 1) * b.xpPerNodeLevel);
}

function rareChance(state, data, workerId, task) {
  const b = data.balance.harvest;
  const tool = toolFor(state, data, task.skill);
  const p = b.rareFindBase + (tool ? b.toolQualityRare[tool.quality] || 0 : 0);
  if (isPet(state, workerId)) return p + petRareBonus(data, state.pets.list[workerId], task.skill);
  return workerId === 'player' ? p * b.playerRareMult : p;
}

// Chance per action of finding a treasure map (fishing finds more). A pet's Luck multiplies it: its
// rare-find bonus measured in base rare chances, times petLuckMapMult; the Deep branch and talents add more.
function mapChance(state, data, workerId, task) {
  const b = data.balance.treasure;
  const p = b.mapChance[task.skill] ?? b.mapChance.other;
  if (!isPet(state, workerId)) return p;
  const pet = state.pets.list[workerId];
  const luck = petRareBonus(data, pet) / data.balance.harvest.rareFindBase;
  return p * (1 + luck * b.petLuckMapMult) * (1 + effectValue(data, pet, 'maps'));
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

// Everything one worker's action needs that only changes with a level, a heart or a Mastery star
// within a span of game time (tools, buffs, talents, projects and elders change only at span
// boundaries or by command). Workers repeat one action thousands of times while away, so this is
// worked out once and reused while profileKey stays the same (docs/architecture.md "Phase 10").
function profileKey(state, data, pet, task) {
  if (pet) {
    const marks = data.balance.pets.bond.hearts;
    let hearts = 0;
    while (hearts < marks.length && pet.bond >= marks[hearts]) hearts++;
    return pet.level * 64 + hearts;
  }
  return masteryStars(state, data, task.skill);
}

export function actionProfile(state, data, workerId, prev = null) {
  const task = state.workers[workerId].task;
  const pet = isPet(state, workerId) ? state.pets.list[workerId] : null;
  const key = profileKey(state, data, pet, task);
  if (prev && prev.task === task && prev.key === key && prev.data === data) return prev;
  const node = findNode(data, task);
  return {
    data, task, key, node, pet,
    ms: actionMs(state, data, workerId, task),
    xp: actionXp(data, task, node),
    // Pet talents and branches: by-product drops (chance below 1) come more often; extraItem may add
    // one more of the main drop. Workers without these effects roll exactly as before.
    byproduct: pet ? effectValue(data, pet, 'byproduct', task.skill) : 0,
    extra: pet ? effectValue(data, pet, 'extraItem', task.skill) : 0,
    main: node.drops.find((d) => d.chance >= 1),
    rares: zoneById(data, task.zone).rare?.[task.skill],
    rareChance: rareChance(state, data, workerId, task),
    mapItem: mapItemFor(data, task.zone),
    mapChance: mapChance(state, data, workerId, task),
  };
}

// One finished action for a worker: roll drops and rare finds (from the worker's own random
// stream), fill the bag. The player earns skill XP; a pet's XP is returned for the pets system
// to add. Returns { xp } (the XP the action is worth). `profile` (from actionProfile) is optional.
export function completeAction(state, ctx, workerId, profile = null) {
  const { data } = ctx;
  const w = state.workers[workerId];
  const task = w.task;
  const p = actionProfile(state, data, workerId, profile);
  const { node, pet } = p;
  const items = {};
  for (const d of node.drops) {
    if (d.chance < 1 && !chance(w, Math.min(1, d.chance * (1 + p.byproduct)))) continue;
    const qty = randomInt(w, d.qty[0], d.qty[1]);
    if (qty > 0) items[d.item] = (items[d.item] || 0) + qty;
  }
  if (p.extra > 0 && p.main && chance(w, p.extra)) items[p.main.item] = (items[p.main.item] || 0) + 1;
  let rare = false;
  if (p.rares && p.rares.length && chance(w, p.rareChance)) {
    const pick = pickWeighted(w, p.rares);
    items[pick.item] = (items[pick.item] || 0) + 1;
    rare = true;
  }
  if (p.mapItem && chance(w, p.mapChance)) {
    items[p.mapItem] = (items[p.mapItem] || 0) + 1;
    state.stats.maps = (state.stats.maps || 0) + 1;
  }
  for (const itemId in items) addItem(state, itemId, items[itemId]);
  const xp = p.xp;
  state.stats.actions[task.skill] = (state.stats.actions[task.skill] || 0) + 1;
  const petXp = pet ? xp * data.balance.pets.xpPerSkillXp : 0;
  ctx.emit?.({ type: 'harvest', worker: workerId, zone: task.zone, skill: task.skill, node: task.node, items, xp: pet ? 0 : xp, petXp, rare });
  if (!pet) addXp(state, ctx, task.skill, xp);
  return { xp: petXp };
}

// Clears a worker's harvest task if its zone or node vanished from the data (or its skill did). Returns true if it did.
export function dropStaleTask(data, w) {
  if (w.task && isHarvestTask(data, w.task) && !findNode(data, w.task)) {
    w.task = null;
    w.progressMs = 0;
    return true;
  }
  return false;
}

export function advance(state, ms, ctx) {
  for (const [workerId, w] of Object.entries(state.workers)) {
    if (!w.task || isPet(state, workerId) || !isHarvestTask(ctx.data, w.task)) continue;
    if (dropStaleTask(ctx.data, w)) continue;
    w.progressMs += ms;
    // Re-read the duration after each action: a Mastery star can change it (the profile refreshes then).
    let prof = actionProfile(state, ctx.data, workerId);
    while (w.progressMs >= prof.ms) {
      w.progressMs -= prof.ms;
      completeAction(state, ctx, workerId, prof);
      prof = actionProfile(state, ctx.data, workerId, prof);
    }
  }
}

export const commands = {
  'harvest/assign': (state, { worker = 'player', zone, skill, node }, ctx) => {
    const w = state.workers[worker];
    if (!w) throw new Error('Nobody is there to do that.');
    const check = nodeCheck(state, ctx.data, zone, skill, node);
    if (!check.ok) throw new Error(check.reason);
    const t = w.task;
    if (t && t.zone === zone && t.skill === skill && t.node === node) return;
    w.task = { zone, skill, node };
    w.progressMs = 0;
    w.resume = null;
  },
  'harvest/stop': (state, { worker = 'player' }) => {
    const w = state.workers[worker];
    if (!w) return;
    w.task = null;
    w.progressMs = 0;
    w.resume = null;
  },
};
