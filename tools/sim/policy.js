// Balance simulator policy v2: what a sensible player does during one check-in (about 3 minutes).
// It only sends commands through game.dispatch and only reads state through the game's own
// selectors. No DOM, no window: a Node runner can import this file as it is.
//
// Order at each check-in (docs/handoff.md "Balance simulator", for the systems that exist now):
//   0. village/newDay, hatch the starter, pat the pets;
//   1. sell surplus when coins are short, build or upgrade buildings (buying blueprints), deliver commissions,
//      reroll one that cannot be reached, tend the Garden, learn recipe scrolls;
//   2. wants: the cheapest building, the next tool tier for every kind, the cheapest open commission
//      (the recipe chain is followed backwards to the raw materials still short); queue crafts;
//   3. send the player and the pets harvesting; eat a buff meal;
//   4. work the queued station that matters most (tools, then food when pets are low, then buildings and
//      commissions, then XP).
import { itemCount, parseKey } from '../../js/systems/bag.js';
import { skillLevel } from '../../js/systems/skills.js';
import { nodeCheck, zoneUnlocked, toolFor } from '../../js/systems/harvest.js';
import { stationList, recipeCheck, recipeDef, recipesFor, itemMs, itemXp, makesQuality, stationTier, workSlots, isWorking } from '../../js/systems/crafting.js';
import { buffOf, buffSpeed } from '../../js/systems/buffs.js';
import { petList, canPatToday, needsStarter, canAutoFeed, evolveInfo, assistInfo } from '../../js/systems/pets.js';
import { canDig, talentDef } from '../../js/systems/petstats.js';
import { localDay } from '../../js/core/time.js';
import { buildingList, upgradeCheck } from '../../js/systems/buildings.js';
import { boardList, greatCommission, rerollInfo, shopList, scrollList, merchantList, sellPrice } from '../../js/systems/village.js';
import { plotList, seedList, seedDef } from '../../js/systems/garden.js';
import { freePetSpaces, trapOptions, baitOptions, lureList, lureInfo, encounterInfo } from '../../js/systems/taming.js';
import { mapList, digMs } from '../../js/systems/treasure.js';
import { eggList, nestList } from '../../js/systems/nest.js';

// Policy knobs (how the simulated player behaves; these are not game numbers).
const FOOD_TARGET = 40;     // keep about this many cooked meals (what auto-feed eats) in the bag: a night for 2 pets
const FOOD_RESERVE = 10;    // XP crafting never takes the last 10 of a food ingredient
const GATE_STOCK = 40;      // spare raw input kept on hand while a gate skill is still climbing
const RAW_RESERVE = 50;     // selling keeps this many of anything that still has a use
const POTION_RESERVE = 10;  // and this many buff potions
const SOON_LEVELS = 8;      // "can meet soon": a skill level within this many of the player's
const COIN_FLOOR = 300;     // sell surplus whenever coins are under this, even with nothing to buy
const SEEDS_PER_PLOT = 10;  // seeds bought per plot when the bag runs out
const NOT_BUILT = new Set();
const TRAP_STOCK = 2;       // traps kept in the bag (made at the stations)
const BAIT_STOCK = 2;       // matching bait kept per archetype of the target zone
const BUY_TRAP_MARGIN = 50; // buy a Pine Trap / bait in Mossbrook when coins cover it plus this much
const DIG_BUDGET_MS = 10 * 3600000; // digging happens at the last check-in of the day (overnight); maps beyond what 10 h can dig are sold
const DIG_FROM_HOUR = 0;            // dig at every check-in (maps no longer outpace digging)
const NO_USE_CATEGORIES = new Set(['map', 'egg', 'relic', 'trap', 'bait', 'lure']); // never sold as plain surplus
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
  const stationSkill = Object.fromEntries(data.recipes.stations.map((s) => [s.id, s.skill]));
  const craftSkills = new Set(Object.values(stationSkill));
  const toolItem = {}; // kind -> tier -> item id
  for (const [id, d] of Object.entries(items)) if (d.tool) (toolItem[d.tool] ||= {})[d.tier] = id;
  const maxToolTier = Math.max(...data.tools.tiers.filter((t) => !t.prestige).map((t) => t.tier));
  const zoneTier = Object.fromEntries(data.zones.zones.map((z) => [z.id, z.tier]));

  // Everything with some use for the policy: recipe inputs, building costs, commission requests.
  const used = new Set();
  for (const r of data.recipes.recipes) for (const i of Object.keys(r.inputs)) used.add(i);
  for (const b of data.buildings.buildings) for (const c of Object.values(b.costs || {})) for (const i of Object.keys(c.items || {})) used.add(i);
  for (const t of [...data.commissions.daily, ...data.commissions.great]) for (const e of t.items) used.add(e.item);

  // Craft-skill levels an item's whole recipe chain asks for.
  const reqCache = {};
  function reqOf(id) {
    if (reqCache[id]) return reqCache[id];
    const out = (reqCache[id] = {});
    const r = producer[id];
    if (!r) return out;
    const sk = stationSkill[r.station];
    out[sk] = Math.max(out[sk] || 0, r.level || 1);
    for (const [s, l] of Object.entries(r.needs || {})) if (craftSkills.has(s)) out[s] = Math.max(out[s] || 0, l);
    for (const i of Object.keys(r.inputs)) for (const [s, l] of Object.entries(reqOf(i))) out[s] = Math.max(out[s] || 0, l);
    return out;
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
  // Rare finds (zone.rare[skill]) come from any action of that skill in the zone: index them on its easiest node.
  for (const zone of data.zones.zones) {
    for (const [skill, finds] of Object.entries(zone.rare || {})) {
      const node = (zone.harvest?.[skill] || []).slice().sort((a, b) => (a.level || 1) - (b.level || 1))[0];
      if (!node) continue;
      for (const f of finds) (nodeIndex[f.item] ||= []).push({ zone: zone.id, skill, node: node.id, level: node.level || 1, rate: 0.001 });
    }
  }
  for (const list of Object.values(nodeIndex)) list.sort((a, b) => b.rate - a.rate);

  // ---- command wrapper: refusals are normal, count them by message ----
  function act(game, type, payload = {}) {
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

  function foodInBag(state) {
    let n = 0;
    for (const [k, c] of Object.entries(state.bag)) if (canAutoFeed(data, k)) n += c;
    return n;
  }
  function foodCount(state) {
    let n = foodInBag(state);
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

  // Raw materials a cost needs in all (planks count as 2 logs, and so on).
  function rawSize(list) {
    const acc = newAcc();
    for (const [id, n] of Object.entries(list)) expand(id, n, {}, acc);
    return Object.values(acc.raw).reduce((a, b) => a + b, 0);
  }

  // Could the player meet this item soon (open zone, tool and skill within SOON_LEVELS, recipes known)?
  function reachable(state, id, depth = 0) {
    if (depth > 8) return false;
    const r = producer[id];
    if (r) {
      if (stationTier(state, r.station) < 1) {
        const unlock = data.buildings.buildings.find((b) => b.id === r.station)?.unlock?.renown || 1;
        if (state.renown.rank < unlock) return false;
      }
      if (r.scroll && !state.crafting.known[r.id]) return false;
      if (skillLevel(state, stationSkill[r.station]) + SOON_LEVELS < (r.level || 1)) return false;
      for (const [s, l] of Object.entries(r.needs || {})) if (skillLevel(state, s) + SOON_LEVELS < l) return false;
      return Object.keys(r.inputs).every((i) => reachable(state, i, depth + 1));
    }
    return (nodeIndex[id] || []).some((c) => zoneUnlocked(state, data, c.zone)
      && (toolFor(state, data, c.skill)?.tier || 0) >= zoneTier[c.zone]
      && skillLevel(state, c.skill) + SOON_LEVELS >= c.level);
  }

  // ---- buildings ----
  // Upgrades and new plots held back only by materials, a blueprint or coins (not the Cottage cap or
  // Renown), cheapest first.
  function buildingOptions(state) {
    return buildingList(state, data)
      .filter((b) => !NOT_BUILT.has(b.id) && b.check.cost && !/^(Opens|Upgrade the Cottage)/.test(b.check.reason || ''))
      .map((b) => ({ id: b.id, check: b.check, cost: b.check.cost, size: rawSize(b.check.cost.items) }))
      .sort((a, b) => a.size - b.size);
  }
  function buildingGoal(state) {
    // Skip steps whose materials are out of reach for now (a locked zone, a far-off skill level).
    return buildingOptions(state).find((o) => o.check.missing.length > 0 && Object.keys(o.cost.items).every((i) => reachable(state, i))) || null;
  }
  // The cheapest way to get a blueprint right now: the merchant, then the market. Returns true if bought.
  function buyBlueprint(game, bp, extraCoins) {
    const state = game.getState();
    const m = merchantList(state, data).find((x) => x.item === bp && x.left > 0 && x.price + extraCoins <= state.coins);
    if (m) return act(game, 'market/buyMerchant', { index: m.index });
    const s = shopList(state, data).find((x) => x.item === bp && !x.locked && x.price + extraCoins <= state.coins);
    return s ? act(game, 'market/buy', { item: bp, qty: 1 }) : false;
  }
  function upgradeBuildings(game) {
    for (let pass = 0; pass < 10; pass++) {
      let did = false;
      for (const o of buildingOptions(game.getState())) {
        let chk = upgradeCheck(game.getState(), data, o.id);
        if (!chk.ok && chk.needsBlueprint && !chk.missing.length && buyBlueprint(game, chk.cost.blueprint, chk.cost.coins)) {
          chk = upgradeCheck(game.getState(), data, o.id);
        }
        if (chk.ok && act(game, 'buildings/upgrade', { building: o.id })) {
          did = true;
          break;
        }
      }
      if (!did) break;
    }
  }
  // Coins the next few building steps ask for (their coins plus a blueprint where one is missing).
  function coinGoal(state) {
    let goal = 0;
    for (const o of buildingOptions(state).slice(0, 3)) {
      goal += o.cost.coins;
      if (o.check.needsBlueprint) goal += shopList(state, data).find((s) => s.item === o.cost.blueprint)?.price || 0;
    }
    return Math.max(COIN_FLOOR, goal);
  }

  // ---- commissions ----
  function openCommissions(state) {
    const list = boardList(state, data).filter((c) => !c.done);
    const g = greatCommission(state, data);
    if (g && !g.done) list.push(g);
    return list;
  }
  const itemsOf = (c) => Object.fromEntries(c.items.map((i) => [i.item, i.need]));
  // The cheapest open commission the player can reach soon: its items become wants.
  function commissionGoal(state) {
    let best = null;
    for (const c of openCommissions(state)) {
      if (c.canDeliver) continue;
      const list = itemsOf(c);
      if (!Object.keys(list).every((i) => reachable(state, i))) continue;
      const size = rawSize(list);
      if (!best || size < best.size) best = { slot: c.slot, items: list, size };
    }
    return best;
  }
  function deliverCommissions(game) {
    for (const c of openCommissions(game.getState())) if (c.canDeliver) act(game, 'village/deliver', { slot: c.slot });
  }
  // The free reroll goes to a board commission whose items the player cannot reach soon.
  function rerollUnreachable(game) {
    const state = game.getState();
    if (rerollInfo(state, data).free < 1) return;
    const bad = boardList(state, data).find((c) => !c.done && !c.canDeliver && !Object.keys(itemsOf(c)).every((i) => reachable(state, i)));
    if (bad) act(game, 'village/reroll', { slot: bad.slot });
  }

  // ---- Garden ----
  function tendGarden(game) {
    let state = game.getState();
    const plots = plotList(state, data);
    if (!plots.length) return;
    const seedsLeft = () => seedList(game.getState(), data).reduce((n, s) => n + s.count, 0);
    if (seedsLeft() < plots.length * 2) {
      const cheapest = shopList(state, data).filter((s) => !s.locked && seedDef(data, s.item)).sort((a, b) => a.price - b.price)[0];
      if (cheapest) {
        const qty = Math.min(plots.length * SEEDS_PER_PLOT, Math.floor(state.coins / cheapest.price));
        if (qty >= 1) act(game, 'market/buy', { item: cheapest.item, qty });
      }
    }
    for (const p of plotList(game.getState(), data)) {
      state = game.getState();
      if (p.seed) {
        if (!p.auto) act(game, 'garden/auto', { plot: p.index, on: true });
        continue;
      }
      const seed = seedList(state, data).sort((a, b) => b.count - a.count)[0];
      if (seed) act(game, 'garden/plant', { plot: p.index, seed: seed.id });
    }
  }

  // ---- selling and scrolls ----
  // Sell what has no remaining use for the current wants (beyond a reserve) until coins reach `goal`.
  function sellSurplus(game, plan, goal) {
    const state = game.getState();
    if (state.coins >= goal) return;
    const byId = new Map();
    for (const [key, count] of Object.entries(state.bag)) {
      const { id } = parseKey(key);
      const def = items[id];
      if (!def || def.tool || def.seed || def.category === 'blueprint' || NO_USE_CATEGORIES.has(def.category) || canAutoFeed(data, key)) continue;
      const price = sellPrice(data, key);
      if (!price) continue;
      const g = byId.get(id) || { id, total: 0, keys: [] };
      g.total += count;
      g.keys.push({ key, count, price });
      byId.set(id, g);
    }
    const groups = [...byId.values()].map((g) => {
      const def = items[g.id];
      const reserve = def.buff ? POTION_RESERVE : Math.max(used.has(g.id) ? RAW_RESERVE : 0, plan.total[g.id] || 0);
      g.keys.sort((a, b) => b.price - a.price);
      return { ...g, surplus: g.total - reserve, top: g.keys[0].price };
    }).filter((g) => g.surplus > 0).sort((a, b) => b.top - a.top);
    let coins = state.coins;
    for (const g of groups) {
      let left = g.surplus;
      for (const k of g.keys) {
        if (coins >= goal || left <= 0) break;
        const qty = Math.min(k.count, left, Math.ceil((goal - coins) / k.price));
        if (qty >= 1 && act(game, 'market/sell', { item: k.key, qty })) {
          coins += qty * k.price;
          left -= qty;
        }
      }
      if (coins >= goal) break;
    }
  }
  // Scrolls once the building steps' coins are safe.
  function learnScrolls(game) {
    const state = game.getState();
    const goal = coinGoal(state);
    const keep = goal > COIN_FLOOR ? goal : 0;
    for (const s of scrollList(state, data).sort((a, b) => a.price - b.price)) {
      if (s.known || s.locked || game.getState().coins < s.price + keep) continue;
      act(game, 'market/learn', { recipe: s.recipe });
    }
  }

  // ---- taming, treasure, Nest ----
  const trapByTier = {};   // trap tier -> item id
  const baitByDish = {};   // dish -> bait item id
  for (const [id, d] of Object.entries(items)) {
    if (d.trap) trapByTier[d.trap.tier] = id;
    if (d.bait) baitByDish[d.bait.dish] = id;
  }
  const archetypeDish = Object.fromEntries(data.pets.archetypes.map((a) => [a.id, a.dish]));
  const qualityIdx = Object.fromEntries(data.pets.qualities.map((q, i) => [q.id, i]));
  const wildZones = data.zones.zones.filter((z) => z.archetypes?.length).sort((a, b) => b.tier - a.tier);
  const openWild = (state) => wildZones.filter((z) => zoneUnlocked(state, data, z.id));
  let petNames = 0;
  let mapsSold = 0;
  let petsReleased = 0;

  // The best open zone for which the trap (made or bought) is within reach: tracking goes there.
  function tameZone(state) {
    return openWild(state).find((z) => trapByTier[z.tier] && (itemCount(state, trapByTier[z.tier]) > 0 || reachable(state, trapByTier[z.tier]))) || null;
  }
  // Items the stations should make for taming: a few traps and the matching baits for the target zone.
  function tameWants(state) {
    if (!canTame(state)) return [];
    const z = tameZone(state);
    if (!z) return [];
    const list = [[trapByTier[z.tier], TRAP_STOCK]];
    for (const a of z.archetypes) {
      const bait = baitByDish[archetypeDish[a]];
      if (bait && reachable(state, bait)) list.push([bait, BAIT_STOCK]);
    }
    return list;
  }
  const usableTrap = (state, zone) => trapOptions(state, data, zone.id).find((o) => o.ok) || null;

  // Pets with the best quality (then level) hold the active slots.
  function arrangePets(game) {
    const state = game.getState();
    const slots = state.pets.active.length;
    const ranked = petList(state).sort((a, b) => (qualityIdx[b.quality] - qualityIdx[a.quality]) || (b.level - a.level) || a.bornAt - b.bornAt);
    ranked.slice(0, slots).forEach((p, i) => {
      if (!game.getState().pets.active.includes(p.id)) {
        const free = game.getState().pets.active.indexOf(null);
        const worse = game.getState().pets.active.map((id, s) => ({ id, s })).filter((x) => x.id && !ranked.slice(0, slots).some((r) => r.id === x.id))[0];
        act(game, 'pets/setActive', { pet: p.id, slot: free >= 0 ? free : worse ? worse.s : i });
      }
    });
  }

  // Hatch what is ready, place eggs from the bag. With the Stable full a ready egg makes room by
  // releasing the lowest-ranked pet that is not holding an active slot.
  function tendNest(game) {
    for (const n of nestList(game.getState(), data)) {
      if (!n.ready) continue;
      if (freePetSpaces(game.getState(), data) <= 0) {
        const st = game.getState();
        const ranked = petList(st).sort((a, b) => (qualityIdx[b.quality] - qualityIdx[a.quality]) || (b.level - a.level) || a.bornAt - b.bornAt);
        const worst = ranked.filter((p) => !st.pets.active.includes(p.id)).pop();
        if (worst && act(game, 'pets/release', { pet: worst.id })) petsReleased++;
      }
      if (freePetSpaces(game.getState(), data) > 0) act(game, 'nest/hatch', { slot: n.slot, name: data.pets.suggestedNames[petNames++ % data.pets.suggestedNames.length] });
    }
    for (const e of eggList(game.getState(), data)) {
      for (let i = 0; i < e.count && nestList(game.getState(), data).some((n) => !n.egg); i++) if (!act(game, 'nest/place', { item: e.key })) break;
    }
  }

  // Taming and digging. Tracking starts a check-in's player task and the game returns the player to
  // the harvest task by itself once an encounter shows up, so it is issued at the END of the policy run
  // (after planHarvest). The second run of a check-in (after 3 minutes of play) sets the trap on whatever
  // was found, then sends the player to dig or tracks again.
  // The lowest-ranked pet not holding an active slot (the one released to make room), or null.
  function worstStabled(state) {
    const ranked = petList(state).sort((a, b) => (qualityIdx[b.quality] - qualityIdx[a.quality]) || (b.level - a.level) || a.bornAt - b.bornAt);
    return ranked.filter((p) => !state.pets.active.includes(p.id)).pop() || null;
  }
  // Room for a catch: a free space, or a stabled pet that could be released for a better one.
  const canTame = (state) => freePetSpaces(state, data) > 0 || (() => { const w = worstStabled(state); return !!w && qualityIdx[w.quality] < 3; })();
  function tame(game, info) {
    let state = game.getState();
    // 1. traps on every encounter worth a space; with the Stable full, release the worst stabled pet only
    //    when the encounter is likely better ("Something special", or a readable quality above that pet's)
    for (const z of openWild(state)) {
      state = game.getState();
      if (!state.taming.encounters[z.id] || state.taming.traps[z.id]) continue;
      if (!usableTrap(state, z) && !buyTrap(game, z)) continue;
      if (freePetSpaces(game.getState(), data) <= 0) {
        const enc = encounterInfo(game.getState(), data, z.id);
        const worst = worstStabled(game.getState());
        const better = worst && enc && (enc.quality ? qualityIdx[enc.quality] > qualityIdx[worst.quality] : enc.special);
        if (better && act(game, 'pets/release', { pet: worst.id })) petsReleased++;
        else { act(game, 'taming/letGo', { zone: z.id }); continue; }
      }
      state = game.getState();
      const trap = usableTrap(state, z);
      if (!trap) continue;
      let bait = baitOptions(state, data, z.id).find((b) => b.match);
      if (!bait) { buyBait(game, z); bait = baitOptions(game.getState(), data, z.id).find((b) => b.match); }
      act(game, 'taming/setTrap', { zone: z.id, trap: trap.key, bait: bait ? bait.key : null });
    }
    // 2. nothing to trap and room (or a pet to swap out): track in the target zone (lure first)
    state = game.getState();
    const target = canTame(state) ? tameZone(state) : null;
    if (target && !state.taming.encounters[target.id] && (usableTrap(state, target) || buyTrap(game, target))) {
      if (!lureInfo(game.getState(), data) && lureList(game.getState(), data).length) act(game, 'taming/useLure', { item: lureList(game.getState(), data)[0].key });
      act(game, 'taming/track', { zone: target.id });
      return;
    }
    // 3. maps: dig them (one after another; the player goes back to harvesting by itself)
    state = game.getState();
    const maps = mapList(state, data).filter((m) => zoneUnlocked(state, data, m.zone)).sort((a, b) => b.count - a.count)[0];
    if (maps && new Date(info.now).getHours() >= DIG_FROM_HOUR) act(game, 'treasure/dig', { zone: maps.zone });
  }
  // Buy a Pine Trap / bait in Mossbrook when no trap can be made yet and coins allow.
  function buyTrap(game, zone) {
    const state = game.getState();
    const id = trapByTier[zone.tier];
    const s = id && shopList(state, data).find((x) => x.item === id && !x.locked);
    if (!s || state.coins < s.price + BUY_TRAP_MARGIN) return false;
    return act(game, 'market/buy', { item: id, qty: 1 }) && !!usableTrap(game.getState(), zone);
  }
  function buyBait(game, zone) {
    const state = game.getState();
    const enc = state.taming.encounters[zone.id];
    const id = enc && baitByDish[archetypeDish[enc.archetype]];
    const s = id && shopList(state, data).find((x) => x.item === id && !x.locked);
    if (s && state.coins >= s.price + BUY_TRAP_MARGIN) act(game, 'market/buy', { item: id, qty: 1 });
  }
  // Keep only the maps one check-in's dig budget covers (best zones first); sell the rest.
  function sellExtraMaps(game) {
    let keep = Math.max(1, Math.floor(DIG_BUDGET_MS / digMs(game.getState(), data)));
    for (const m of mapList(game.getState(), data).reverse()) {
      const kept = Math.min(m.count, keep);
      keep -= kept;
      const extra = m.count - kept;
      if (extra > 0 && sellPrice(data, m.item) && act(game, 'market/sell', { item: m.item, qty: extra })) mapsSold += extra;
    }
  }

  // ---- evolution, talents, assistants, Scouts (Phase 8) ----
  const TALENT_ORDER = ['speed', 'extraItem', 'drain'];   // talent kinds the policy likes, best first
  const CATALYST_LEVEL_LEAD = 3;                          // juveniles this close to the adult cap get their catalyst made
  const branchOf = (arch, id) => arch?.branches?.find((b) => b.id === id);
  const archOf = (id) => data.pets.archetypes.find((a) => a.id === id);
  let evolveCounts = { juvenile: 0, adult: 0 };
  let talentPicked = 0;
  let assistsPosted = 0;
  let petDigsSent = 0;

  // A hatchling at its level cap picks a branch (its calling matching the job it does, else its affinity);
  // a juvenile that is ready becomes an adult. Done before the stations are planned.
  function evolvePets(game) {
    for (const p of petList(game.getState())) {
      const state = game.getState();
      const info = evolveInfo(state, data, p.id);
      if (!info.ready) continue;
      if (info.next === 'juvenile') {
        const open = info.branches.filter((b) => b.unlocked);
        const job = state.workers[p.id]?.task?.skill;
        const aff = archOf(p.archetype)?.affinity || [];
        const pick = open.find((b) => b.calling === job) || open.find((b) => aff.includes(b.calling)) || open[0];
        if (pick && act(game, 'pets/evolve', { pet: p.id, branch: pick.id })) evolveCounts.juvenile++;
      } else if (info.next === 'adult') {
        if (act(game, 'pets/evolve', { pet: p.id })) evolveCounts.adult++;
      }
    }
  }
  // Catalysts the juveniles close to adulthood will need (the stations make them like any want).
  function catalystWants(state) {
    const list = [];
    for (const p of petList(state)) {
      if (p.form !== 'juvenile') continue;
      const info = evolveInfo(state, data, p.id);
      const item = branchOf(archOf(p.archetype), p.branch)?.catalyst;
      if (!item || (state.bag[item] || 0) >= 1 || list.some((e) => e[0] === item)) continue;
      if (p.level >= info.levelNeed - CATALYST_LEVEL_LEAD && reachable(state, item)) list.push([item, 1]);
    }
    return list;
  }
  // An adult held back only by its catalyst: queue the Alchemy recipe when it can be made right now.
  function queueCatalysts(game) {
    for (const p of petList(game.getState())) {
      const state = game.getState();
      const info = evolveInfo(state, data, p.id);
      if (info.next !== 'adult' || info.ready || !info.catalyst || info.catalyst.have >= 1) continue;
      if (info.level < info.levelNeed || info.hearts < info.heartsNeed) continue;
      const rid = info.catalyst.item; // the recipe id equals the item id
      const r = recipeDef(data, rid);
      if (!r || !stationFree(state, r.station)) continue;
      if (state.crafting.stations[r.station].queue.some((b) => b.recipe === rid)) continue;
      if (recipeCheck(state, data, rid, 1).ok) act(game, 'crafting/start', { recipe: rid, qty: 1, focus: makesQuality(data, r) ? 'good' : null });
    }
  }
  // Talent picks: speed, then extra items, then less drain, then whatever is first.
  function pickTalents(game) {
    for (const p of petList(game.getState())) {
      if (!p.offer || !p.offer.length) continue;
      const rank = (id) => {
        const kinds = (talentDef(data, id)?.effects || []).map((e) => e.kind);
        const i = TALENT_ORDER.findIndex((k) => kinds.includes(k));
        return i < 0 ? TALENT_ORDER.length : i;
      };
      const best = p.offer.slice().sort((a, b) => rank(a) - rank(b))[0];
      if (act(game, 'pets/pickTalent', { pet: p.id, talent: best })) talentPicked++;
    }
  }
  // Stabled adults help at their station; a station with queued work gets its assistant first.
  function postAssistants(game) {
    const state = game.getState();
    const cands = [];
    for (const p of petList(state)) {
      const info = assistInfo(state, data, p.id);
      if (!info.can || info.posted || state.crafting.assists[info.station]) continue;
      cands.push({ pet: p.id, station: info.station, work: state.crafting.stations[info.station]?.queue.length || 0 });
    }
    cands.sort((a, b) => b.work - a.work);
    for (const c of cands) {
      if (game.getState().crafting.assists[c.station]) continue;
      if (act(game, 'pets/assist', { pet: c.pet, station: c.station })) assistsPosted++;
    }
  }
  // Hatchlings near their cap with no unlocked branch work a node of a calling skill (their affinity first).
  function steerCallings(game) {
    const state = game.getState();
    const cap = data.balance.pets.stageLevelCaps[0];
    for (const petId of state.pets.active.filter(Boolean)) {
      const p = state.pets.list[petId];
      if (p.form !== 'hatchling' || p.level < cap - 2) continue;
      const info = evolveInfo(state, data, petId);
      if (info.branches.some((b) => b.unlocked)) continue;
      const aff = archOf(p.archetype)?.affinity || [];
      const callings = info.branches.map((b) => b.calling);
      const cur = state.workers[petId]?.task?.skill;
      if (callings.includes(cur)) continue;
      const skill = callings.find((c) => aff.includes(c)) || callings[0];
      assign(game, state, petId, levelTask(state, skill));
    }
  }
  // Active Scouts dig the maps the player is not digging.
  function scoutDigs(game) {
    const state = game.getState();
    if (state.workers.player.task?.skill === 'treasure') return;
    for (const petId of state.pets.active.filter(Boolean)) {
      const st = game.getState();
      if (st.workers[petId]?.task?.skill === 'treasure' || !canDig(data, st.pets.list[petId]) || st.pets.list[petId].resting) continue;
      const maps = mapList(st, data).filter((m) => zoneUnlocked(st, data, m.zone)).sort((a, b) => b.count - a.count)[0];
      if (maps && act(game, 'treasure/dig', { zone: maps.zone, worker: petId })) petDigsSent++;
    }
  }

  // ---- wants ----
  function analyse(state) {
    const goals = [];
    for (const k of data.tools.kinds) {
      const cur = items[state.tools[k.id]?.item]?.tier || 0;
      const next = toolItem[k.id]?.[cur + 1];
      if (next && cur + 1 <= maxToolTier && reachable(state, next)) goals.push(next);
    }
    const cost = (id) => rawSize({ [id]: 1 });
    goals.sort((a, b) => cost(a) - cost(b));
    const building = buildingGoal(state);
    const commission = commissionGoal(state);
    const avail = stockMap(state);
    const rawShort = new Map();
    const make = new Map(); // recipe -> runs
    const cls = new Map();  // recipe -> 0 for tool chains, 2 for buildings and commissions
    const total = {};
    const toolSet = new Set();
    const otherSet = new Set();
    const gates = {};       // craft skill -> level the wants need
    const groups = [
      { c: 2, set: otherSet, list: building ? Object.entries(building.cost.items) : [] },
      { c: 0, set: toolSet, list: goals.map((id) => [id, 1]) },
      { c: 2, set: otherSet, list: commission ? Object.entries(commission.items) : [] },
      { c: 2, set: otherSet, list: tameWants(state) },
      { c: 2, set: otherSet, list: catalystWants(state) },
    ];
    for (const g of groups) {
      for (const [id, n] of g.list) {
        const acc = newAcc();
        expand(id, n, avail, acc);
        for (const [i, k] of Object.entries(acc.raw)) rawShort.set(i, (rawShort.get(i) || 0) + k);
        for (const [r, k] of Object.entries(acc.make)) {
          make.set(r, (make.get(r) || 0) + k);
          cls.set(r, Math.min(cls.has(r) ? cls.get(r) : 9, g.c));
        }
        for (const [i, k] of Object.entries(acc.total)) {
          total[i] = (total[i] || 0) + k;
          g.set.add(i);
        }
        for (const [s, l] of Object.entries(reqOf(id))) gates[s] = Math.max(gates[s] || 0, l);
      }
    }
    // Gate skills still climbing need spare raw input to turn into XP.
    for (const [skillId, level] of Object.entries(gates)) {
      if (skillLevel(state, skillId) >= level) continue;
      const item = gateInput(state, skillId);
      if (!item) continue;
      const short = (total[item] || 0) + GATE_STOCK - itemCount(state, item);
      if (short > 0) rawShort.set(item, Math.max(rawShort.get(item) || 0, short));
    }
    const makeList = [...make.entries()].sort((a, b) => cls.get(a[0]) - cls.get(b[0]));
    return { goals, building, commission, rawShort: [...rawShort.entries()].map(([item, n]) => ({ item, n })), make: makeList, total, gates, toolSet, otherSet };
  }

  // For a climbing craft skill: the raw item whose recipe (best one it can already make) turns into XP.
  function gateInput(state, skillId) {
    const station = data.recipes.stations.find((s) => s.skill === skillId);
    if (!station) return null;
    const lvl = skillLevel(state, skillId);
    let best = null;
    for (const r of recipesFor(data, station.id)) {
      if ((r.level || 1) > lvl || items[r.output]?.tool || r.scroll) continue;
      const ids = Object.keys(r.inputs);
      if (!ids.every((i) => !producer[i])) continue;
      if (!(nodeIndex[ids[0]] || []).some((c) => nodeCheck(state, data, c.zone, c.skill, c.node).ok)) continue;
      const xp = itemXp(data, r) / ids.length;
      if (!best || xp > best.xp) best = { item: ids[0], xp };
    }
    return best?.item || null;
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
      if (state.workers[petId]?.task?.skill === 'treasure') return; // a Scout mid-dig keeps digging

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

  // A full queue holding only filler (XP crafts) makes way for something the wants need: cancel one
  // such batch (its materials come back).
  function makeRoom(game, plan, stationId) {
    const st = game.getState().crafting.stations[stationId];
    for (let i = st.queue.length - 1; i >= 0; i--) {
      const out = recipeDef(data, st.queue[i].recipe)?.output;
      if (out && (items[out]?.tool || plan.toolSet.has(out) || plan.otherSet.has(out) || canAutoFeed(data, out))) continue;
      act(game, 'crafting/cancel', { station: stationId, index: i });
      return;
    }
  }

  function planCrafts(game, plan, horizonMs) {
    const units = (state, r) => Math.max(1, Math.ceil(horizonMs / itemMs(state, data, r)));

    // 1. tools, then the parts toward them (and toward buildings and commissions)
    for (const [rid, runs] of plan.make) {
      const state = game.getState();
      const r = recipeDef(data, rid);
      if (!stationFree(state, r.station)) makeRoom(game, plan, r.station);
      if (!stationFree(game.getState(), r.station)) continue;
      const chk = recipeCheck(game.getState(), data, rid, 1);
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
          if (!canAutoFeed(data, r.output)) continue;
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
    if (!(lvl < (plan.gates[st.skill] || 0) || lvl === lowest)) return;
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

  // The player works workSlots stations: tools first, then food when the pets' food is low, then
  // buildings and commissions, then XP. Ties keep the station already being worked.
  function chooseStations(game, plan) {
    const state = game.getState();
    const slots = workSlots(state, data);
    const foodLow = foodInBag(state) < FOOD_TARGET;
    const cands = [];
    for (const st of stationList(state, data)) {
      if (st.status === 'unbuilt' || st.assistant || !st.queue.length) continue;
      let cls = 9;
      for (const b of st.queue) {
        const out = recipeDef(data, b.recipe)?.output;
        if (!out) continue;
        let c = 3;
        if (items[out]?.tool || plan.toolSet.has(out)) c = 0;
        else if (foodLow && canAutoFeed(data, out)) c = 1;
        else if (plan.otherSet.has(out)) c = 2;
        cls = Math.min(cls, c);
      }
      cands.push({ id: st.id, cls, working: st.working ? 1 : 0 });
    }
    cands.sort((a, b) => a.cls - b.cls || b.working - a.working);
    const want = cands.slice(0, slots).map((c) => c.id);
    // Switching evicts the station worked longest, so go worst-first and repeat until all are in.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const id of want.slice().reverse()) {
        if (!isWorking(game.getState(), id)) {
          act(game, 'crafting/work', { station: id });
          changed = true;
        }
      }
      if (!changed) break;
    }
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
    act(game, 'village/newDay');
    let state = game.getState();
    if (needsStarter(state)) act(game, 'pets/hatchStarter', STARTER);
    state = game.getState();
    const day = localDay(info.now);
    for (const p of petList(state)) if (canPatToday(state, p.id, day)) act(game, 'pets/pat', { pet: p.id });

    sellSurplus(game, analyse(game.getState()), coinGoal(game.getState()));
    upgradeBuildings(game);
    deliverCommissions(game);
    rerollUnreachable(game);
    tendGarden(game);
    learnScrolls(game);

    evolvePets(game);
    pickTalents(game);
    const plan = analyse(game.getState());
    planCrafts(game, plan, info.horizonMs);
    queueCatalysts(game);
    tendNest(game);
    arrangePets(game);
    postAssistants(game);
    sellExtraMaps(game);
    const plan2 = analyse(game.getState());
    const playerTask = planHarvest(game, plan2);
    eat(game, playerTask?.skill || game.getState().workers.player.task?.skill);
    steerCallings(game);
    chooseStations(game, plan2);
    tame(game, info);
    scoutDigs(game);
  }

  return {
    run,
    refusals,
    get dispatches() { return dispatches; },
    get mapsSold() { return mapsSold; },
    get petsReleased() { return petsReleased; },
    get evolveCounts() { return evolveCounts; },
    get talentPicked() { return talentPicked; },
    get assistsPosted() { return assistsPosted; },
    get petDigsSent() { return petDigsSent; },
  };
}
