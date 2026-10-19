// World tab: zone map, zone scenes, worker assignment. Placeholder until Phase 2.
import { el } from './dom.js';

export const id = 'world';
export const label = 'World';
export const icon = 'assets/ui/tab-world.png';

export function mount(container) {
  container.append(
    el('h1', {}, 'World'),
    el('div.panel', {},
      el('p', {}, 'The map of the six zones will live here.'),
      el('ul.soon-list', {},
        el('li', {}, 'Meadowfold and harvesting: Phase 2'),
        el('li', {}, 'Mossbrook and zones 2 to 5: Phase 6'),
        el('li', {}, 'Tracking, traps and treasure: Phase 7'))));
}
