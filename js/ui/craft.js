// Craft tab: stations (Phase 4) and the bag.
import { el, sheet } from './dom.js';
import { itemIcon } from './icons.js';
import { bagList } from '../systems/bag.js';

export const id = 'craft';
export const label = 'Craft';
export const icon = 'assets/ui/tab-craft.png';

let container = null;
let app = null;
let bagBox = null;
let lastKey = null;

export function mount(c, a) {
  container = c;
  app = a;
  bagBox = el('div.bag');
  container.append(
    el('h1', {}, 'Craft'),
    el('div.panel', {}, el('p', {}, 'Stations arrive in Phase 4.')),
    el('h1.bag-title', {}, 'Bag'),
    bagBox);
  app.game.subscribe(() => !container.hidden && render());
}

export function show() {
  lastKey = null;
  if (bagBox) render();
}

function render() {
  const data = app.game.data;
  const list = bagList(app.game.getState(), data);
  const key = list.map((e) => `${e.id}:${e.count}`).join(',');
  if (key === lastKey) return;
  lastKey = key;
  if (!list.length) {
    bagBox.replaceChildren(el('div.panel', {}, el('p', {}, 'Your bag is empty. Head to the World tab and pick a task to start gathering.')));
    return;
  }
  const out = [];
  for (const cat of data.items.categories) {
    const items = list.filter((e) => e.category === cat.id);
    if (!items.length) continue;
    out.push(el('div.panel', {},
      el('h2', {}, cat.name),
      el('div.bag-grid', {}, items.map((e) => tile(e, cat.name)))));
  }
  bagBox.replaceChildren(...out);
}

function tile(e, catName) {
  return el('button.bag-tile', { type: 'button', onclick: () => detail(e, catName) },
    el('span.bag-icon', {}, itemIcon(e.id, 32, e.item.name), el('span.bag-count', {}, e.count.toLocaleString())),
    el('span.bag-name', {}, e.item.name));
}

function detail(e, catName) {
  const count = app.game.getState().bag[e.id] || 0;
  sheet(e.item.name,
    el('div.item-detail', {}, itemIcon(e.id, 64, e.item.name),
      el('div', {}, el('p.small.muted', {}, catName), el('p', {}, `You have ${count.toLocaleString()}`))),
    e.item.desc && el('p', {}, e.item.desc),
    e.item.sell > 0 && el('p.small.muted', {}, `Sells for ${e.item.sell} coins at the market (Phase 6)`));
}
