// The bag: every item the player owns, as item key -> count. No storage caps.
// A key is the item id, plus ":fine" or ":masterwork" for better copies of items that roll
// quality (tools, meals). Normal copies use the plain id.
export const id = 'bag';

export function itemKey(itemId, quality = 'normal') {
  return !quality || quality === 'normal' ? itemId : `${itemId}:${quality}`;
}

// { id, quality } from a bag key.
export function parseKey(key) {
  const i = key.indexOf(':');
  return i < 0 ? { id: key, quality: 'normal' } : { id: key.slice(0, i), quality: key.slice(i + 1) };
}

// The item's data entry for a bag key (quality suffix ignored), or null.
export function itemDef(data, key) {
  return data.items.items[parseKey(key).id] || null;
}

// "Copper Axe" or "Fine Copper Axe".
export function itemLabel(data, key) {
  const { id, quality } = parseKey(key);
  const name = data.items.items[id]?.name || id;
  if (quality === 'normal') return name;
  const q = data.tools.qualities.find((x) => x.id === quality);
  return `${q ? q.name : quality} ${name}`;
}

export function itemCount(state, key) {
  return state.bag[key] || 0;
}

export function addItem(state, key, qty) {
  if (!(qty > 0)) return;
  state.bag[key] = (state.bag[key] || 0) + qty;
  if (state.stats.found) {
    const i = key.indexOf(':'); // the item id without its quality (parseKey, without the allocation: this runs every action)
    state.stats.found[i < 0 ? key : key.slice(0, i)] = true; // collection achievements
  }
}

// Returns false (and changes nothing) when there aren't enough.
export function removeItem(state, key, qty) {
  const have = state.bag[key] || 0;
  if (qty > have) return false;
  if (qty === have) delete state.bag[key];
  else state.bag[key] = have - qty;
  return true;
}

// Bag contents for display: [{ id (the key), base, quality, count, item, category }], sorted by
// category order, then name, then quality.
export function bagList(state, data) {
  const order = new Map(data.items.categories.map((c, i) => [c.id, i]));
  const qOrder = new Map(data.tools.qualities.map((q, i) => [q.id, i]));
  return Object.entries(state.bag)
    .filter(([key, count]) => count > 0 && itemDef(data, key))
    .map(([key, count]) => {
      const { id: base, quality } = parseKey(key);
      const item = data.items.items[base];
      return { id: key, base, quality, count, item, category: item.category };
    })
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99)
      || a.item.name.localeCompare(b.item.name)
      || (qOrder.get(a.quality) ?? 0) - (qOrder.get(b.quality) ?? 0));
}
