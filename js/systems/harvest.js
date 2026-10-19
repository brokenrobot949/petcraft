// Harvesting: workers repeat one action in one zone (docs/design.md "Core loop", "World",
// "Player tools"). Phase 2 has one worker, the player; pets join in Phase 3.
// Each action takes a fixed time; progress carries across ticks, so live play and offline
// catch-up (any chunk size) give the same results.
import { chance, random, randomInt } from '../core/rng.js';
import { addItem } from './bag.js';
import { addXp, skillLevel } from './skills.js';

export const id = 'harvest';

export function init(state, ctx) {
  const { data } = ctx;
  for (const kind of data.tools.kinds) {
    if (!state.tools[kind.id] && kind.starter) state.tools[kind.id] = { item: kind.starter, quality: 'normal' };
  }
  for (const s of data.skills.skills) {
    if (s.type === 'harvest' && !(s.id in state.stats.actions)) state.stats.actions[s.id] = 0;
  }
  if (!state.workers.player) state.workers.player = { task: null, progressMs: 0 };
  // Drop a task whose zone or node no longer exists in the data.
  for (const w of Object.values(state.workers)) {
    if (w.task && !findNode(data, w.task)) {
      w.task = null;
      w.progressMs = 0;
    }
  }
}

// ---- lookups ----

function zoneById(data, zoneId) {
  return data.zones.zones.find((z) => z.id === zoneId) || null;
}

function skillById(data, skillId) {
  return data.skills.skills.find((s) => s.id === skillId) || null;
}

function findNode(data, { zone, skill, node }) {
  return zoneById(data, zone)?.harvest?.[skill]?.find((n) => n.id === node) || null;
}

// ---- selectors (the UI may call these) ----

export function workerTask(state, workerId) {
  return state.workers[workerId]?.task || null;
}

export function zoneUnlocked(state, data, zoneId) {
  const unlock = zoneById(data, zoneId)?.unlock;
  if (!unlock) return false;
  if (unlock.renown != null) return state.renown.rank >= unlock.renown;
  return false; // other unlock kinds (Grand Projects) arrive in later phases
}

// The equipped tool for a harvest skill: { kind, item, tier, quality }, or null.
export function toolFor(state, data, skillId) {
  const kind = skillById(data, skillId)?.tool;
  const eq = kind && state.tools[kind];
  const item = eq && data.items.items[eq.item];
  if (!item) return null;
  return { kind, item: eq.item, tier: item.tier, quality: eq.quality };
}

// Can the player harvest this node? { ok, reason } with a player-readable reason.
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

// Length of one action for this worker, after speed bonuses.
export function actionMs(state, data, workerId, task) {
  const b = data.balance.harvest;
  const tool = toolFor(state, data, task.skill);
  const speed = 1 + (tool ? b.toolQualitySpeed[tool.quality] || 0 : 0);
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
  return workerId === 'player' ? p * b.playerRareMult : p;
}

function pickWeighted(state, list) {
  const total = list.reduce((sum, e) => sum + (e.weight || 1), 0);
  let r = random(state) * total;
  for (const e of list) {
    r -= e.weight || 1;
    if (r < 0) return e;
  }
  return list[list.length - 1];
}

// One finished action: roll drops and rare finds, fill the bag, give XP.
function doAction(state, ctx, workerId, task, node) {
  const { data } = ctx;
  const items = {};
  for (const d of node.drops) {
    if (d.chance < 1 && !chance(state, d.chance)) continue;
    const qty = randomInt(state, d.qty[0], d.qty[1]);
    if (qty > 0) items[d.item] = (items[d.item] || 0) + qty;
  }
  let rare = false;
  const rares = zoneById(data, task.zone).rare?.[task.skill];
  if (rares && rares.length && chance(state, rareChance(state, data, workerId, task))) {
    const pick = pickWeighted(state, rares);
    items[pick.item] = (items[pick.item] || 0) + 1;
    rare = true;
  }
  for (const [itemId, qty] of Object.entries(items)) addItem(state, itemId, qty);
  const xp = actionXp(data, task, node);
  state.stats.actions[task.skill] = (state.stats.actions[task.skill] || 0) + 1;
  ctx.emit?.({ type: 'harvest', worker: workerId, zone: task.zone, skill: task.skill, node: task.node, items, xp, rare });
  addXp(state, ctx, task.skill, xp);
}

export function advance(state, ms, ctx) {
  for (const [workerId, w] of Object.entries(state.workers)) {
    if (!w.task) continue;
    const node = findNode(ctx.data, w.task);
    if (!node) {
      w.task = null;
      w.progressMs = 0;
      continue;
    }
    const dur = actionMs(state, ctx.data, workerId, w.task);
    w.progressMs += ms;
    while (w.progressMs >= dur) {
      w.progressMs -= dur;
      doAction(state, ctx, workerId, w.task, node);
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
  },
  'harvest/stop': (state, { worker = 'player' }) => {
    const w = state.workers[worker];
    if (!w) return;
    w.task = null;
    w.progressMs = 0;
  },
};
