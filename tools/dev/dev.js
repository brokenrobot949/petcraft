// Test mode commands (docs/handoff.md "Test mode"): grant items, set skill levels, add coins, jump to content.
// Dev only, not shipped (Phase 10): the Journal loads the panel only on the local preview server, and the
// panel and tools/tests add these commands with registerCommands() from js/core/game.js.
import { addItem, itemKey } from '../../js/systems/bag.js';
import { createPet, addPetXp } from '../../js/systems/pets.js';
import { archetypeOf, petMaxEnergy, petLevelCap, branchDef } from '../../js/systems/petstats.js';
import { addRenownXp } from '../../js/systems/renown.js';
import { newDay } from '../../js/systems/village.js';
import { randomInt } from '../../js/core/rng.js';
import { rollQuality } from '../../js/systems/taming.js';
import { digMs } from '../../js/systems/treasure.js';
import { currentStage, forceStage } from '../../js/systems/sanctuary.js';
import { recordPet } from '../../js/systems/bestiary.js';
import { xpToNext } from '../../js/systems/skills.js';

export const id = 'dev';

export const commands = {
  // quality (optional): 'fine' | 'masterwork', for items that roll quality.
  'dev/grant': (state, { item, qty, quality = 'normal' }, ctx) => {
    const def = ctx.data.items.items[item];
    if (!def) throw new Error(`No such item: ${item}`);
    const n = Math.floor(qty);
    if (!(n > 0)) throw new Error('Pick an amount above 0');
    addItem(state, itemKey(item, def.quality ? quality : 'normal'), n);
  },
  'dev/setLevel': (state, { skill, level }, ctx) => {
    if (!state.skills[skill]) throw new Error(`No such skill: ${skill}`);
    const max = ctx.data.balance.skills.maxLevel;
    state.skills[skill] = { level: Math.min(max, Math.max(1, Math.floor(level) || 1)), xp: 0 };
  },
  'dev/addCoins': (state, { amount }) => {
    state.coins = Math.max(0, state.coins + Math.floor(amount || 0));
  },
  // Buildings: any tier 0..max, ignoring costs and the Cottage cap (to look at every tier).
  'dev/setBuilding': (state, { building, tier }, ctx) => {
    if (!state.buildings[building]) throw new Error(`No such building: ${building}`);
    const max = ctx.data.balance.buildings.maxTier;
    state.buildings[building].tier = Math.min(max, Math.max(0, Math.floor(tier) || 0));
  },
  'dev/setRenown': (state, { rank }, ctx) => {
    state.renown.rank = Math.min(ctx.data.balance.renown.maxRank, Math.max(1, Math.floor(rank) || 1));
    state.renown.xp = 0;
  },
  'dev/addRenownXp': (state, { amount }, ctx) => addRenownXp(state, ctx, Math.floor(amount) || 0, 'dev'),
  // A fresh Commission Board (and Great Commission and merchant) as if a new week began.
  'dev/newDay': (state, _p, ctx) => {
    state.village.day = null;
    state.village.week = null;
    newDay(state, ctx);
  },
  // Pets: a test pet of any archetype and quality (first free slot, else the Stable).
  'dev/addPet': (state, { archetype, quality = 'common', name }, ctx) => {
    if (!archetypeOf(ctx.data, archetype)) throw new Error(`No such archetype: ${archetype}`);
    if (!ctx.data.balance.pets.qualities[quality]) throw new Error(`No such quality: ${quality}`);
    createPet(state, ctx, { archetype, quality, name: name || `Test ${archetype}` });
  },
  'dev/petEnergy': (state, { pet, energy }, ctx) => {
    const p = devPet(state, pet);
    p.energy = Math.min(petMaxEnergy(ctx.data, p), Math.max(0, Number(energy) || 0));
    p.resting = false;
  },
  'dev/petLevel': (state, { pet, level }, ctx) => {
    const p = devPet(state, pet);
    p.level = Math.min(petLevelCap(ctx.data, p), Math.max(1, Math.floor(level) || 1));
    p.xp = 0;
    addPetXp(state, ctx, p, 0); // a talent pick may be due at the new level
  },
  'dev/petBond': (state, { pet, bond }) => {
    devPet(state, pet).bond = Math.max(0, Math.floor(bond) || 0);
  },
  // Taming: a wild encounter in a zone right now (random archetype and quality unless given).
  // mythic: a mythic of that archetype instead (any zone, for testing).
  'dev/encounter': (state, { zone, archetype, quality, mythic = false }, ctx) => {
    const z = ctx.data.zones.zones.find((x) => x.id === zone);
    if (!z?.archetypes?.length) throw new Error(`No wild monsters in ${zone}`);
    if (state.taming.traps[zone]) throw new Error('A trap is set there; wait for it first');
    const t = state.taming;
    const a = archetype || z.archetypes[randomInt(t, 0, z.archetypes.length - 1)];
    const q = quality || rollQuality(t, ctx.data);
    if (!archetypeOf(ctx.data, a) || !ctx.data.balance.pets.qualities[q]) throw new Error('No such archetype or quality');
    t.encounters[zone] = { archetype: a, quality: q, msLeft: null, ...(mythic ? { mythic: true } : {}) };
  },
  // Every set trap, warming egg and the current dig finish on the next tick.
  'dev/finishTimers': (state, _p, ctx) => {
    for (const tr of Object.values(state.taming.traps)) tr.msLeft = Math.min(tr.msLeft, 1);
    for (const e of state.nest.slots) if (e && e.msLeft > 0) e.msLeft = Math.min(e.msLeft, 1);
    const task = state.workers.player.task;
    if (task?.skill === 'treasure') state.treasure.progress[task.zone] = Math.max(0, digMs(state, ctx.data) - 1);
  },
  // Evolution: fill both paths' calling progress so the branch choice opens.
  'dev/petCalling': (state, { pet }, ctx) => {
    const p = devPet(state, pet);
    const n = ctx.data.balance.pets.callingActions;
    for (const br of archetypeOf(ctx.data, p.archetype).branches) p.actions[br.calling] = Math.max(p.actions[br.calling] || 0, n);
  },
  // Make a pet ready for its next evolution: the level cap, calling progress, Bond heart 3 and its
  // catalyst in the bag.
  'dev/petReadyToEvolve': (state, { pet }, ctx) => {
    const { data } = ctx;
    const p = devPet(state, pet);
    const b = data.balance.pets;
    for (const br of archetypeOf(data, p.archetype).branches) p.actions[br.calling] = Math.max(p.actions[br.calling] || 0, b.callingActions);
    p.level = Math.max(p.level, petLevelCap(data, p));
    p.xp = 0;
    const need = b.bond.hearts[b.evolve.adultHearts - 1];
    if (p.form === 'juvenile' && p.bond < need) p.bond = need;
    const cat = branchDef(data, p.archetype, p.branch)?.catalyst;
    if (p.form === 'juvenile' && cat && !state.bag[cat]) addItem(state, cat, 1);
    addPetXp(state, ctx, p, 0);
  },
  // Every catalyst, one each.
  'dev/catalysts': (state, _p, ctx) => {
    for (const a of ctx.data.pets.archetypes) for (const br of a.branches) if (br.catalyst) addItem(state, br.catalyst, 1);
  },
  // ---- Phase 9: endgame ----
  // Put everything the current Grand Project stage still needs in the bag (and coins), so the
  // delivery screen can be tried. Opens the Sanctuary if Renown is too low.
  'dev/stageNeeds': (state, _p, ctx) => {
    openSanctuary(state, ctx);
    const st = currentStage(state, ctx.data);
    if (!st) throw new Error('Every Grand Project is finished.');
    for (const n of st.needs) {
      const short = Math.max(0, n.need - n.have - n.bag);
      if (n.item === 'coins') state.coins += short;
      else addItem(state, n.item, short);
    }
  },
  // Finish the current stage for free (Renown XP and rewards as usual).
  'dev/finishStage': (state, _p, ctx) => {
    openSanctuary(state, ctx);
    forceStage(state, ctx);
  },
  // Level 30 and Bond heart 5 (a young pet first becomes an adult of its first path).
  'dev/readyToRetire': (state, { pet }, ctx) => {
    const { data } = ctx;
    const p = devPet(state, pet);
    if (p.form === 'hatchling' || p.form === 'juvenile') {
      p.branch = p.branch || archetypeOf(data, p.archetype).branches[0].id;
      p.form = 'adult';
      recordPet(state, ctx, p);
    }
    p.level = data.balance.elders.retireLevel;
    p.xp = 0;
    const hearts = data.balance.pets.bond.hearts;
    p.bond = Math.max(p.bond, hearts[data.balance.elders.retireHearts - 1]);
    addPetXp(state, ctx, p, 0);
  },
  // Mastery: a skill at the max level with this many stars' worth of XP.
  'dev/masteryStars': (state, { skill, stars }, ctx) => {
    if (!state.skills[skill]) throw new Error(`No such skill: ${skill}`);
    const b = ctx.data.balance;
    const n = Math.min(b.skills.mastery.maxStars, Math.max(0, Math.floor(stars) || 0));
    let xp = 0;
    for (let k = 0; k < n; k++) xp += xpToNext(b.skills.maxLevel + k, b);
    state.skills[skill] = { level: b.skills.maxLevel, xp };
  },
  // A Starmetal trap and Mythic Bait, for trying a mythic catch.
  'dev/endgameKit': (state, _p, ctx) => {
    for (const item of ['starmetal_trap', 'mythic_bait']) if (ctx.data.items.items[item]) addItem(state, item, 1);
  },
  // Lets the daily pat be tried again today.
  'dev/clearPat': (state, { pet }) => {
    devPet(state, pet).lastPatDay = null;
  },
  // Lets the daily game and the nap Bond be tried again today.
  'dev/clearPlay': (state, { pet }) => {
    const p = devPet(state, pet);
    p.playDay = null;
    p.napDay = null;
  },
};

function openSanctuary(state, ctx) {
  const rank = ctx.data.balance.sanctuary.openRenown;
  if (state.renown.rank < rank) {
    state.renown.rank = rank;
    state.renown.xp = 0;
  }
}

function devPet(state, petId) {
  const p = state.pets.list[petId];
  if (!p) throw new Error(`No such pet: ${petId}`);
  return p;
}
