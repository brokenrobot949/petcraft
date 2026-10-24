// The Grand Projects at the Old Sanctuary (docs/design.md "Endgame"): five projects from
// data/projects.json, opened at Renown balance.sanctuary.openRenown and built in order. Each has
// three stages; a stage needs items (Sanctuary Relics among them) and coins, delivered bit by bit
// from the bag. A full stage completes at once and gives Renown XP; a finished project's reward
// applies forever (sanctuaryBonus, read where each bonus applies). The fifth project ends the
// story and opens the Heartgrove (zones with unlock.grandProject).
// state.sanctuary = { project, stage, delivered, coins, done, scenes } (docs/architecture.md "Phase 9").
import { parseKey, itemDef } from './bag.js';
import { addRenownXp } from './renown.js';
import { spendCoins } from './coins.js';

export const id = 'sanctuary';

export function init(state, ctx) {
  const sa = state.sanctuary;
  const list = projectDefs(ctx.data);
  // A project list that got shorter: everything past its end counts as finished.
  if (sa.project > list.length) sa.project = list.length;
  const def = list[sa.project];
  if (def && sa.stage >= def.stages.length) sa.stage = def.stages.length - 1;
  sa.done = sa.done.filter((p, i, a) => a.indexOf(p) === i);
  sa.scenes = sa.scenes.filter((p) => sa.done.includes(p));
}

const projectDefs = (data) => data.projects?.projects || [];

// ---- selectors ----

export function sanctuaryOpen(state, data) {
  return state.renown.rank >= data.balance.sanctuary.openRenown;
}

export function projectsDone(state) {
  return state.sanctuary.done.length;
}

// All five projects are finished: the story's ending.
export function ended(state, data) {
  const n = projectDefs(data).length;
  return n > 0 && state.sanctuary.project >= n;
}

// [{ ...def, index, status: 'done' | 'current' | 'locked' }]
export function projectList(state, data) {
  const sa = state.sanctuary;
  return projectDefs(data).map((def, index) => ({
    ...def,
    index,
    status: index < sa.project ? 'done' : index === sa.project ? 'current' : 'locked',
  }));
}

// Bag keys holding this base item, Normal first, then better qualities (what deliveries take).
function keysFor(state, data, itemId) {
  const order = data.tools.qualities.map((q) => q.id);
  return Object.keys(state.bag)
    .filter((k) => parseKey(k).id === itemId && state.bag[k] > 0)
    .sort((a, b) => order.indexOf(parseKey(a).quality) - order.indexOf(parseKey(b).quality));
}

function bagHas(state, data, itemId) {
  return keysFor(state, data, itemId).reduce((n, k) => n + state.bag[k], 0);
}

// The stage being built, or null (not open yet, or all done):
// { project, index, stage, stages, name, needs: [{ item, need, have, bag }], ready }
// item is an item id or 'coins'; have = delivered so far; bag = what the player holds now.
// ready: something can be delivered right now.
export function currentStage(state, data) {
  const sa = state.sanctuary;
  const def = projectDefs(data)[sa.project];
  if (!def || !sanctuaryOpen(state, data)) return null;
  const st = def.stages[sa.stage];
  const needs = Object.entries(st.items || {}).map(([item, need]) => ({ item, need, have: Math.min(need, sa.delivered[item] || 0), bag: bagHas(state, data, item) }));
  if (st.coins > 0) needs.push({ item: 'coins', need: st.coins, have: Math.min(st.coins, sa.coins), bag: state.coins });
  const ready = needs.some((n) => n.have < n.need && n.bag > 0);
  return { project: def, index: sa.project, stage: sa.stage, stages: def.stages.length, name: st.name, needs, ready };
}

// Sum of one reward kind over the finished projects (for `speed`, only rewards naming the skill).
export function sanctuaryBonus(state, data, kind, skillId = null) {
  let v = 0;
  const defs = projectDefs(data);
  for (let i = 0; i < Math.min(state.sanctuary.project, defs.length); i++) {
    for (const r of defs[i].reward || []) {
      if (r.kind !== kind) continue;
      if (r.skills && !(skillId && r.skills.includes(skillId))) continue;
      v += r.value || 0;
    }
  }
  return v;
}

// A finished project waiting for its scene on the Home tab, or null.
export function pendingScene(state) {
  return state.sanctuary.scenes[0] || null;
}

// Home badge: something can be delivered now, or a scene is waiting.
export function sanctuaryNotice(state, data) {
  return !!pendingScene(state) || !!currentStage(state, data)?.ready;
}

// A player-readable line for one reward.
export function rewardText(data, r) {
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const names = (r.skills || []).map((s) => data.skills.skills.find((x) => x.id === s)?.name || s).join(' and ');
  switch (r.kind) {
    case 'craftSpeed': return `+${pct(r.value)} craft speed at every station`;
    case 'petRest': return `Pets rest ${pct(r.value)} faster`;
    case 'mealStrength': return `Meals are ${pct(r.value)} stronger`;
    case 'garden': return `+${pct(r.value)} Garden harvests`;
    case 'speed': return `+${pct(r.value)} ${names} speed`;
    case 'reveal': return `+${Math.round(r.value * 1000) / 10} points to find wild monsters while tracking`;
    case 'heartgrove': return 'Opens the Heartgrove';
    default: return '';
  }
}

// ---- changes ----

// Takes up to `want` of an item (or coins) toward the current stage. Returns the amount moved.
function give(state, ctx, st, item, want) {
  const sa = state.sanctuary;
  if (item === 'coins') {
    const n = Math.min(want, Math.max(0, (st.coins || 0) - sa.coins), state.coins);
    if (n > 0) {
      spendCoins(state, n);
      sa.coins += n;
    }
    return n;
  }
  const need = Math.max(0, (st.items?.[item] || 0) - (sa.delivered[item] || 0));
  let left = Math.min(want, need);
  let moved = 0;
  for (const key of keysFor(state, ctx.data, item)) {
    if (left <= 0) break;
    const n = Math.min(left, state.bag[key]);
    state.bag[key] -= n;
    if (!state.bag[key]) delete state.bag[key];
    left -= n;
    moved += n;
  }
  if (moved) sa.delivered[item] = (sa.delivered[item] || 0) + moved;
  return moved;
}

function stageFull(state, st) {
  const sa = state.sanctuary;
  return Object.entries(st.items || {}).every(([item, n]) => (sa.delivered[item] || 0) >= n) && sa.coins >= (st.coins || 0);
}

// The stage is complete: Renown, then the next stage, or the project is done.
function completeStage(state, ctx) {
  const { data } = ctx;
  const sa = state.sanctuary;
  const def = projectDefs(data)[sa.project];
  ctx.emit?.({ type: 'projectStage', project: def.id, stage: sa.stage });
  sa.delivered = {};
  sa.coins = 0;
  if (sa.stage + 1 < def.stages.length) {
    sa.stage += 1;
  } else {
    sa.project += 1;
    sa.stage = 0;
    if (!sa.done.includes(def.id)) sa.done.push(def.id);
    if (!sa.scenes.includes(def.id)) sa.scenes.push(def.id);
    ctx.emit?.({ type: 'projectDone', project: def.id });
  }
  addRenownXp(state, ctx, data.balance.sanctuary.renownPerStage, 'project');
}

// Used by test mode: finish the current stage without paying for it.
export function forceStage(state, ctx) {
  if (!projectDefs(ctx.data)[state.sanctuary.project]) throw new Error('Every Grand Project is finished.');
  completeStage(state, ctx);
}

export const commands = {
  // item: an item id or 'coins'; none = everything the player can give. qty: at most this many.
  'sanctuary/deliver': (state, { item = null, qty = Infinity }, ctx) => {
    const { data } = ctx;
    const def = projectDefs(data)[state.sanctuary.project];
    if (!def) throw new Error('Every Grand Project is finished!');
    if (!sanctuaryOpen(state, data)) throw new Error(`The Old Sanctuary opens at Renown ${data.balance.sanctuary.openRenown}.`);
    const st = def.stages[state.sanctuary.stage];
    const want = Number.isFinite(qty) ? Math.floor(qty) : Infinity;
    if (!(want > 0)) throw new Error('Pick an amount above 0.');
    const kinds = item ? [item] : [...Object.keys(st.items || {}), 'coins'];
    if (item && item !== 'coins' && !st.items?.[item]) throw new Error(`This stage doesn't need ${itemDef(data, item)?.name || item}.`);
    const items = {};
    let coins = 0;
    for (const k of kinds) {
      const n = give(state, ctx, st, k, want);
      if (k === 'coins') coins += n;
      else if (n) items[k] = n;
    }
    if (!coins && !Object.keys(items).length) throw new Error(item ? "You don't have any of that to give yet." : 'You have nothing this stage still needs.');
    ctx.emit?.({ type: 'delivered', items, coins });
    if (stageFull(state, st)) completeStage(state, ctx);
  },
  // The player watched a finished project's scene on the Home tab.
  'sanctuary/sceneSeen': (state, { project }) => {
    state.sanctuary.scenes = state.sanctuary.scenes.filter((p) => p !== project);
  },
};
