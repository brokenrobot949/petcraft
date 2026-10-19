// Pets tab: roster and pet pages. Placeholder until Phase 3.
import { el } from './dom.js';

export const id = 'pets';
export const label = 'Pets';
export const icon = 'assets/ui/tab-pets.png';

export function mount(container) {
  container.append(
    el('h1', {}, 'Pets'),
    el('div.panel', {},
      el('p', {}, 'Your pets will live here.'),
      el('ul.soon-list', {},
        el('li', {}, 'Choose an egg, hatch and name your first pet: Phase 3'),
        el('li', {}, 'Evolution, talents and the Bestiary: Phase 8'))));
}
