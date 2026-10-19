// Balance simulator v1: plays the real game with a scripted player for N days and records what
// happened. No DOM and no window here: index.html drives it today, a Node runner could tomorrow.
// The player acts only through game.dispatch (inside policy.js); time passes only through
// game.advance (short active play) and game.catchUp (time away, capped like a real player's).
import { createGame } from '../../js/core/game.js';
import { createInitialState } from '../../js/core/state.js';
import { offlineCapMs } from '../../js/core/time.js';
import { xpToNext } from '../../js/systems/skills.js';
import { parseKey } from '../../js/systems/bag.js';
import { createPolicy } from './policy.js';

const MIN = 60000;
const HOUR = 3600000;
const ACTIVE_MS = 3 * MIN;          // a check-in is about 3 minutes of decisions
const IDLE_CHUNK_MS = 30 * MIN;     // time away is caught up in half-hour pieces (finer milestone times)

export const PLAYERS = {
  regular: { label: 'Regular (8:00, 12:30, 18:00, 22:00)', checkIns: [[8, 0], [12, 30], [18, 0], [22, 0]] },
  light: { label: 'Light (8:00, 20:00)', checkIns: [[8, 0], [20, 0]] },
};

// Design-doc pacing milestones that cannot happen yet (docs/design.md "Pacing targets").
export const NOT_YET = [
  ['Second pet tamed', 'day 1-2'],
  ['Whisperwood open (Renown 3)', 'day 1'],
  ['First stage-2 evolution', 'day 2'],
  ['Stonecrag Hills open (Renown 6)', 'day 4-5'],
  ['First stage-3 evolution', 'day 8-10'],
  ['Mistfen Marsh open (Renown 10)', 'week 2-3'],
  ['Grand Projects open (Renown 12)', 'week 3'],
  ['Emberfall Caldera open (Renown 15)', 'week 5'],
  ['First pet retired to the Elder Grove', 'week 6-8'],
  ['Ending (Grand Project 5)', 'week 8-10'],
  ['Bestiary complete', 'month 4 or later'],
];

// Local-time helpers. Day index 0 = 2026-10-19.
const at = (d, h, m = 0) => new Date(2026, 9, 19 + d, h, m, 0, 0).getTime();
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const START_MS = at(0, 8, 0);
export function fmtWhen(ms) {
  const day = Math.floor((new Date(ms).setHours(0, 0, 0, 0) - new Date(START_MS).setHours(0, 0, 0, 0)) / 86400000 + 0.5) + 1;
  return `Day ${day} ${hhmm(ms)}`;
}

export function totalXp(state, balance, skillId) {
  const s = state.skills[skillId];
  let t = s.xp;
  for (let l = 1; l < s.level; l++) t += xpToNext(l, balance);
  return t;
}

function milestoneList(data) {
  const skills = data.skills.skills.filter((s) => s.type === 'harvest' || s.type === 'craft');
  const tier = (state, kind) => data.items.items[state.tools[kind]?.item]?.tier || 0;
  const kinds = data.tools.kinds.map((k) => k.id);
  const list = [
    { id: 'pet', label: 'First pet hatched', test: (s) => Object.keys(s.pets.list).length > 0 },
    { id: 'plank', label: 'First pine plank', test: (s) => (s.stats.crafts.pine_plank || 0) > 0 },
    { id: 'bar', label: 'First copper bar', test: (s) => (s.stats.crafts.copper_bar || 0) > 0 },
    { id: 'building', label: 'First building upgrade (target: 10 minutes)', test: (s) => Object.values(s.buildings).some((b) => b.tier >= 2) },
  ];
  for (const lvl of [5, 10, 20]) {
    for (const sk of skills) list.push({ id: `${sk.id}${lvl}`, label: `${sk.name} reaches ${lvl}`, test: (s) => s.skills[sk.id].level >= lvl });
  }
  list.push({ id: 'tool1', label: 'First copper tool equipped', test: (s) => kinds.some((k) => tier(s, k) >= 2) });
  for (const k of data.tools.kinds) list.push({ id: `tool_${k.id}`, label: `  copper ${k.name.toLowerCase()} equipped`, test: (s) => tier(s, k.id) >= 2 });
  list.push({ id: 'tool6', label: `All ${kinds.length} copper tools equipped`, test: (s) => kinds.every((k) => tier(s, k) >= 2) });
  for (const b of data.buildings.buildings) {
    list.push({ id: `${b.id}2`, label: `  ${b.name} tier 2`, test: (s) => (s.buildings[b.id]?.tier || 0) >= 2 });
  }
  list.push({ id: 'fine', label: 'First Fine item crafted', test: (s, seen) => !!seen.fine });
  list.push({ id: 'masterwork', label: 'First Masterwork item crafted', test: (s, seen) => !!seen.masterwork });
  return list;
}

// ---- one run ----
export function runSim(data, opts = {}) {
  const { days = 30, seed = 12345, player = 'regular' } = opts;
  const cfg = PLAYERS[player];
  if (!cfg) throw new Error(`unknown player ${player}`);
  const t0 = globalThis.performance ? performance.now() : Date.now();

  let simNow = START_MS;
  const s0 = createInitialState(START_MS);
  s0.rng = seed;
  s0.workers.player.rng = seed + 1;
  const game = createGame(data, s0, { clock: () => simNow });
  const policy = createPolicy(data);
  const balance = data.balance;
  const skillDefs = data.skills.skills.filter((s) => s.type === 'harvest' || s.type === 'craft');

  const seen = { fine: 0, masterwork: 0 };
  const noteQuality = (key) => {
    const q = parseKey(key).quality;
    if ((q === 'fine' || q === 'masterwork') && !seen[q]) seen[q] = simNow;
  };
  const pets = { work: 0, rest: 0 };
  game.onEvents((evs) => {
    for (const e of evs) {
      if (e.type === 'craft') noteQuality(e.item);
      else if (e.type === 'petTime') {
        pets.work += e.workMs;
        pets.rest += e.restMs;
      }
    }
  });
  const foldSummary = (sum) => {
    for (const p of Object.values(sum.pets)) {
      pets.work += p.workMs;
      pets.rest += p.restMs;
    }
    for (const st of Object.values(sum.stations)) for (const key of Object.keys(st.items)) noteQuality(key);
  };

  // milestones
  const milestones = milestoneList(data).map((m) => ({ ...m, at: null }));
  const observe = () => {
    const state = game.getState();
    for (const m of milestones) if (m.at == null && m.test(state, seen)) m.at = simNow;
  };

  // daily snapshots at 23:59
  const snapshots = [];
  let snapIdx = 0;
  const snapTimes = [];
  for (let d = 0; d < days; d++) snapTimes.push(at(d, 23, 59));
  const snap = () => {
    const state = game.getState();
    const levels = {}, xp = {};
    for (const sk of skillDefs) {
      levels[sk.id] = state.skills[sk.id].level;
      xp[sk.id] = totalXp(state, balance, sk.id);
    }
    snapshots.push({ day: snapIdx + 1, time: simNow, levels, xp, coins: state.coins, bag: { ...state.bag }, petWorkMs: pets.work, petRestMs: pets.rest });
    snapIdx++;
  };
  const afterTime = () => {
    observe();
    while (snapIdx < snapTimes.length && simNow >= snapTimes[snapIdx]) snap();
  };

  // time away: sim clock runs the whole gap, game time only up to the offline cap
  function idleTo(target) {
    let capLeft = offlineCapMs(game.getState(), balance);
    while (simNow < target) {
      let dt = Math.min(IDLE_CHUNK_MS, target - simNow);
      if (snapIdx < snapTimes.length && snapTimes[snapIdx] > simNow) dt = Math.min(dt, snapTimes[snapIdx] - simNow);
      const gameMs = Math.max(0, Math.min(dt, capLeft));
      if (gameMs > 0) {
        simNow += gameMs;
        foldSummary(game.catchUp(gameMs));
        capLeft -= gameMs;
        simNow += dt - gameMs;
      } else {
        simNow += dt;
      }
      afterTime();
    }
  }

  const checkIns = [];
  for (let d = 0; d < days; d++) for (const [h, m] of cfg.checkIns) checkIns.push(at(d, h, m));
  const end = at(days - 1, 23, 59);
  const stepMs = opts.stepMs || 1000;
  let sessions = 0;

  for (let i = 0; i < checkIns.length; i++) {
    idleTo(checkIns[i]);
    const next = i + 1 < checkIns.length ? checkIns[i + 1] : end;
    const horizonMs = Math.max(0, Math.min(next - (checkIns[i] + ACTIVE_MS), offlineCapMs(game.getState(), balance)));
    policy.run(game, { now: simNow, horizonMs });
    observe();
    for (let t = 0; t < ACTIVE_MS; t += stepMs) {
      simNow += stepMs;
      game.advance(stepMs);
      afterTime();
    }
    policy.run(game, { now: simNow, horizonMs });
    observe();
    sessions++;
  }
  idleTo(end);

  const result = {
    player, days, seed, sessions,
    skillIds: skillDefs.map((s) => s.id),
    skillNames: Object.fromEntries(skillDefs.map((s) => [s.id, s.name])),
    milestones: milestones.map((m) => ({ label: m.label, at: m.at, minutes: m.at == null ? null : Math.round((m.at - START_MS) / MIN) })),
    notYet: NOT_YET,
    snapshots,
    refusals: [...policy.refusals.entries()].sort((a, b) => b[1] - a[1]),
    dispatches: policy.dispatches,
    petWorkMs: pets.work,
    petRestMs: pets.rest,
    final: finalSummary(game.getState(), data),
  };
  result.flags = computeFlags(result, data);
  result.elapsedMs = (globalThis.performance ? performance.now() : Date.now()) - t0;
  return result;
}

function finalSummary(state, data) {
  const tools = Object.fromEntries(Object.entries(state.tools).map(([k, v]) => [k, v.quality === 'normal' ? v.item : `${v.item}:${v.quality}`]));
  const pets = Object.values(state.pets.list).map((p) => ({ name: p.name, level: p.level, bond: p.bond }));
  return { tools, pets };
}

// ---- flags ----
function computeFlags(r, data) {
  const flags = [];
  const items = data.items.items;
  const snaps = r.snapshots;
  if (!snaps.length) return flags;

  // items with some use: a recipe input, food, a buff, or a tool
  const used = new Set();
  for (const rc of data.recipes.recipes) for (const i of Object.keys(rc.inputs)) used.add(i);
  for (const [id, d] of Object.entries(items)) if (d.food || d.buff || d.tool) used.add(id);

  const byBase = {}; // base id -> counts per day
  const baseIds = new Set();
  for (const s of snaps) for (const k of Object.keys(s.bag)) baseIds.add(parseKey(k).id);
  for (const id of baseIds) {
    byBase[id] = snaps.map((s) => Object.entries(s.bag).reduce((n, [k, c]) => n + (parseKey(k).id === id ? c : 0), 0));
  }
  const name = (id) => items[id]?.name || id;
  for (const [id, series] of Object.entries(byBase)) {
    const last = series[series.length - 1];
    if (last < 5) continue;
    let rising = 0;
    for (let i = 1; i < series.length; i++) if (series[i] >= series[i - 1]) rising++;
    const alwaysUp = series.length > 1 && rising === series.length - 1 && last > series[0];
    if (!used.has(id) && alwaysUp) {
      flags.push({ kind: 'pile', text: `${name(id)} piles up with no use: ${last} in the bag after day ${snaps.length}, never fell on any day. (Not a recipe input, food, buff or tool.)` });
    } else if (used.has(id) && series.length > 7 && last >= 100 && last > series[series.length - 8]) {
      flags.push({ kind: 'stock', text: `${name(id)} stock keeps growing (${series[series.length - 8]} -> ${last} over the last 7 days) although it has a use: consumption is too slow or the policy over-harvests it.` });
    }
  }

  // skills that never gained XP, and skills that stalled
  const lastSnap = snaps[snaps.length - 1];
  for (const id of r.skillIds) {
    if (lastSnap.xp[id] <= 0) flags.push({ kind: 'skill', text: `${r.skillNames[id]}: the policy never gained any XP in this skill.` });
    else if (snaps.length > 7 && lastSnap.xp[id] === snaps[snaps.length - 8].xp[id]) flags.push({ kind: 'skill', text: `${r.skillNames[id]}: no XP at all in the last 7 days.` });
  }
  flags.push({ kind: 'info', text: 'Taming: a special skill with no way to train it yet (Phase 7); not checked.' });

  // coins
  if (snaps.every((s) => s.coins === 0)) flags.push({ kind: 'coins', text: "Coins don't exist yet (the balance is 0 every day), so the 'coins only go up' check can't run." });
  else {
    const up = snaps.every((s, i) => i === 0 || s.coins >= snaps[i - 1].coins);
    if (up) flags.push({ kind: 'coins', text: `Coin balance only ever rises (${snaps[0].coins} -> ${lastSnap.coins}): no sink yet.` });
  }

  // pets resting
  const tot = r.petWorkMs + r.petRestMs;
  if (tot > 0) flags.push({ kind: 'pets', text: `Pets rested ${(100 * r.petRestMs / tot).toFixed(1)}% of their tracked time (${(r.petRestMs / HOUR).toFixed(0)} h rest, ${(r.petWorkMs / HOUR).toFixed(0)} h work).` });
  else flags.push({ kind: 'pets', text: 'No pet work/rest time was tracked.' });
  return flags;
}

// ---- CSV: one row per day ----
export function buildCsv(result) {
  const keys = new Set();
  for (const s of result.snapshots) for (const k of Object.keys(s.bag)) keys.add(k);
  const bagKeys = [...keys].sort();
  const head = ['day', ...result.skillIds.map((id) => `level_${id}`), ...result.skillIds.map((id) => `xp_${id}`), 'coins', ...bagKeys.map((k) => `bag_${k}`)];
  const rows = [head.join(',')];
  for (const s of result.snapshots) {
    rows.push([
      s.day,
      ...result.skillIds.map((id) => s.levels[id]),
      ...result.skillIds.map((id) => Math.round(s.xp[id])),
      s.coins,
      ...bagKeys.map((k) => s.bag[k] || 0),
    ].join(','));
  }
  return rows.join('\n') + '\n';
}
