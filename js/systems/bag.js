// The bag: every item the player owns, as item id -> count. No storage caps.
export const id = 'bag';

export function itemCount(state, itemId) {
  return state.bag[itemId] || 0;
}

export function addItem(state, itemId, qty) {
  if (!(qty > 0)) return;
  state.bag[itemId] = (state.bag[itemId] || 0) + qty;
}

// Returns false (and changes nothing) when there aren't enough.
export function removeItem(state, itemId, qty) {
  const have = state.bag[itemId] || 0;
  if (qty > have) return false;
  if (qty === have) delete state.bag[itemId];
  else state.bag[itemId] = have - qty;
  return true;
}

// Bag contents for display: [{ id, count, item, category }], sorted by category order, then name.
export function bagList(state, data) {
  const order = new Map(data.items.categories.map((c, i) => [c.id, i]));
  return Object.entries(state.bag)
    .filter(([id, count]) => count > 0 && data.items.items[id])
    .map(([id, count]) => {
      const item = data.items.items[id];
      return { id, count, item, category: item.category };
    })
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.item.name.localeCompare(b.item.name));
}
