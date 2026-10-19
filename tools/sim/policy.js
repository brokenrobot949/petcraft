// Balance simulator policy v1: what a sensible player does during one check-in (about 3 minutes).
// It only sends commands through game.dispatch and only reads state through the game's own
// selectors. No DOM, no window: a Node runner can import this file as it is.
//
// Goal order (docs/handoff.md "Balance simulator", simplified for the systems that exist now):
//   1. the copper tools (follow the recipe chain backwards to find the raw materials still short,
//      and keep the gate skills (Carpentry / Smithing 10) climbing),
//   2. keep cooked food for the pets (auto-feed eats only meals and tonics),
//   3. level the lowest skill.
import { itemCount, parseKey } from '../../js/systems/bag.js';
import { skillLevel } from '../../js/systems/skills.js';
import { nodeCheck } from '../../js/systems/harvest.js';
import { stationList, recipeCheck, recipeDef, recipesFor, itemMs, itemXp, makesQuality } from '../../js/systems/crafting.js';
import { isUpgrade } from '../../js/systems/tools.js';
import { buffOf, buffSpeed } from '../../js/systems/buffs.js';
import { petList, canPatToday, needsStarter, canAutoFeed } from '../../js/systems/pets.js';
import { localDay } from '../../js/core/time.js';

// Policy knobs (how the simulated player behaves; these are not game numbers).
const FOOD_TARGET = 40;     // keep about this many cooked meals (what auto-feed eats) in the bag: a night for 2 pets
const FOOD_RESERVE = 10;    // XP crafting never takes the last 10 of a food ingredient
const GATE_STOCK = 40;      // spare raw input kept on hand while a gate skill is still climbing
const STARTER = { archetype: 'sprout', name: 'Sim' };

export function createPolicy(data) {
  const items = data.items.items;
  const refusals = new Map();
  let dispatches = 0;

  // ---- static analysis of the data ----
  const producer = {};
  for (const r of data.recipes.recipes) if (!producer[r.output]) producer[r.output] = r;
  const harvestSkills = data.skills.skills.filter((s) => s.type === 'harvest');
  const allSkills = data.skills.skills.filter((s) => s.type === 'harvest' || s.type === 'craft');
  const copperTier = data.tools.tiers.find((t) => t.metal === 'copper').tier;
  const toolTargets = Object.entries(items).filter(([, d]) => d.tool && d.tier === copperTier).map(([id]) => id);

  // The skill levels the copper tool recipes ask for (their own level and `needs`).
  const gates = {}; // skillId -> level
  for (const id of toolTargets) {
    const r = producer[id];
    if (!r) continue;
    const stationSkill = data.recipes.stations.find((s) => s.id === r.station).skill;
    gates[stationSkill] = Math.max(gates[stationSkill] || 0, r.level || 1);
    for (const [s, l] of Object.entries(r.needs || {})) gates[s] = Math.max(gates[s] || 0, l);
  }
  const gateLevel = Math.max(1, ...Object.values(gates));
  // For each gate skill, the raw item its first recipe turns into XP (pine_log for Carpentry, copper_ore for Smithing).
  const gateInput = {};
  for (const skillId of Object.keys(gates)) {
    const station = data.recipes.stations.find((s) => s.skill === skillId);
    if (!station) continue;
    const first = recipesFor(data, station.id).slice().sort((a, b) => (a.level || 1) - (b.level || 1))
      .find((r) => Object.keys(r.inputs).every((i) => !producer[i]));
    if (first) gateInput[skillId] = Object.keys(first.inputs)[0];
  }

  // Which nodes give which item, best first. And every node by skill.
  const nodeIndex = {};
  const skillNodes = {};
  const foodNodes = [];
  for (const zone of data.zones.zones) {
    for (const [skill, nodes] of Object.entries(zone.harvest || {})) {
      for (const node of nodes) {
        const task = { zone: zone.id, skill, node: node.id };
        (skillNodes[skill] ||= []).push({ ...task, level: node.level || 1 });
        node.drops.forEach((d, i) => {
          const rate = d.chance * (d.qty[0] + d.qty[1]) / 2;
          (nodeIndex[d.item] ||= []).push({ ...task, level: node.level || 1, rate });
          if (i === 0 && items[d.item]?.food) foodNodes.push({ ...task, item: d.item, value: rate * items[d.item].food });
        });
      }
    }
  }
  for (const list of Object.values(nodeIndex)) list.sort((a, b) => b.rate - a.rate);

  // ---- command wrapper: refusals are normal, count them by message ----
  function act(game, type, payload) {
    dispatches++;
    try {
      game.dispatch(type, payload);
      return true;
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      refusals.set(m, (refusals.get(m) || 0) + 1);
      return false;
    }
  }

  // ---- stock and recipe-chain math ----
  // Normal-quality counts by item id, plus what queued batches will deliver.
  function stockMap(state) {
    const m = {};
    for (const [k, n] of Object.entries(state.bag)) {
      const { id, quality } = parseKey(k);
      if (quality === 'normal') m[id] = (m[id] || 0) + n;
    }
    for (const st of Object.values(state.crafting.stations)) {
      for (const b of st.queue) {
        const r = recipeDef(data, b.recipe);
        if (r) m[r.output] = (m[r.output] || 0) + (b.qty - b.done) * r.qty;
      }
    }
    return m;
  }

  function foodCount(state) {
    let n = 0;
    for (const [k, c] of Object.entries(state.bag)) if (canAutoFeed(data, k)) n += c;
    for (const st of Object.values(state.crafting.stations)) {
      for (const b of st.queue) {
        const r = recipeDef(data, b.recipe);
        if (r && canAutoFeed(data, r.output)) n += (b.qty - b.done) * r.qty;
      }
    }
    return n;
  }

  // Walk the recipe chain backwards: acc.raw = raw items still short, acc.make = recipe runs to
  // queue, acc.total = everything the goal needs (whether or not the bag already covers it).
  const newAcc = () => ({ raw: {}, make: {}, total: {} });
  function expand(id, n, avail, acc) {
    acc.total[id] = (acc.total[id] || 0) + n;
    const take = Math.min(avail[id] || 0, n);
    avail[id] = (avail[id] || 0) - take;
    n -= take;
    if (n <= 0) return;
    const r = producer[id];
    if (!r) {
      acc.raw[id] = (acc.raw[id] || 0) + n;
      return;
    }
    const runs = Math.ceil(n / r.qty);
    acc.make[r.id] = (acc.make[r.id] || 0) + runs;
    for (const [i, per] of Object.entries(r.inputs)) expand(i, per * runs, avail, acc);
  }

  function analyse(state) {
    const goals = toolTargets.filter((id) => isUpgrade(state, data, id));
    const cost = (id) => {
      const acc = newAcc();
      expand(id, 1, {}, acc);
      return Object.values(acc.raw).reduce((a, b) => a + b, 0);
    };
    goals.sort((a, b) => cost(a) - cost(b));
    const avail = stockMap(state);
    const rawShort = new Map();
    const make = new Map();
    const total = {};
    for (const id of goals) {
      const acc = newAcc();
      expand(id, 1, avail, acc);
      for (const [i, n] of Object.entries(acc.raw)) rawShort.set(i, (rawShort.get(i) || 0) + n);
      for (const [r, n] of Object.entries(acc.make)) make.set(r, (make.get(r) || 0) + n);
      for (const [i, n] of Object.entries(acc.total)) total[i] = (total[i] || 0) + n;
    }
    // Gate skills still climbing need spare raw input to turn into XP.
    for (const [skillId, level] of Object.entries(gates)) {
      const item = gateInput[skillId];
      if (!item || skillLevel(state, skillId) >= level) continue;
      const short = (total[item] || 0) + GATE_STOCK - itemCount(state, item);
      if (short > 0) rawShort.set(item, Math.max(rawShort.get(item) || 0, short));
    }
    // Tool recipes first, then parts, each in the order the chain needs them.
    const makeList = [...make.entries()].sort((a, b) => {
      const ta = items[recipeDef(data, a[0]).output]?.tool ? 0 : 1;
      const tb = items[recipeDef(data, b[0]).output]?.tool ? 0 : 1;
      return ta - tb;
    });
    return { goals, rawShort: [...rawShort.entries()].map(([item, n]) => ({ item, n })), make: makeList, total };
  }

  // ---- harvest choices ----
  function levelTask(state, skill) {
    let best = null;
    for (const n of skillNodes[skill] || []) {
      if (!nodeCheck(state, data, n.zone, n.skill, n.node).ok) continue;
      if (!best || n.level > best.level) best = n;
    }
    return best && { zone: best.zone, skill: best.skill, node: best.node };
  }

  // The task that brings in `item`; if its node is still locked, level that skill instead.
  function taskForItem(state, item) {
    const cands = nodeIndex[item];
    if (!cands || !cands.length) return null;
    for (const c of cands) {
      if (nodeCheck(state, data, c.zone, c.skill, c.node).ok) return { zone: c.zone, skill: c.skill, node: c.node };
    }
    return levelTask(state, cands[0].skill);
  }

  function lowestSkillTask(state) {
    const order = harvestSkills.slice().sort((a, b) => skillLevel(state, a.id) - skillLevel(state, b.id));
    for (const s of order) {
      const t = levelTask(state, s.id);
      if (t) return t;
    }
    return null;
  }

  // The food node that tops up the item we have least of.
  function foodTask(state) {
    let best = null;
    for (const f of foodNodes) {
      if (!nodeCheck(state, data, f.zone, f.skill, f.node).ok) continue;
      const have = itemCount(state, f.item);
      if (!best || have < best.have || (have === best.have && f.value > best.value)) best = { ...f, have };
    }
    return best && { zone: best.zone, skill: best.skill, node: best.node };
  }

  const keyOf = (t) => t && `${t.zone}/${t.skill}/${t.node}`;

  function assign(game, state, workerId, task) {
    if (!task) return;
    const cur = state.workers[workerId]?.task;
    if (cur && keyOf(cur) === keyOf(task)) return;
    act(game, 'harvest/assign', { worker: workerId, ...task });
  }

  function planHarvest(game, plan) {
    const state = game.getState();
    const tasks = [];
    const seen = new Set();
    for (const d of plan.rawShort) {
      const t = taskForItem(state, d.item);
      if (t && !seen.has(keyOf(t))) {
        seen.add(keyOf(t));
        tasks.push(t);
      }
    }
    const foodLow = foodCount(state) < FOOD_TARGET;
    const food = foodLow ? foodTask(state) : null;
    const fallback = lowestSkillTask(state);

    const playerTask = tasks[0] || food || fallback;
    assign(game, state, 'player', playerTask);

    const active = state.pets.active.filter(Boolean);
    active.forEach((petId, j) => {
      const pet = state.pets.list[petId];
      const affinity = data.pets.archetypes.find((a) => a.id === pet.archetype)?.affinity || [];
      let pick;
      if (food) {
        pick = food; // pets are the natural foragers when the pantry runs low
      } else {
        let pool = tasks.filter((t) => keyOf(t) !== keyOf(playerTask)).slice(0, 3);
        if (!pool.length) pool = tasks.length ? [tasks[0]] : [fallback].filter(Boolean);
        pick = pool.find((t) => affinity.includes(t.skill)) || pool[j % Math.max(1, pool.length)];
      }
      assign(game, state, petId, pick);
    });
    return playerTask;
  }

  // ---- crafting ----
  function stationFree(state, stationId) {
    const s = stationList(state, data).find((x) => x.id === stationId);
    return s && s.queue.length < s.slots;
  }

  function planCrafts(game, plan, horizonMs) {
    const units = (state, r) => Math.max(1, Math.ceil(horizonMs / itemMs(state, data, r)));

    // 1. copper tools, then the parts toward them
    for (const [rid, runs] of plan.make) {
      const state = game.getState();
      const r = recipeDef(data, rid);
      if (!stationFree(state, r.station)) continue;
      const chk = recipeCheck(state, data, rid, 1);
      if (!chk.ok) continue;
      const qty = Math.min(runs, chk.max);
      act(game, 'crafting/start', { recipe: rid, qty, focus: makesQuality(data, r) ? 'good' : null });
    }

    // 2. meals when food is short, 3. XP crafts for skills that still have somewhere to go
    for (const st of data.recipes.stations) {
      const state = game.getState();
      if (!stationFree(state, st.id)) continue;
      if (st.skill === 'cooking' && foodCount(state) < FOOD_TARGET) {
        let best = null;
        for (const r of recipesFor(data, st.id)) {
          if (!recipeCheck(state, data, r.id, 1).ok) continue;
          const per = Object.values(r.inputs).reduce((a, b) => a + b, 0);
          const score = (items[r.output]?.food || 0) / per;
          if (!best || score > best.score) best = { r, score };
        }
        if (best) {
          const chk = recipeCheck(state, data, best.r.id, 1);
          const need = Math.max(5, FOOD_TARGET - foodCount(state));
          const qty = Math.min(need, chk.max, units(state, best.r));
          if (qty >= 1) {
            act(game, 'crafting/start', { recipe: best.r.id, qty, focus: makesQuality(data, best.r) ? 'good' : null });
            continue;
          }
        }
      }
      xpCraft(game, st, plan, units);
    }
  }

  function xpCraft(game, st, plan, units) {
    const state = game.getState();
    const lvl = skillLevel(state, st.skill);
    // "Lowest skill" ignores craft skills with no recipe at their current level (they can't be trained).
    const trainable = allSkills.filter((s) => s.type === 'harvest'
      || recipesFor(data, s.station).some((r) => (r.level || 1) <= skillLevel(state, s.id) && !items[r.output]?.tool));
    const lowest = Math.min(...trainable.map((s) => skillLevel(state, s.id)));
    if (!(lvl < gateLevel || lvl === lowest)) return;
    let best = null;
    for (const r of recipesFor(data, st.id)) {
      if (items[r.output]?.tool) continue; // spare tools are no use
      if (!recipeCheck(state, data, r.id, 1).ok) continue;
      let max = data.balance.crafting.maxBatch;
      for (const [i, per] of Object.entries(r.inputs)) {
        const spare = itemCount(state, i) - (plan.total[i] || 0) - (items[i]?.food ? FOOD_RESERVE : 0);
        max = Math.min(max, Math.floor(spare / per));
      }
      if (max < 1) continue;
      const xp = itemXp(data, r);
      if (!best || xp > best.xp) best = { r, xp, max };
    }
    if (!best) return;
    const qty = Math.min(best.max, units(state, best.r));
    act(game, 'crafting/start', { recipe: best.r.id, qty, focus: makesQuality(data, best.r) ? 'good' : null });
  }

  // ---- eating ----
  function eat(game, skill) {
    const state = game.getState();
    if (!skill || buffSpeed(state, skill) > 0) return;
    let best = null;
    for (const key of Object.keys(state.bag)) {
      const b = buffOf(data, key);
      if (!b || !b.skills.includes(skill) || !state.bag[key]) continue;
      if (!best || b.speed > best.speed) best = { key, speed: b.speed };
    }
    if (best) act(game, 'buffs/use', { item: best.key });
  }

  // ---- one check-in's decisions ----
  // info: { now (ms), horizonMs (game time until the next check-in, after the offline cap) }
  function run(game, info) {
    let state = game.getState();
    if (needsStarter(state)) act(game, 'pets/hatchStarter', STARTER);
    state = game.getState();
    const day = localDay(info.now);
    for (const p of petList(state)) if (canPatToday(state, p.id, day)) act(game, 'pets/pat', { pet: p.id });

    planCrafts(game, analyse(game.getState()), info.horizonMs);
    const playerTask = planHarvest(game, analyse(game.getState()));
    eat(game, playerTask?.skill || game.getState().workers.player.task?.skill);
  }

  return {
    run,
    refusals,
    get dispatches() { return dispatches; },
    info: { gateLevel, gates },
  };
}
