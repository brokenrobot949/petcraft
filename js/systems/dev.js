// Test mode commands (docs/handoff.md "Test mode"): grant items, set skill levels, add coins.
// Opened from a hidden panel in Journal -> Settings. Removed from the shipped build in Phase 10.
import { addItem, itemKey } from './bag.js';
import { createPet } from './pets.js';
import { archetypeOf, petMaxEnergy, petLevelCap } from './petstats.js';

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
  'dev/setRenown': (state, { rank }) => {
    state.renown.rank = Math.max(1, Math.floor(rank) || 1);
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
  },
  'dev/petBond': (state, { pet, bond }) => {
    devPet(state, pet).bond = Math.max(0, Math.floor(bond) || 0);
  },
  // Lets the daily pat be tried again today.
  'dev/clearPat': (state, { pet }) => {
    devPet(state, pet).lastPatDay = null;
  },
};

function devPet(state, petId) {
  const p = state.pets.list[petId];
  if (!p) throw new Error(`No such pet: ${petId}`);
  return p;
}
