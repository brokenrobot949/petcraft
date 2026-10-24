// Player buffs from meals and potions (docs/design.md "Crafting": a 1-hour skill buff when the
// player eats a meal; potions are stronger). state.buffs[itemId] = { skills, speed, msLeft }.
// Eating the same food again restarts its timer at the new copy's strength. Buffs count down in
// game time, offline too. For one skill the strongest active buff applies (they don't add up).
import { removeItem, itemDef, parseKey } from './bag.js';
import { sanctuaryBonus } from './sanctuary.js';

export const id = 'buffs';

const EPS = 1e-6;

// The buff an item gives at its quality, or null: { skills, speed, ms }.
export function buffOf(data, key) {
  const def = itemDef(data, key);
  if (!def?.buff) return null;
  const mult = def.quality ? data.balance.crafting.mealQuality[parseKey(key).quality] ?? 1 : 1;
  return { skills: def.buff.skills, speed: def.buff.speed * mult, ms: def.buff.minutes * 60000 };
}

// Extra speed for a skill from active buffs (0 = none). Applies to the player's harvesting and
// to crafting in that skill.
export function buffSpeed(state, skillId) {
  let best = 0;
  for (const b of Object.values(state.buffs || {})) {
    if (b.msLeft > EPS && b.skills.includes(skillId) && b.speed > best) best = b.speed;
  }
  return best;
}

// Active buffs for display: [{ id, item, skills, speed, msLeft }], longest-lasting first.
export function activeBuffs(state, data) {
  return Object.entries(state.buffs || {})
    .filter(([, b]) => b.msLeft > EPS)
    .map(([itemId, b]) => ({ id: itemId, item: data.items.items[itemId] || null, ...b }))
    .sort((a, b) => b.msLeft - a.msLeft);
}

// Time until the next buff runs out, so the tick can stop exactly there (live play and offline
// catch-up then agree on when a speed bonus ended).
export function nextBoundaryMs(state) {
  let next = Infinity;
  for (const b of Object.values(state.buffs)) if (b.msLeft > EPS && b.msLeft < next) next = b.msLeft;
  return next;
}

export function advance(state, ms, ctx) {
  for (const [itemId, b] of Object.entries(state.buffs)) {
    b.msLeft -= ms;
    if (b.msLeft <= EPS) {
      delete state.buffs[itemId];
      ctx.emit?.({ type: 'buffEnded', item: itemId });
    }
  }
}

export const commands = {
  // The player eats a meal or drinks a potion from the bag.
  'buffs/use': (state, { item }, ctx) => {
    const buff = buffOf(ctx.data, item);
    if (!buff) throw new Error("That doesn't do anything for you.");
    const def = itemDef(ctx.data, item);
    if (def.category === 'meal') buff.speed *= 1 + sanctuaryBonus(state, ctx.data, 'mealStrength'); // the Feast Hall
    if (!removeItem(state, item, 1)) throw new Error(`You don't have any ${def.name}.`);
    const base = parseKey(item).id;
    state.buffs[base] = { skills: [...buff.skills], speed: buff.speed, msLeft: buff.ms };
    ctx.emit?.({ type: 'buffStarted', item, skills: buff.skills, speed: buff.speed, ms: buff.ms });
  },
};
