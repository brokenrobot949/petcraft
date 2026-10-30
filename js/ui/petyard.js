// The Pet Yard and day trips (Phase 13, docs/design.md "Pet life" 3 and 4). The yard panel sits on the Pets roster:
// toy spots by Stable tier, the toys in the bag with Place, a placed toy can be taken back. The trip panel sits on a
// pet's page: where and how long, the energy it costs, then a countdown while the pet is away, and what it brought
// back last time. The rules live in js/systems/pets.js and wishes.js; numbers in balance.petLife.yard / .trips.
import { el, toast } from './dom.js';
import { itemIcon } from './icons.js';
import { getPet } from '../systems/pets.js';
import { yardSpots, tripZones, tripCost, tripInfo, atHome } from '../systems/wishes.js';
import { itemLabel } from '../systems/bag.js';
import { petMaxEnergy } from '../systems/petstats.js';
import { getPref, setPref } from './device.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

function act(game, type, payload) {
  try {
    game.dispatch(type, payload);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

const archName = (data, id) => data.pets.archetypes.find((a) => a.id === id)?.name || id;
const zoneName = (data, id) => data.zones.zones.find((z) => z.id === id)?.name || id;

// What changes the yard panel's layout (for the screen's rebuild key).
export function yardKey(state, data) {
  const toys = Object.keys(state.bag).filter((k) => state.bag[k] > 0 && data.items.items[k]?.category === 'toy');
  return `${yardSpots(state, data)}|${(state.yard?.toys || []).join(',')}|${toys.join(',')}`;
}

export function yardPanel(game) {
  const st = game.getState();
  const d = game.data;
  const spots = yardSpots(st, d);
  const placed = st.yard?.toys || [];
  const bagToys = Object.keys(st.bag).filter((k) => st.bag[k] > 0 && d.items.items[k]?.category === 'toy' && !placed.includes(k)).sort();
  const liked = (id) => `${archName(d, d.items.items[id]?.likes)} pets love it`;
  const spotEls = [];
  for (let i = 0; i < spots; i++) {
    const toy = placed[i];
    spotEls.push(toy
      ? el('button.yard-spot', {
        type: 'button',
        'aria-label': `${itemLabel(d, toy)}: take it back to your bag`,
        onclick: () => { if (act(game, 'yard/take', { item: toy })) toast(`${itemLabel(d, toy)} is back in your bag.`); },
      }, itemIcon(toy, 32, itemLabel(d, toy)), el('span.small', {}, itemLabel(d, toy)), el('span.small.muted', {}, liked(toy)))
      : el('div.yard-spot.empty', {}, el('span.small.muted', {}, 'Empty spot')));
  }
  const free = spots - placed.length;
  return el('div.panel.yard-panel', {},
    el('h2', {}, `Pet Yard (${placed.length} of ${spots})`),
    el('div.yard-spots', {}, spotEls),
    bagToys.length
      ? el('div.yard-bag', {}, el('h3.pet-sub-h', {}, 'Toys in your bag'), ...bagToys.map((id) => el('div.pet-row', {},
        itemIcon(id, 32, itemLabel(d, id)),
        el('span.grow', {}, el('b', {}, itemLabel(d, id)), el('br'), el('span.small.muted', {}, liked(id))),
        el(`button.btn${free > 0 ? '' : '.soft-off'}`, {
          type: 'button',
          onclick: () => (free > 0 ? act(game, 'yard/place', { item: id }) : toast('The Pet Yard is full. Upgrade the Stable for another spot, or take a toy back.')),
        }, 'Place'))))
      : null,
    el('p.small.muted', {}, `Pets resting in the Stable get +1 Bond an hour while a toy they love is here. Make toys at the Workbench (and a Wind Chime at the Forge). The Stable gives one spot per tier. Toys never break.`));
}

// ---- day trips ----

function leftText(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// The trip panel on a pet's page. note(text): say something. live(fn): a per-frame updater (countdown).
export function tripPanel(game, petId, { note, live }) {
  const host = el('div.panel', { id: `trip-${petId}` });
  const paint = () => host.replaceChildren(...tripBody(game, petId, { note, live, paint }));
  paint();
  return host;
}

function tripBody(game, petId, { note, live, paint }) {
  const st = game.getState();
  const d = game.data;
  const pet = getPet(st, petId);
  const cfg = d.balance.petLife.trips;
  const words = d.trips.lines;
  const kids = [];
  if (pet.trip) {
    const t = el('p', {}, '');
    live((s) => {
      const p = getPet(s, petId);
      if (p?.trip) t.textContent = `Away in ${zoneName(d, p.trip.zone)}, back in ${leftText(p.trip.msLeft)}.`;
    });
    kids.push(t, el('p.small.muted', {}, `${pet.name} comes home by itself, even while the game is closed.`));
  } else if (!atHome(st, pet)) {
    kids.push(el('p.small.muted', {}, `Only pets resting in the Stable can go on day trips. Send ${pet.name} to the Stable first.`));
  } else {
    const zones = tripZones(st, d);
    if (!zones.length) {
      kids.push(el('p.small.muted', {}, 'No zone to visit yet.'));
    } else {
      const zone = zones.includes(getPref('trip.zone', zones[0])) ? getPref('trip.zone', zones[0]) : zones[0];
      const hours = cfg.hours.includes(getPref('trip.hours', cfg.hours[0])) ? getPref('trip.hours', cfg.hours[0]) : cfg.hours[0];
      const rerender = paint; // the chips are per-device choices: repaint just this panel
      const chip = (label, on, onclick) => el('button.chip', { type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick }, label);
      const cost = tripCost(d, pet, hours);
      const info = tripInfo(st, d, petId, zone, hours);
      kids.push(
        el('h3.pet-sub-h', {}, 'Where'),
        el('div.chip-row', {}, zones.map((z) => chip(zoneName(d, z), z === zone, () => { setPref('trip.zone', z); rerender(); }))),
        el('h3.pet-sub-h', {}, 'How long'),
        el('div.chip-row', {}, cfg.hours.map((h) => chip(`${h} h`, h === hours, () => { setPref('trip.hours', h); rerender(); }))),
        el('p.small', {}, `Uses ${Math.round(cost)} of ${Math.round(petMaxEnergy(d, pet))} energy (${pet.name} has ${Math.round(pet.energy)}).`),
        el(`button.btn.wide${info.can ? '' : '.soft-off'}`, {
          type: 'button',
          onclick: () => {
            if (!info.can) { toast(info.reason); return; }
            if (act(game, 'pets/trip', { pet: petId, zone, hours })) note(fmt(pick(words.leave), { name: pet.name, zone: zoneName(d, zone) }));
          },
        }, `Send to ${zoneName(d, zone)}`),
        el('p.small.muted', {}, `${pet.name} brings back a small bag from the zone, a little XP, sometimes a map, and a postcard for the scrapbook. They keep their Stable space.`));
    }
  }
  const last = pet.lastTrip;
  if (last && !pet.trip) {
    const got = Object.entries(last.items || {}).map(([id, n]) => `${n} ${itemLabel(d, id)}`);
    const card = d.trips.postcards?.[last.zone]?.[last.line];
    kids.push(el('div.trip-last', {},
      el('h3.pet-sub-h', {}, `Last trip: ${zoneName(d, last.zone)}`),
      card ? el('p.pet-wish-line', {}, `"${card}"`) : null,
      el('p.small', {}, got.length ? `Brought back ${got.join(', ')}` : 'Came back empty-pawed, but happy.')));
  }
  return [el('h2', {}, 'Day trip'), ...kids];
}
