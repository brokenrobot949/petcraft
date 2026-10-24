// The Bestiary panel (Journal tab): every pet form with five quality stars.
import { el, sheet } from './dom.js';
import { faceIcon } from './icons.js';
import { bestiaryList, bestiaryStars } from '../systems/bestiary.js';

const FORM_NAMES = { hatchling: 'Hatchling', juvenile: 'Juvenile', adult: 'Adult', mythic: 'Mythic' };

// Returns { node, update(state) }. update() rebuilds the grid only when the star count changes.
export function createBestiary(game) {
  const data = game.data;
  const quals = data.pets.qualities;
  const host = el('div.panel.bestiary');
  let key = null;

  function portrait(entry, px) {
    // faceIcon falls back to a letter tile when the sprite role has no frame; show "?" then.
    const icon = faceIcon(entry.role, px, '?');
    if (!entry.seen) icon.classList.add('be-silhouette');
    return icon;
  }

  function starRow(entry) {
    return el('div.be-stars', { 'aria-label': `${entry.count} of ${quals.length} stars` },
      quals.map((q) => el('span.be-star' + (entry.stars[q.id] ? '.on' : ''), { 'aria-hidden': 'true' }, entry.stars[q.id] ? '★' : '☆')));
  }

  function openEntry(entry) {
    const had = quals.filter((q) => entry.stars[q.id]).map((q) => q.name);
    const archName = data.pets.archetypes.find((a) => a.id === entry.archetype)?.name || entry.archetype;
    sheet(entry.seen ? entry.species : '???',
      el('div.be-detail', {}, portrait(entry, 64)),
      el('p.small.muted', {}, `${FORM_NAMES[entry.form] || entry.form}, ${archName} family`),
      starRow(entry),
      el('p.small', {}, entry.seen ? (entry.desc || 'No notes yet.') : entry.form === 'mythic' ? 'Found only in the Heartgrove.' : 'You have not met this one yet.'),
      el('p.small.muted', {}, had.length ? `Qualities you have had: ${had.join(', ')}` : 'No qualities yet.'));
  }

  function tile(entry) {
    return el('button.be-tile' + (entry.seen ? '' : '.unseen'), { type: 'button', onclick: () => openEntry(entry) },
      portrait(entry, 40),
      el('span.be-name', {}, entry.seen ? entry.species : '???'),
      starRow(entry));
  }

  function update(state) {
    const stars = bestiaryStars(state, data);
    if (key === stars.have) return;
    key = stars.have;
    const list = bestiaryList(state, data);
    const parts = [
      el('h2', {}, 'Bestiary'),
      el('p.small', {}, `${stars.have} / ${stars.max} stars`),
      el('p.small.muted', {}, 'Tap a pet to read about it. Each quality you have had earns a star.'),
    ];
    for (const a of data.pets.archetypes) {
      const rows = list.filter((e) => e.archetype === a.id && e.form !== 'mythic');
      if (!rows.length) continue;
      parts.push(el('h3.jr-group', {}, a.name), el('div.be-grid', {}, rows.map(tile)));
    }
    const mythics = list.filter((e) => e.form === 'mythic');
    if (mythics.length) {
      parts.push(el('h3.jr-group', {}, 'Heartgrove mythics'),
        el('p.small.muted', {}, 'Found only in the Heartgrove.'),
        el('div.be-grid', {}, mythics.map(tile)));
    }
    host.replaceChildren(...parts);
  }

  update(game.getState());
  return { node: host, update };
}
