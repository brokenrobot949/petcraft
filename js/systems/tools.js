// Equipped tools (docs/design.md "Player tools"). state.tools[kind] = { item, quality } is the
// tool in use for each tool kind; spare tools sit in the bag under their item key
// (js/systems/bag.js). A newly crafted tool that beats the equipped one is equipped at once and
// the old one goes back to the bag.
import { addItem, removeItem, itemDef, itemKey, parseKey } from './bag.js';

export const id = 'tools';

// Higher numbers are better: tier first, then quality.
function toolRank(data, itemId, quality) {
  const tier = data.items.items[itemId]?.tier || 0;
  const q = Math.max(0, data.tools.qualities.findIndex((x) => x.id === quality));
  return tier * 10 + q;
}

// Is this bag key a tool better than the one equipped for its kind?
export function isUpgrade(state, data, key) {
  const def = itemDef(data, key);
  if (!def?.tool) return false;
  const eq = state.tools[def.tool];
  const { id: itemId, quality } = parseKey(key);
  if (!eq) return true;
  return toolRank(data, itemId, quality) > toolRank(data, eq.item, eq.quality);
}

// Equips the tool with this bag key (one copy leaves the bag; the old tool returns to it).
export function equip(state, ctx, key) {
  const { data } = ctx;
  const def = itemDef(data, key);
  if (!def?.tool) throw new Error("That isn't a tool.");
  if (!removeItem(state, key, 1)) throw new Error(`You don't have a ${def.name}.`);
  const old = state.tools[def.tool];
  if (old) addItem(state, itemKey(old.item, old.quality), 1);
  const { id: itemId, quality } = parseKey(key);
  state.tools[def.tool] = { item: itemId, quality };
  ctx.emit?.({ type: 'toolEquipped', kind: def.tool, item: key });
}

export const commands = {
  'tools/equip': (state, { item }, ctx) => equip(state, ctx, item),
};
