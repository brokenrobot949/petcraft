// Balance simulator v1: plays the real game with a scripted player for N days and records what
// happened. No DOM and no window here: index.html drives it today, a Node runner could tomorrow.
// The player acts only through game.dispatch (inside policy.js); time passes only through
// game.advance (short active play) and game.catchUp (time away, capped like a real player's).
import { createGame } from '../../js/core/game.js';
import { createInitialState } from '../../js/core/state.js';
import { offlineCapMs } from '../../js/core/time.js';
import { xpToNext, masteryStars } from '../../js/systems/skills.js';
import { currentStage, sanctuaryOpen, ended } from '../../js/systems/sanctuary.js';
import { xpToNextRank } from '../../js/systems/renown.js';
import { tierCost, upgradeCheck } from '../../js/systems/buildings.js';
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
  ['Bestiary complete', 'month 4 or later'],
];

// Endgame readings (Phase 9) used by the daily snapshots and the final summary.
const projectDefs = (data) => data.projects?.projects || [];
// Stages finished so far over all projects.
export function stagesDone(state, data) {
  const defs = projectDefs(data);
  let n = 0;
  for (let i = 0; i < Math.min(state.sanctuary.project, defs.length); i++) n += defs[i].stages.length;
  if (state.sanctuary.project < defs.length) n += state.sanctuary.stage;
  return n;
}
// Progress into the current stage, 0..1 (average over its needs, items and coins alike); 1 once everything is done.
function stageFraction(state, data) {
  const st = currentStage(state, data);
  if (!st) return ended(state, data) ? 1 : 0;
  const parts = st.needs.map((n) => Math.min(1, n.have / n.need));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}
export function masteryTotal(state, data) {
  return data.skills.skills.reduce((n, s) => n + masteryStars(state, data, s.id), 0);
}
const mythicsHad = (state) => Object.keys(state.bestiary || {}).filter((k) => k.startsWith('mythic.')).length;

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

const mapsHeld = (state) => Object.entries(state.bag).reduce((n, [k, c]) => n + (k.startsWith('map_') ? c : 0), 0);
const eggsHeld = (state) => (state.bag.treasure_egg || 0) + state.nest.slots.filter(Boolean).length;

export function totalXp(state, balance, skillId) {
  const s = state.skills[skillId];
  let t = s.xp;
  for (let l = 1; l < s.level; l++) t += xpToNext(l, balance);
  return t;
}

// All Renown XP earned so far (the save keeps only the progress into the current rank).
export function renownTotal(state, balance) {
  let t = state.renown.xp;
  for (let r = 1; r < state.renown.rank; r++) t += xpToNextRank(r, balance);
  return t;
}

const DAY_MIN = 1440;
// A milestone is "on time" within 25% of its target (docs/design.md "Pacing targets").
const TOLERANCE = 0.25;

function milestoneList(data) {
  const skills = data.skills.skills.filter((s) => s.type === 'harvest' || s.type === 'craft');
  const tier = (state, kind) => data.items.items[state.tools[kind]?.item]?.tier || 0;
  const kinds = data.tools.kinds.map((k) => k.id);
  const list = [
    { id: 'pet', label: 'First pet hatched', test: (s) => Object.keys(s.pets.list).length > 0 },
    { id: 'plank', label: 'First pine plank', test: (s) => (s.stats.crafts.pine_plank || 0) > 0 },
    { id: 'bar', label: 'First copper bar', test: (s) => (s.stats.crafts.copper_bar || 0) > 0 },
    { id: 'building', label: 'First building upgrade', target: 10 / DAY_MIN, targetText: '10 min', test: (s) => Object.values(s.buildings).some((b) => b.tier >= 2) },
    { id: 'tamed1', label: 'Second pet tamed (first wild catch)', target: 1.5, targetText: 'day 1-2', test: (s) => (s.stats.tamed || 0) >= 1 },
    { id: 'tamed3', label: '  Fourth pet tamed (third wild catch)', test: (s) => (s.stats.tamed || 0) >= 3 },
    { id: 'dig1', label: 'First treasure dug', test: (s) => (s.stats.digs || 0) >= 1 },
    { id: 'hatched1', label: 'First egg hatched', test: (s) => (s.stats.hatched || 0) >= 1 },
    { id: 'nest_built', label: '  Nest built', test: (s) => (s.buildings.nest?.tier || 0) >= 1 },
    { id: 'stage2', label: 'First stage-2 evolution', target: 2, targetText: 'day 2', test: (s) => (s.stats.evolved?.juvenile || 0) >= 1 },
    { id: 'stage3', label: 'First stage-3 evolution', target: 9, targetText: 'day 8-10', test: (s) => (s.stats.evolved?.adult || 0) >= 1 },
    { id: 'commission', label: 'First commission delivered', test: (s) => (s.stats.commissions || 0) + (s.stats.greats || 0) > 0 },
  ];
  // Design-doc pacing targets (days since the start; the middle of a range). Zones open at their Renown rank.
  const ZONE_TARGETS = { whisperwood: [1, 'day 1'], stonecrag: [4.5, 'day 4-5'], mistfen: [14.5, 'week 2-3'], emberfall: [32, 'week 5'] };
  for (const z of data.zones.zones) {
    const rank = z.unlock?.renown;
    if (!(rank > 1)) continue;
    const t = ZONE_TARGETS[z.id];
    list.push({ id: `zone_${z.id}`, label: `${z.name} open (Renown ${rank})`, target: t?.[0], targetText: t?.[1], test: (s) => s.renown.rank >= rank });
  }
  const projects = projectDefs(data);
  list.push({ id: 'grand', label: `Grand Projects open (Renown ${data.balance.sanctuary.openRenown})`, target: 18, targetText: 'week 3', test: (s) => sanctuaryOpen(s, data) });
  list.push({ id: 'stage1', label: '  First Grand Project stage delivered', test: (s) => stagesDone(s, data) >= 1 });
  projects.forEach((p, i) => list.push({ id: `project${i + 1}`, label: i === 0 ? `First Grand Project finished (${p.name})` : `  Grand Project ${i + 1} finished (${p.name})`, test: (s) => s.sanctuary.done.length >= i + 1 }));
  list.push({ id: 'grove', label: '  Elder Grove opened', test: (s) => !!s.elders?.open });
  list.push({ id: 'elder1', label: 'First pet retired to the Elder Grove', target: 49, targetText: 'week 6-8', test: (s) => (s.stats.retired || 0) >= 1 });
  list.push({ id: 'ending', label: `Ending (Grand Project ${projects.length || 5})`, target: 63, targetText: 'week 8-10', test: (s) => ended(s, data) });
  list.push({ id: 'mythic1', label: 'First mythic tamed', test: (s) => mythicsHad(s) >= 1 });
  for (let r = 2; r <= Math.min(15, data.balance.renown.maxRank); r++) list.push({ id: `rank${r}`, label: `  Renown rank ${r}`, test: (s) => s.renown.rank >= r });
  for (const b of ['forge', 'garden']) {
    const def = data.buildings.buildings.find((x) => x.id === b);
    if (def) list.push({ id: `${b}_built`, label: `${def.name} built`, test: (s) => (s.buildings[b]?.tier || 0) >= 1 });
  }
  const tierNames = Object.fromEntries(data.tools.tiers.map((t) => [t.tier, t.name]));
  const topTier = Math.max(...data.tools.tiers.map((t) => t.tier));
  for (let t = 3; t <= topTier; t++) list.push({ id: `tier${t}`, label: `First ${tierNames[t] || `tier ${t}`} tool equipped`, test: (s) => kinds.some((k) => tier(s, k) >= t) });
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
  let petDigs = 0; // digs done by Scout pets
  const tre = { coins: 0, eggs: 0, relics: 0, digs: 0 };
  const foldDig = (coins, its) => { tre.coins += coins; tre.eggs += its.treasure_egg || 0; tre.relics += its.sanctuary_relic || 0; };
  // Coin flow by source and sink, from the events the policy's own commands emit (all coin changes
  // are commands). Whatever the totals in state.stats show beyond these is reported as "other".
  const flow = { sold: 0, commissions: 0, buildings: 0, blueprints: 0, seeds: 0, scrolls: 0, otherBought: 0 };
  game.onEvents((evs) => {
    for (const e of evs) {
      if (e.type === 'sold') flow.sold += e.coins;
      else if (e.type === 'commissionDone') flow.commissions += e.coins;
      else if (e.type === 'learned') flow.scrolls += e.coins;
      else if (e.type === 'buildingUpgraded') flow.buildings += tierCost(data, e.building, e.tier)?.coins || 0;
      else if (e.type === 'bought') {
        const def = data.items.items[e.item];
        if (def?.category === 'blueprint') flow.blueprints += e.coins;
        else if (def?.seed) flow.seeds += e.coins;
        else flow.otherBought += e.coins;
      }
      if (e.type === 'dig') { foldDig(e.coins, e.items || {}); if (e.worker && e.worker !== 'player') petDigs++; }
      if (e.type === 'craft') noteQuality(e.item);
      else if (e.type === 'petTime') {
        pets.work += e.workMs;
        pets.rest += e.restMs;
      }
    }
  });
  const foldSummary = (sum) => {
    if (sum.treasure) foldDig(sum.treasure.coins, sum.treasure.items || {});
    for (const p of Object.values(sum.pets)) petDigs += p.digs || 0;
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
    const rTotal = renownTotal(state, balance);
    const prev = snapshots[snapshots.length - 1];
    snapshots.push({
      day: snapIdx + 1, time: simNow, levels, xp, coins: state.coins, bag: { ...state.bag }, petWorkMs: pets.work, petRestMs: pets.rest,
      pets: Object.keys(state.pets.list).length, tamed: state.stats.tamed || 0, released: state.stats.released || 0, digs: state.stats.digs || 0,
      mapsFound: state.stats.maps || 0, mapsHeld: mapsHeld(state), eggsFound: tre.eggs, eggsHeld: eggsHeld(state), hatched: state.stats.hatched || 0,
      relicsHeld: state.bag.sanctuary_relic || 0, relicsFound: tre.relics, treasureCoins: tre.coins, tamingLevel: state.skills.taming?.level || 0,
      juveniles: Object.values(state.pets.list).filter((p) => p.form === 'juvenile').length, adults: Object.values(state.pets.list).filter((p) => p.form === 'adult').length,
      talentPicks: state.stats.talentPicks || 0, assistants: Object.keys(state.crafting.assists || {}).length, petGifts: state.stats.petGifts || 0, petDigs: petDigs,
      renownRank: state.renown.rank, renownXpTotal: rTotal, renownXpDay: rTotal - (prev ? prev.renownXpTotal : 0),
      sanctOpen: sanctuaryOpen(state, data), projectsDone: state.sanctuary.done.length, stagesDone: stagesDone(state, data),
      stageFrac: stageFraction(state, data), elders: state.elders.list.length, retired: state.stats.retired || 0,
      masteryStars: masteryTotal(state, data), mythics: mythicsHad(state),
    });
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
    milestones: milestones.map((m) => milestoneResult(m, days)),
    coins: coinSummary(game.getState(), flow),
    notYet: NOT_YET,
    snapshots,
    refusals: [...policy.refusals.entries()].sort((a, b) => b[1] - a[1]),
    mapsSold: policy.mapsSold, petsReleased: policy.petsReleased,
    evolved: policy.evolveCounts, talentPicked: policy.talentPicked, assistsPosted: policy.assistsPosted, petDigsSent: policy.petDigsSent,
    eldersRetired: policy.eldersRetired, heirsPlaced: policy.heirsPlaced, deliveries: policy.deliveries,
    dispatches: policy.dispatches,
    petWorkMs: pets.work,
    petRestMs: pets.rest,
    final: finalSummary(game.getState(), data),
  };
  result.flags = computeFlags(result, data);
  result.elapsedMs = (globalThis.performance ? performance.now() : Date.now()) - t0;
  return result;
}

// One milestone for the report. With a target (days since the start) it gets a status:
// 'on time' (within 25%), 'early', 'late', or 'not reached' (late when the run is already past the window).
function milestoneResult(m, days) {
  const minutes = m.at == null ? null : Math.round((m.at - START_MS) / MIN);
  const out = { label: m.label, at: m.at, minutes, targetDays: m.target ?? null, targetText: m.targetText || null, status: null, actualDays: minutes == null ? null : minutes / DAY_MIN };
  if (m.target != null) {
    if (minutes == null) out.status = days > m.target * (1 + TOLERANCE) ? 'late (not reached)' : 'not reached yet';
    else if (out.actualDays < m.target * (1 - TOLERANCE)) out.status = 'early';
    else if (out.actualDays > m.target * (1 + TOLERANCE)) out.status = 'late';
    else out.status = 'on time';
  }
  return out;
}

// Coins earned and spent: the sources and sinks we can name, and the remainder from the state's totals.
function coinSummary(state, flow) {
  const earned = state.stats.coinsEarned || 0;
  const spent = state.stats.coinsSpent || 0;
  const named = flow.sold + flow.commissions;
  const sinks = flow.buildings + flow.blueprints + flow.seeds + flow.scrolls + flow.otherBought;
  return {
    earned, spent, balance: state.coins,
    sources: [['Selling', flow.sold], ['Commissions', flow.commissions], ['Other', Math.max(0, earned - named)]],
    sinks: [['Buildings (tier coins)', flow.buildings], ['Blueprints', flow.blueprints], ['Seeds', flow.seeds], ['Recipe scrolls', flow.scrolls],
      ['Other purchases (merchant items)', flow.otherBought], ['Rerolls and other', Math.max(0, spent - sinks)]],
  };
}

function finalSummary(state, data) {
  const tools = Object.fromEntries(Object.entries(state.tools).map(([k, v]) => [k, v.quality === 'normal' ? v.item : `${v.item}:${v.quality}`]));
  const pets = Object.values(state.pets.list).map((p) => ({ name: p.name, level: p.level, bond: p.bond }));
  const buildings = Object.fromEntries(Object.entries(state.buildings).map(([k, v]) => [k, v.tier]));
  return { tools, pets, buildings, blocked: Object.fromEntries(Object.keys(state.buildings).map((k) => { const c = upgradeCheck(state, data, k); return [k, c.ok ? "ready" : (c.reason || "") + (c.missing.length ? " Missing: " + c.missing.map((m) => `${m.item} ${m.have}/${m.need}`).join(", ") : "")]; })), renown: state.renown.rank, commissions: state.stats.commissions, greats: state.stats.greats, endgame: endgameSummary(state, data) };
}

// The Endgame section of the report: where the Grand Projects stand, the elders, Mastery.
function endgameSummary(state, data) {
  const defs = projectDefs(data);
  const st = currentStage(state, data);
  return {
    open: sanctuaryOpen(state, data), ended: ended(state, data),
    projectsDone: state.sanctuary.done.length, projectCount: defs.length, stagesDone: stagesDone(state, data),
    stageCount: defs.reduce((n, p) => n + p.stages.length, 0),
    current: st ? { project: st.project.name, stage: st.stage + 1, stages: st.stages, name: st.name, needs: st.needs.map((n) => ({ item: n.item, name: n.item === 'coins' ? 'Coins' : data.items.items[n.item]?.name || n.item, have: n.have, need: n.need, bag: n.bag })) } : null,
    relics: state.bag.sanctuary_relic || 0,
    elders: state.elders.list.map((e) => ({ name: e.name, species: e.species, level: e.level, days: e.days })),
    eggsWaiting: state.elders.eggs.length,
    mastery: Object.fromEntries(data.skills.skills.map((s) => [s.name, masteryStars(state, data, s.id)]).filter(([, n]) => n > 0)),
    masteryTotal: masteryTotal(state, data),
    mythics: mythicsHad(state),
  };
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
  for (const p of projectDefs(data)) for (const s of p.stages) for (const i of Object.keys(s.items || {})) used.add(i);
  for (const [id, d] of Object.entries(items)) if (d.food || d.buff || d.tool || d.trap || d.bait || d.lure) used.add(id);

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
    if (['map', 'egg', 'relic'].includes(items[id]?.category)) continue; // reported by the taming and treasure flags below
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
  flags.push({ kind: 'info', text: `Taming level ${lastSnap.tamingLevel} after ${snaps.length} days; ${lastSnap.tamed} pets tamed, ${lastSnap.digs} digs, ${lastSnap.hatched} eggs hatched, ${lastSnap.pets} pets owned at the end.` });
  flags.push({ kind: 'info', text: `Evolution after ${snaps.length} days: ${lastSnap.juveniles} juveniles and ${lastSnap.adults} adults now (${r.evolved.juvenile} + ${r.evolved.adult} evolutions sent); ${lastSnap.talentPicks} talents picked; ${r.assistsPosted} assistant posts, ${lastSnap.assistants} assistants at the end; ${lastSnap.petGifts} pet gifts; ${lastSnap.petDigs} pet digs.` });
  if (lastSnap.adults === 0) flags.push({ kind: 'pace', text: 'No pet reached the adult form in this run.' });
  if (lastSnap.juveniles + lastSnap.adults === 0) flags.push({ kind: 'pace', text: 'No pet evolved at all in this run.' });
  if (r.mapsSold > 0) flags.push({ kind: 'pile', text: `Maps pile up beyond what digging can use: ${lastSnap.mapsFound} found, ${lastSnap.digs} dug, ${r.mapsSold} sold off (the policy keeps only what a 10 h overnight dig covers). Maps arrive far faster than a player can dig them.` });
  if (lastSnap.mapsHeld > 20) flags.push({ kind: 'pile', text: `Maps still held at the end: ${lastSnap.mapsHeld}.` });
  if (lastSnap.eggsHeld >= 3) flags.push({ kind: 'pile', text: `Eggs pile up: ${lastSnap.eggsHeld} eggs in the bag or Nest at the end (${lastSnap.eggsFound} found, ${lastSnap.hatched} hatched).` });
  if (lastSnap.eggsFound > 0 && lastSnap.hatched === 0) flags.push({ kind: 'pile', text: `${lastSnap.eggsFound} eggs found but none hatched (Nest not built, or no free pet space).` });
  if (lastSnap.relicsHeld > 0) flags.push({ kind: 'info', text: `${lastSnap.relicsHeld} Sanctuary Relics held at the end (the policy never sells them; stages ask for 1-5 each).` });

  // Endgame (Phase 9)
  const eg = r.final.endgame;
  const openDay = snaps.findIndex((s) => s.sanctOpen);
  flags.push({ kind: 'info', text: `Endgame after ${snaps.length} days: Grand Projects ${eg.open ? 'open' : 'not open yet'}, ${eg.projectsDone}/${eg.projectCount} projects (${eg.stagesDone}/${eg.stageCount} stages) done, ${r.deliveries} deliveries sent, ${lastSnap.elders} elders (${r.eldersRetired} retired, ${r.heirsPlaced} heir eggs placed), ${eg.mythics} mythics had, Mastery ${eg.masteryTotal} stars.` });
  if (openDay >= 0 && !eg.ended) {
    const sinceOpen = snaps.length - 1 - openDay;
    if (lastSnap.stagesDone === 0 && sinceOpen >= 3) flags.push({ kind: 'pace', text: `Grand Projects opened on day ${openDay + 1} but no stage was finished in ${sinceOpen} days.${eg.current ? ' Stuck on ' + eg.current.project + ' stage ' + eg.current.stage + ': ' + eg.current.needs.filter((n) => n.have < n.need).map((n) => `${n.name} ${n.have}/${n.need}`).join(', ') + '.' : ''}` });
    else if (snaps.length > 7 && sinceOpen >= 7 && lastSnap.stagesDone === snaps[snaps.length - 8].stagesDone) flags.push({ kind: 'pace', text: `Grand Projects made no stage progress in the last 7 days (${eg.stagesDone}/${eg.stageCount} stages).${eg.current ? ' Missing: ' + eg.current.needs.filter((n) => n.have < n.need).map((n) => `${n.name} ${n.have}/${n.need}`).join(', ') + '.' : ''}` });
  }
  if (eg.current && eg.current.needs.some((n) => n.item === 'sanctuary_relic' && n.have < n.need) && lastSnap.relicsFound === 0) flags.push({ kind: 'pace', text: 'The current stage needs Sanctuary Relics but no relic was found in this run (they only come from treasure digs).' });
  if (lastSnap.adults > 0 && lastSnap.elders === 0 && snaps.length > 21) flags.push({ kind: 'pace', text: 'Adults exist but no pet retired to the Elder Grove in this run.' });

  // coins
  const c = r.coins;
  if (c.earned === 0) flags.push({ kind: 'coins', text: 'No coins were earned in this run (the policy never sold or delivered anything).' });
  else {
    // The balance never falls if nothing was ever spent and the daily balance never dropped.
    const up = c.spent === 0 && snaps.every((s, i) => i === 0 || s.coins >= snaps[i - 1].coins);
    if (up) flags.push({ kind: 'coins', text: `Coins only go up: the balance never fell (${snaps[0].coins} -> ${lastSnap.coins}); nothing was bought with them in ${snaps.length} days.` });
    flags.push({ kind: 'info', text: `Coins earned ${c.earned}, spent ${c.spent} (${Math.round(100 * c.spent / c.earned)}%), balance ${c.balance} at the end.` });
    if (c.balance > 0.5 * c.earned && c.earned > 1000) flags.push({ kind: 'coins', text: `Coins pile up: ${c.balance} of ${c.earned} earned is still unspent at the end.` });
  }

  // pacing milestones more than 25% off their target
  for (const m of r.milestones) {
    if (m.status === 'early' || m.status === 'late' || m.status === 'late (not reached)') {
      const actual = m.actualDays == null ? 'not reached' : `day ${m.actualDays.toFixed(1)}`;
      flags.push({ kind: 'pace', text: `${m.label.trim()}: ${m.status}; target ${m.targetText} (${m.targetDays.toFixed(1)} days), actual ${actual}.` });
    }
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
  const head = ['day', ...result.skillIds.map((id) => `level_${id}`), ...result.skillIds.map((id) => `xp_${id}`), 'coins', 'renown_rank', 'renown_xp_total', 'renown_xp_day', 'taming_level', 'pets', 'tamed', 'digs', 'maps_found', 'maps_held', 'eggs_found', 'eggs_held', 'hatched', 'relics_held', 'treasure_coins', 'juveniles', 'adults', 'talent_picks', 'assistants', 'pet_gifts', 'pet_digs', 'projects_done', 'stages_done', 'stage_progress_pct', 'elders', 'mastery_stars', 'mythics', ...bagKeys.map((k) => `bag_${k}`)];
  const rows = [head.join(',')];
  for (const s of result.snapshots) {
    rows.push([
      s.day,
      ...result.skillIds.map((id) => s.levels[id]),
      ...result.skillIds.map((id) => Math.round(s.xp[id])),
      s.coins, s.renownRank, Math.round(s.renownXpTotal), Math.round(s.renownXpDay), s.tamingLevel, s.pets, s.tamed, s.digs, s.mapsFound, s.mapsHeld, s.eggsFound, s.eggsHeld, s.hatched, s.relicsHeld, s.treasureCoins, s.juveniles, s.adults, s.talentPicks, s.assistants, s.petGifts, s.petDigs,
      s.projectsDone, s.stagesDone, Math.round(s.stageFrac * 100), s.elders, s.masteryStars, s.mythics,
      ...bagKeys.map((k) => s.bag[k] || 0),
    ].join(','));
  }
  return rows.join('\n') + '\n';
}
