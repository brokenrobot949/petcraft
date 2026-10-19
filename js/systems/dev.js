// Test mode commands (docs/handoff.md "Test mode"): grant items, set skill levels, add coins.
// Opened from a hidden panel in Journal -> Settings. Removed from the shipped build in Phase 10.
import { addItem } from './bag.js';

export const id = 'dev';

export const commands = {
  'dev/grant': (state, { item, qty }, ctx) => {
    if (!ctx.data.items.items[item]) throw new Error(`No such item: ${item}`);
    const n = Math.floor(qty);
    if (!(n > 0)) throw new Error('Pick an amount above 0');
    addItem(state, item, n);
  },
  'dev/setLevel': (state, { skill, level }, ctx) => {
    if (!state.skills[skill]) throw new Error(`No such skill: ${skill}`);
    const max = ctx.data.balance.skills.maxLevel;
    state.skills[skill] = { level: Math.min(max, Math.max(1, Math.floor(level) || 1)), xp: 0 };
  },
  'dev/addCoins': (state, { amount }) => {
    state.coins = Math.max(0, state.coins + Math.floor(amount || 0));
  },
};
