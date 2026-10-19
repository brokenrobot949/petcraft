// Craft tab: stations, queues, Focus tap and the bag. Placeholder until Phase 4.
import { el } from './dom.js';

export const id = 'craft';
export const label = 'Craft';
export const icon = 'assets/ui/tab-craft.png';

export function mount(container) {
  container.append(
    el('h1', {}, 'Craft'),
    el('div.panel', {},
      el('p', {}, 'Workbench, Forge, Kitchen and Alchemy Lab will live here, with your bag.'),
      el('ul.soon-list', {},
        el('li', {}, 'The bag: Phase 2'),
        el('li', {}, 'Stations, queues and the Focus tap: Phase 4'))));
}
