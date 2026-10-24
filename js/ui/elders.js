// The Elder Grove (Phase 9): retired pets, the bonus they give, and their heir eggs.
import { el, toast } from './dom.js';
import { faceIcon } from './icons.js';
import { openSheet } from './layer.js';
import { groveOpen, elderList, heirEggList, legacyLines } from '../systems/elders.js';
import { talentDef } from '../systems/petstats.js';

const CLOSED_TEXT = 'The Elder Grove opens when one of your pets reaches level 30.';

function qualityName(data, id) {
  return data.pets.qualities.find((q) => q.id === id)?.name || id;
}

function placeHeir(game, egg) {
  try {
    game.dispatch('nest/placeHeir', { egg });
    toast('The heir egg is warming in the Nest.');
  } catch (err) {
    toast(err.message);
  }
}

function elderCard(data, e, compact) {
  const talents = [...(e.talents || []), ...(e.gifts || [])].map((t) => talentDef(data, t)?.name || t);
  return el('div.eg-elder', {},
    el('div.eg-elder-top', {},
      faceIcon(e.role, compact ? 40 : 48, e.name),
      el('div.eg-elder-text', {},
        el('b', {}, e.name),
        el('span.small.muted', {}, `${e.species}, ${qualityName(data, e.quality)}`),
        el('span.small.muted', {}, `Served ${e.days} day${e.days === 1 ? '' : 's'}, ${e.actions.toLocaleString()} actions`))),
    e.bonus && el('p.small.eg-bonus', {}, e.bonus),
    !compact && talents.length ? el('p.small.muted', {}, `Talents: ${talents.join(', ')}`) : null,
    !compact && e.heirloom ? el('p.small.muted', {}, `Heirloom: ${talentDef(data, e.heirloom)?.name || e.heirloom}`) : null);
}

function eggRow(game, h, data) {
  return el('div.eg-egg', {},
    el('div.eg-egg-text', {},
      el('b', {}, `Heir egg of ${h.elder || 'an elder'}`),
      el('span.small.muted', {}, `${qualityName(data, h.quality)} quality, ${data.pets.archetypes.find((a) => a.id === h.archetype)?.name || h.archetype}${h.heirloom ? `, heirloom: ${talentDef(data, h.heirloom)?.name || h.heirloom}` : ''}`)),
    el('button.btn', { type: 'button', onclick: () => placeHeir(game, h.index) }, 'Place in the Nest'));
}

export function openElderGrove(app) {
  const { game } = app;
  const key = () => {
    const s = game.getState();
    return `${groveOpen(s) ? 1 : 0}|${s.elders.list.map((e) => e.id).join(',')}|${s.elders.eggs.length}`;
  };
  openSheet(game, 'The Elder Grove', (body) => {
    const s = game.getState();
    const d = game.data;
    if (!groveOpen(s)) {
      body.append(el('p', {}, CLOSED_TEXT),
        el('p.small.muted', {}, 'Pets that are fully grown can retire there when they are ready. Their bonus helps every pet, and they leave an heir egg behind.'));
      return;
    }
    const lines = legacyLines(s, d);
    body.append(
      el('p', {}, 'A quiet corner of your homestead where retired pets rest. Each one still helps every pet you have.'),
      el('h3', {}, 'Bonus for all pets'),
      lines.length ? el('ul', {}, lines.map((l) => el('li', {}, l))) : el('p.small.muted', {}, 'No bonus yet. Retire a pet to start one.'));
    const eggs = heirEggList(s);
    if (eggs.length) {
      body.append(el('h3', {}, 'Heir eggs waiting'), ...eggs.map((h) => eggRow(game, h, d)));
    }
    const elders = elderList(s, d);
    body.append(el('h3', {}, `Elders (${elders.length})`));
    if (!elders.length) body.append(el('p.small.muted', {}, 'No elders yet. Open an adult pet on the Pets tab to retire it.'));
    for (const e of elders) body.append(elderCard(d, e, false));
  }, key);
}

// The compact Journal panel: { node, update(state) }.
export function createElderPanel(app) {
  const { game } = app;
  const host = el('div.panel.elder-panel');
  let k = null;
  function update(state) {
    const open = groveOpen(state);
    const key = `${open ? 1 : 0}|${state.elders.list.map((e) => e.id).join(',')}|${state.elders.eggs.length}`;
    if (key === k) return;
    k = key;
    const d = game.data;
    if (!open) {
      host.replaceChildren(el('h2', {}, 'Elder Grove'), el('p.small.muted', {}, CLOSED_TEXT));
      return;
    }
    const elders = elderList(state, d);
    const eggs = heirEggList(state);
    const lines = legacyLines(state, d);
    host.replaceChildren(
      el('h2', {}, `Elder Grove (${elders.length})`),
      lines.length ? el('ul.jr-list.small', {}, lines.map((l) => el('li', {}, l))) : el('p.small.muted', {}, 'No elders yet.'),
      ...elders.map((e) => elderCard(d, e, true)),
      eggs.length ? el('p.small', {}, `Heir eggs waiting: ${eggs.length}`) : null,
      el('button.btn.wide', { type: 'button', onclick: () => openElderGrove(app) }, 'Open the Elder Grove'));
  }
  return { node: host, update };
}
