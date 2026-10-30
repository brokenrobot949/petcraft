// Pets tab: first-egg choice and hatching, the roster (Active / Stable), the Pantry and pet pages.
// The UI only reads state and sends commands with game.dispatch. The screen is rebuilt only when a
// "structural key" changes (who/what is shown); bars and numbers are updated in place on every
// change so taps are never swallowed by a rebuild.
import { el, toast, sheetWithClose } from './dom.js';
import { buildingTier, petCapacity } from '../systems/buildings.js';
import { freePetSpaces } from '../systems/taming.js';
import { nestList, eggList } from '../systems/nest.js';
import { itemLabel } from '../systems/bag.js';
import { itemIcon, faceIcon } from './icons.js';
import { localDay } from '../core/time.js';
import {
  petList, getPet, needsStarter, canPatToday, petStatus, pantryList, foodList, workHoursLeft,
  evolveInfo, talentInfo, assistInfo, canPlayToday, napInfo,
} from '../systems/pets.js';
import {
  archetypeOf, petProgress, petHearts, petMaxEnergy, petDrainPerHour, petRestPerHour, petSpeed, petRole,
  petSpecies, branchDef, talentDef, effectText, petEffects,
} from '../systems/petstats.js';
import { stationDef } from '../systems/crafting.js';
import { retireInfo, heirEggList } from '../systems/elders.js';
import { randomName, randomNameButton, renameSheet } from './petname.js';
import { playButtons, playHelp, moodText, startPlay } from './petplay.js';
import { wishCard, tricksPanel } from './petwish.js';
import { yardPanel, yardKey, tripPanel } from './petyard.js';
import { scrapbookPanel } from './scrapbook.js';

export const id = 'pets';
export const label = 'Pets';
export const icon = 'assets/ui/tab-pets.png';

let container = null;
let app = null;
let root = null;
let lastKey = null;
let updaters = []; // functions (state) that refresh numbers/bars in place
let refs = {};

// Screen state (not saved): which egg is picked, hatch flow, which pet page is open.
const ui = { sel: null, hatch: null, page: null, note: '' };

const HATCH_MS = 1500; // length of the wobble-and-crack animation (matches css/pets.css)

// ---- small helpers ----

const gdata = () => app.game.data;
const gstate = () => app.game.getState();
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const live = (fn) => updaters.push(fn);

function act(type, payload) {
  try {
    app.game.dispatch(type, payload);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function skillName(skillId) {
  return gdata().skills.skills.find((s) => s.id === skillId)?.name || skillId;
}

function zoneName(zoneId) {
  return gdata().zones.zones.find((z) => z.id === zoneId)?.name || zoneId;
}

function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function fmtHours(h) {
  const totalMin = Math.max(0, Math.round(h * 60));
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return hh ? `${hh} h ${mm} min` : `${mm} min`;
}

const round1 = (n) => Math.round(n * 10) / 10;

// ---- pixel pictures drawn in code ----

const SVG_NS = 'http://www.w3.org/2000/svg';

function pixelSvg(rows, cls, label) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', cls);
  if (label) svg.setAttribute('aria-label', label);
  else svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c !== '#') return;
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', 1);
      r.setAttribute('height', 1);
      svg.append(r);
    });
  });
  return svg;
}

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const STAR = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];

function gems(shape, cls, filled, max, text) {
  const wrap = el('span.pet-gems', { role: 'img', 'aria-label': text });
  for (let i = 0; i < max; i++) wrap.append(pixelSvg(shape, `pet-gem ${cls} ${i < filled ? 'on' : 'off'}`));
  return wrap;
}

function stars(pet) {
  const q = gdata().pets.qualities.find((x) => x.id === pet.quality);
  const n = q?.stars || 1;
  const max = Math.max(5, ...gdata().pets.qualities.map((x) => x.stars));
  return gems(STAR, 'pet-star', n, max, `Quality: ${q?.name || pet.quality}, ${n} of ${max} stars`);
}

function hearts(pet) {
  const h = petHearts(gdata(), pet);
  return gems(HEART, 'pet-heart', h.hearts, h.max, `Bond: ${h.hearts} of ${h.max} hearts`);
}

// An egg on a 16x16 grid, coloured from the archetype's egg.colors [base, dark, light].
const EGG_ROWS = [[7, 8], [6, 9], [5, 10], [5, 10], [4, 11], [4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [4, 11], [4, 11], [5, 10], [6, 9]];
const EGG_HIGHLIGHT = [[7, 3], [6, 4], [6, 5]];
const EGG_SPOTS = [[9, 6], [5, 9], [6, 9], [9, 10], [8, 11]];
const EGG_CRACK = [[8, 5], [7, 6], [8, 7], [7, 8], [8, 9], [9, 8]];

function eggPicture(arch, cls) {
  const [base, dark, light] = arch.egg.colors;
  const inShape = (x, y) => {
    const r = EGG_ROWS[y - 1];
    return !!r && x >= r[0] && x <= r[1];
  };
  const rect = (x, y, fill) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
  const has = (list, x, y) => list.some((c) => c[0] === x && c[1] === y);
  let cells = '';
  EGG_ROWS.forEach((r, i) => {
    const y = i + 1;
    for (let x = r[0]; x <= r[1]; x++) {
      const edge = !inShape(x - 1, y) || !inShape(x + 1, y) || !inShape(x, y - 1) || !inShape(x, y + 1);
      let fill = base;
      if (edge || has(EGG_SPOTS, x, y)) fill = dark;
      else if (has(EGG_HIGHLIGHT, x, y)) fill = light;
      cells += rect(x, y, fill);
    }
  });
  const crack = EGG_CRACK.map(([x, y]) => rect(x, y, dark)).join('');
  return el('span', {
    class: `egg-pic ${cls || ''}`,
    role: 'img',
    'aria-label': arch.egg.name,
    html: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${cells}<g class="egg-crack">${crack}</g></svg>`,
  });
}

// ---- statuses ----

function statusInfo(st, pet) {
  const status = petStatus(st, pet.id);
  if (status === 'working') {
    const t = st.workers[pet.id]?.task;
    return { text: t ? `${skillName(t.skill)} at ${zoneName(t.zone)}` : 'Working', rest: false };
  }
  if (status === 'trip') return { text: `On a day trip to ${zoneName(pet.trip.zone)}`, rest: false };
  if (pet.nap) return { text: 'Napping', rest: true };
  if (status === 'resting') return { text: 'Resting', rest: true };
  if (status === 'stabled') return { text: 'In the Stable, resting up', rest: true };
  return { text: 'Idle - give it a job on the World tab', rest: false };
}

function statusLine(petId) {
  const text = el('span.pet-status-text');
  const zzz = el('span.pet-zzz', { 'aria-hidden': 'true' }, 'zzz');
  zzz.hidden = true;
  live((st) => {
    const pet = getPet(st, petId);
    if (!pet) return;
    const s = statusInfo(st, pet);
    text.textContent = s.text;
    zzz.hidden = !s.rest;
  });
  return el('span.pet-status.small', {}, text, zzz);
}

function energyRow(petId) {
  const fill = el('div.fill', {});
  const bar = el('div.bar.pet-energy-bar', { 'aria-hidden': 'true' }, fill);
  const txt = el('span.pet-energy-text.small', {});
  live((st) => {
    const p = getPet(st, petId);
    if (!p) return;
    const max = petMaxEnergy(gdata(), p);
    fill.style.width = `${Math.max(0, Math.min(100, (p.energy / max) * 100))}%`;
    txt.textContent = `${Math.round(p.energy)} / ${Math.round(max)}`;
  });
  return el('div.pet-energy', {}, el('span.small.muted', {}, 'Energy'), bar, txt);
}

// ---- mount / show / hide ----

export function mount(c, a) {
  container = c;
  app = a;
  root = el('div.pets');
  container.append(root);
  app.game.subscribe(() => !container.hidden && render());
}

export function show() {
  lastKey = null;
  if (root) render();
}

export function hide() {
  // Nothing to stop: updates only run while the tab is visible.
}

// ---- rendering ----

// What changes the Evolution panel's layout: readiness, which paths are open, whether the catalyst is in the bag.
function evolveKey(st, p) {
  const info = evolveInfo(st, gdata(), p.id);
  return `${info.ready ? 1 : 0}${info.branches.map((b) => (b.unlocked ? 1 : 0)).join('')}${info.catalyst && info.catalyst.have > 0 ? 1 : 0}${info.hearts >= (info.heartsNeed ?? 99) ? 1 : 0}`;
}

// What changes the Retire panel's layout.
function retireKey(st, p) {
  if (p.form !== 'adult' && p.form !== 'mythic') return p.level >= 25 ? 'n' : '-';
  const info = retireInfo(st, gdata(), p.id);
  return `${info.can ? 1 : 0}${info.reason}`;
}

function petKey(st, p, day) {
  const d = gdata();
  const t = st.workers[p.id]?.task;
  return [
    p.id, p.name, p.level, p.form, petHearts(d, p).hearts, petStatus(st, p.id), t ? `${t.zone}/${t.skill}` : '',
    canPatToday(st, p.id, day) ? 1 : 0, canPlayToday(st, p.id, day) ? 1 : 0, p.nap ? 1 : 0, napInfo(st, d, p.id, day).can ? 1 : 0,
    p.mood?.kind || '-', (p.book || []).length, p.wish ? `${p.wish.kind}${p.wish.line}` : '-', p.teachDay ?? '-', JSON.stringify(p.tricks || {}), p.trip ? p.trip.zone : '-', p.lastTrip ? `${p.lastTrip.zone}${p.lastTrip.line}` : '-', p.autoFeed ? 1 : 0, petProgress(d, p).capped ? 1 : 0,
    p.branch || '-', (p.talents || []).length, (p.gifts || []).length, (p.offer || []).join('+'), p.favoriteKnown ? 1 : 0,
    evolveKey(st, p), p.heirloom || '-', retireKey(st, p), Object.keys(st.crafting.assists || {}).filter((s) => st.crafting.assists[s] === p.id).join('+'),
  ].join(':');
}

function structKey(st, day) {
  const d = gdata();
  if (needsStarter(st)) return ui.hatch ? `hatch:${ui.hatch.arch}:${ui.hatch.step}` : `egg:${ui.sel}`;
  if (ui.page && !getPet(st, ui.page)) ui.page = null;
  const pantry = foodList(st, d).map((e) => e.id + (e.on ? '+' : '-')).join(',');
  const pets = petList(st).map((p) => petKey(st, p, day)).join('|');
  const nest = nestList(st, d).map((n) => `${n.slot}:${n.archetype || '-'}:${n.ready ? 1 : 0}:${n.heir ? 'h' : ''}`).join(',')
    + `;${heirEggList(st).map((h) => `${h.archetype}${h.quality}`).join(',')}`;
  const eggs = eggList(st, d).map((e) => `${e.key}x${e.count}`).join(',');
  const room = `${petCapacity(st, d)}/${freePetSpaces(st, d)}/${Object.keys(st.taming.traps).length}/${buildingTier(st, 'nest')}`;
  const yard = yardKey(st, d);
  return `${ui.page ? `pet:${ui.page}` : 'roster'}#${yard}#${st.pets.active.join(',')}#${pantry}#${pets}#${nest}#${eggs}#${room}`;
}

function render() {
  const st = gstate();
  const day = localDay(Date.now());
  const key = structKey(st, day);
  if (key !== lastKey) {
    lastKey = key;
    updaters = [];
    refs = {};
    let nodes;
    if (needsStarter(st)) nodes = ui.hatch ? buildHatch() : buildEggChoice();
    else if (ui.page) nodes = buildPage(st, day, getPet(st, ui.page));
    else nodes = buildRoster(st, day);
    root.replaceChildren(...nodes);
  }
  for (const f of updaters) f(st);
}

// ---- egg choice and hatching ----

function buildEggChoice() {
  const d = gdata();
  const cards = d.pets.archetypes.map((a) => {
    const picked = ui.sel === a.id;
    return el('button.egg-card', {
      type: 'button',
      'aria-pressed': picked ? 'true' : 'false',
      class: `egg-card${picked ? ' selected' : ''}`,
      onclick: () => { ui.sel = a.id; render(); },
    },
    eggPicture(a, ''),
    el('b.egg-name', {}, a.egg.name),
    el('span.small.egg-desc', {}, a.egg.desc),
    el('span.small.egg-blurb', {}, a.blurb),
    el('span.small.egg-likes', {}, `Good at: ${listNames(a.affinity.map(skillName))}`));
  });
  const go = el('button.btn.wide', { type: 'button', disabled: !ui.sel, onclick: startHatch }, ui.sel ? 'Choose this egg' : 'Pick an egg first');
  return [
    el('h1', {}, 'Pets'),
    el('div.panel', {}, el('p', {}, 'In the ruins of the Old Sanctuary you find four eggs. Choose one.')),
    el('div.egg-grid', {}, cards),
    go,
  ];
}

function startHatch() {
  if (!ui.sel) return;
  const h = { arch: ui.sel, step: reducedMotion() ? 'name' : 'crack', name: randomName(gdata()) };
  ui.hatch = h;
  if (h.step === 'crack') {
    setTimeout(() => {
      if (ui.hatch === h && h.step === 'crack') {
        h.step = 'name';
        if (!container.hidden) render();
      }
    }, HATCH_MS);
  }
  render();
}

function buildHatch() {
  const d = gdata();
  const h = ui.hatch;
  const arch = archetypeOf(d, h.arch);
  if (h.step === 'crack') {
    return [
      el('h1', {}, 'Pets'),
      el('div.panel.hatch-stage', {},
        eggPicture(arch, 'egg-wobble big'),
        el('p.muted', { 'aria-live': 'polite' }, 'Something is stirring inside...')),
    ];
  }
  const input = el('input.field.pet-name-input', {
    type: 'text',
    maxLength: d.balance.pets.nameMaxLength,
    autocomplete: 'off',
    enterKeyHint: 'done',
    value: h.name,
    id: 'pet-name-field',
  });
  input.addEventListener('input', () => { h.name = input.value; });
  const submit = () => {
    if (!act('pets/hatchStarter', { archetype: h.arch, name: input.value })) return;
    const mine = petList(gstate())[0];
    ui.hatch = null;
    ui.sel = null;
    toast(`Welcome home, ${mine ? mine.name : input.value.trim()}!`);
    render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  return [
    el('h1', {}, 'Pets'),
    el('div.panel.hatch-stage', {},
      faceIcon(petRole({ archetype: h.arch, form: 'hatchling' }), 96, arch.species),
      el('p', {}, d.pets.lines.hatch),
      el('h2', {}, arch.species),
      el('p.small.muted', {}, arch.blurb),
      el('label.small.muted', { for: 'pet-name-field' }, 'What will you call it?'),
      input,
      el('button.btn.wide', { type: 'button', onclick: () => { input.value = h.name = randomName(d, input.value); } }, 'Random name'),
      el('button.btn.wide', { type: 'button', onclick: submit }, 'Name it')),
    el('button.btn.wide', { type: 'button', onclick: () => { ui.hatch = null; render(); } }, 'Back to the eggs'),
  ];
}

// ---- roster ----

function buildRoster(st, day) {
  const d = gdata();
  const cap = petCapacity(st, d);
  const held = Object.keys(st.taming.traps).length;
  const free = freePetSpaces(st, d);
  const out = [el('h1', {}, 'Pets')];
  out.push(el('p.pet-capacity', {},
    el('b', {}, `Pets ${petList(st).length} / ${cap} spaces`),
    held > 0 && el('span.small.muted', {}, ` - ${held} held by a trap`)));
  if (free <= 0) out.push(el('p.small.muted.pet-capacity-note', {}, 'Every space is taken. Upgrade the Stable or release a pet to make room.'));
  out.push(el('h2', {}, 'Active'));
  st.pets.active.forEach((pid, i) => {
    const pet = pid && getPet(st, pid);
    out.push(pet ? petCard(st, pet, day) : el('div.panel.pet-empty', {},
      el('b', {}, `Slot ${i + 1} is free`),
      el('p.small.muted', {}, 'Tame a wild monster on the World tab, or hatch an egg in the Nest.')));
  });
  const stabled = petList(st).filter((p) => !st.pets.active.includes(p.id));
  if (stabled.length) {
    out.push(el('h2', {}, 'Stable'));
    for (const p of stabled) out.push(petCard(st, p, day));
  }
  out.push(yardPanel(app.game));
  out.push(buildNest(st, d));
  out.push(buildPantry(st, d));
  return out;
}

// ---- the Nest ----

function fmtLeft(ms) {
  const min = Math.ceil(Math.max(0, ms) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

function buildNest(st, d) {
  const eggs = eggList(st, d);
  const heirs = heirEggList(st);
  const waiting = [
    ...eggs.map((e) => el('p.small.nest-waiting', {}, `${e.count} ${e.item.name}${e.count === 1 ? '' : 's'} waiting`)),
    ...heirs.map((h) => el('p.small.nest-waiting', {}, `An heir egg of ${h.elder || 'an elder'} is waiting in the Elder Grove`)),
  ];
  const panel = el('div.panel.nest-panel', {}, el('h2', {}, 'Nest'));
  if (buildingTier(st, 'nest') < 1) {
    panel.append(el('p.small.muted', {}, 'The Nest opens at Renown 8 - eggs you find wait in your bag'), ...waiting);
    return panel;
  }
  panel.append(el('p.small.muted', {}, 'Eggs warm in the Nest, even while you are away. What is inside stays a surprise until it hatches.'));
  for (const n of nestList(st, d)) {
    if (!n.egg) {
      const row = el('div.nest-slot.empty', {}, el('b', {}, `Slot ${n.slot + 1} is empty`));
      if (eggs.length || heirs.length) {
        for (const e of eggs) {
          row.append(el('button.btn.wide', { type: 'button', onclick: () => act('nest/place', { item: e.key, slot: n.slot }) }, `Place ${e.item.name}`));
        }
        for (const h of heirs) {
          row.append(el('button.btn.wide', { type: 'button', onclick: () => act('nest/placeHeir', { egg: h.index, slot: n.slot }) }, `Place the heir egg of ${h.elder || 'an elder'}`));
        }
      } else row.append(el('p.small.muted', {}, 'No eggs in your bag. Dig up treasure to find one.'));
      panel.append(row);
      continue;
    }
    const arch = archetypeOf(d, n.archetype);
    if (n.ready) {
      panel.append(el('div.nest-slot.ready', {},
        eggPicture(arch, 'egg-wobble-loop'),
        el('div.nest-body', {},
          el('b', {}, 'Ready to hatch!'),
          n.heir && el('span.small.muted', {}, `Heir of ${n.heir.name || 'an elder'}`),
          el('button.btn.wide', { type: 'button', onclick: () => hatchSheet(n.slot) }, 'Hatch'))));
    } else {
      const fill = el('div.fill', {});
      const txt = el('span.small', {});
      const slot = n.slot;
      live((s) => {
        const e = s.nest.slots[slot];
        if (!e) return;
        fill.style.width = `${Math.max(0, Math.min(100, (1 - e.msLeft / n.total) * 100))}%`;
        txt.textContent = `${fmtLeft(e.msLeft)} left`;
      });
      panel.append(el('div.nest-slot', {},
        eggPicture(arch, ''),
        el('div.nest-body', {}, el('b', {}, n.heir ? `Heir of ${n.heir.name || 'an elder'} is warming` : `${n.egg.name} is warming`), el('div.bar.big', { 'aria-hidden': 'true' }, fill), txt)));
    }
  }
  panel.append(...waiting);
  return panel;
}

function hatchSheet(slot) {
  const d = gdata();
  const e = gstate().nest.slots[slot];
  if (!e) return;
  const arch = archetypeOf(d, e.archetype);
  const body = el('div.hatch-stage.nest-hatch', {});
  let closeSheet = () => {};
  const nameStep = () => {
    const input = el('input.field.pet-name-input', {
      type: 'text', maxLength: d.balance.pets.nameMaxLength, autocomplete: 'off', enterKeyHint: 'done', value: randomName(d), 'aria-label': 'Pet name',
    });
    const problem = el('p.small.nest-problem', { 'aria-live': 'polite' });
    const submit = () => {
      const before = new Set(petList(gstate()).map((p) => p.id));
      try {
        app.game.dispatch('nest/hatch', { slot, name: input.value });
      } catch (err) {
        // The sheet covers the toast, so the reason is shown inside the sheet.
        problem.textContent = err.message;
        return;
      }
      closeSheet();
      const born = petList(gstate()).find((p) => !before.has(p.id));
      toast(`Welcome home, ${born ? born.name : input.value.trim()}!`);
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    body.replaceChildren(
      faceIcon(petRole({ archetype: e.archetype, form: 'hatchling' }), 96, arch.species),
      el('p', {}, d.pets.lines.hatch),
      el('h3', {}, arch.species),
      el('p.small.muted', {}, arch.blurb),
      el('label.small.muted', { for: 'nest-name-field' }, 'What will you call it?'),
      input,
      problem,
      randomNameButton(d, input),
      el('button.btn.wide', { type: 'button', onclick: submit }, 'Name it'));
    input.id = 'nest-name-field';
    input.focus();
    input.select();
  };
  body.append(eggPicture(arch, reducedMotion() ? 'big' : 'egg-wobble big'), el('p.muted', { 'aria-live': 'polite' }, 'Something is stirring inside...'));
  closeSheet = sheetWithClose('Not yet', 'Hatch the egg', body);
  if (reducedMotion()) nameStep();
  else setTimeout(() => { if (body.isConnected) nameStep(); }, HATCH_MS);
}

function releaseSheet(pet) {
  const d = gdata();
  const arch = archetypeOf(d, pet.archetype);
  const items = Object.entries(arch?.release || {}).map(([k, n]) => `${n} ${itemLabel(d, k)}`);
  let close = () => {};
  const go = () => {
    if (!act('pets/release', { pet: pet.id })) return;
    close();
    ui.page = null;
    container.scrollTop = 0;
    toast(`${pet.name} went back to the wild.`);
    render();
  };
  close = sheetWithClose('Keep them', `Release ${pet.name}?`,
    el('p', {}, "This can't be undone."),
    items.length ? el('p.small', {}, `They leave behind: ${items.join(', ')}`) : null,
    el('button.btn.wide.btn-danger', { type: 'button', onclick: go }, `Release ${pet.name}`));
}

function petCard(st, pet, day) {
  const d = gdata();
  const form = d.pets.forms.find((f) => f.id === pet.form);
  const evolveReady = evolveInfo(st, d, pet.id).ready;
  return el('button.panel.pet-card', { type: 'button', onclick: () => openPet(pet.id), 'aria-label': `${pet.name}, open pet page` },
    faceIcon(petRole(pet), 48, pet.name),
    el('span.pet-card-body', {},
      el('span.pet-card-top', {},
        el('b.pet-name', {}, pet.name),
        canPatToday(st, pet.id, day) ? el('span.pet-pat-badge', {}, 'Pat me!')
          : canPlayToday(st, pet.id, day) && el('span.pet-pat-badge', {}, 'Play time!'),
        evolveReady && el('span.pet-tag', {}, 'Ready to evolve'),
        pet.offer && el('span.pet-tag', {}, 'Talent to choose'),
        pet.wish && el('span.pet-wish-dot', { title: 'Has a wish', 'aria-label': 'Has a wish' })),
      el('span.small.muted.pet-sub', {}, `${petSpecies(d, pet)} - ${form?.name || ''} - Level ${pet.level}`),
      stars(pet),
      energyRow(pet.id),
      el('span.pet-card-hearts', {}, el('span.small.muted', {}, 'Bond'), hearts(pet)),
      statusLine(pet.id)));
}

function pantryRow(entry, extra) {
  const count = el('span.pet-count', {}, `x${entry.count}`);
  live((st) => { count.textContent = `x${st.bag[entry.id] || 0}`; });
  return { count, parts: [itemIcon(entry.id, 32, entry.label), el('span.pet-row-name', {}, entry.label, el('span.small.muted.pet-energy-gain', {}, `+${Math.round(entry.food)} energy`)), count, extra] };
}

function buildPantry(st, d) {
  const list = pantryList(st, d);
  const panel = el('div.panel', {},
    el('h2', {}, 'Pantry'),
    el('p.small.muted', {}, 'Pets eat only cooked meals and tonics: on their own when their energy runs low, or by hand from a pet\'s page.'));
  if (!list.length) {
    panel.append(el('p', {}, 'No cooked food yet. Cook a meal in the Kitchen, or brew a tonic in the Alchemy Lab.'));
    return panel;
  }
  for (const e of list) {
    const toggle = el('button.btn.pet-toggle', {
      type: 'button',
      'aria-pressed': e.on ? 'true' : 'false',
      'aria-label': `Allow pets to eat ${e.label}`,
      onclick: () => act('pets/setPantry', { item: e.id, on: !e.on }),
    }, e.on ? 'On' : 'Off');
    panel.append(el('div.pet-row', {}, pantryRow(e, toggle).parts));
  }
  return panel;
}

// ---- pet page ----

// Opens a pet's page from another tab (the Home pet sheet); the shell switches to this tab first.
export function openPetPage(petId) {
  if (root) openPet(petId);
}

function openPet(petId) {
  ui.page = petId;
  ui.note = '';
  container.scrollTop = 0;
  render();
}

function closePet() {
  ui.page = null;
  ui.note = '';
  container.scrollTop = 0;
  render();
}

function setNote(text) {
  ui.note = text;
  if (refs.note) refs.note.textContent = text;
}

function spawnHearts() {
  const host = refs.portrait;
  if (!host) return;
  const count = reducedMotion() ? 1 : 5;
  for (let i = 0; i < count; i++) {
    const h = pixelSvg(HEART, 'pet-float-heart');
    h.style.left = `${20 + Math.random() * 60}%`;
    h.style.animationDelay = `${i * 120}ms`;
    host.append(h);
    setTimeout(() => h.remove(), 1800 + i * 120);
  }
}

function panelOf(title, ...kids) {
  return el('div.panel', {}, title && el('h2', {}, title), ...kids);
}

function barBlock(fillRef) {
  return el('div.bar.big', { 'aria-hidden': 'true' }, fillRef);
}

// ---- evolution, talents, helping (Phase 8) ----

function assistText(d, br) {
  if (!br?.assist?.station) return 'Digs up treasure';
  return `Helps at the ${stationDef(d, br.assist.station)?.name || br.assist.station} as an adult`;
}

function confirmEvolve(pet, branchId, speciesName, branchName) {
  let close = () => {};
  const go = () => {
    const wasForm = pet.form;
    if (!act('pets/evolve', branchId ? { pet: pet.id, branch: branchId } : { pet: pet.id })) return;
    close();
    const after = getPet(gstate(), pet.id);
    if (after && after.form !== wasForm) {
      setNote(fmt(pick(gdata().pets.lines.evolved), { name: after.name, species: petSpecies(gdata(), after) }));
      spawnHearts();
    }
  };
  close = sheetWithClose('Not yet', `Evolve ${pet.name}?`,
    el('p', {}, `This is permanent. ${pet.name} will become a ${speciesName}${branchName ? ` (${branchName} path)` : ''}.`),
    el('button.btn.wide', { type: 'button', onclick: go }, 'Evolve'));
}

function checkRow(ok, text) {
  return el('div.pet-check', {}, el('span.pet-check-mark', { 'aria-hidden': 'true' }, ok ? '✓' : '○'), el('span', {}, text));
}

function buildEvolution(st, pet) {
  const d = gdata();
  const b = d.balance.pets;
  const pid = pet.id;
  const info = evolveInfo(st, d, pid);
  if (pet.form === 'mythic') {
    const m = panelOf('Mythic',
      el('p', {}, `${petSpecies(d, pet)} is a mythic. Mythics never change form.`));
    for (const e of petEffects(d, pet)) m.append(el('p.small.pet-effect', {}, effectText(d, e)));
    return m;
  }
  const panel = panelOf('Evolution');
  if (info.next === 'juvenile') {
    const atLevel = pet.level >= info.levelNeed;
    panel.append(el('p.small.muted', {}, `At level ${info.levelNeed}, ${pet.name} can choose a path. Do a path's work to open it. The choice is permanent.`));
    if (info.reason) panel.append(el('p.small', {}, info.reason));
    for (const br of info.branches) {
      const f = el('div.fill', {});
      const t = el('span.small', {});
      live((s) => {
        const p = getPet(s, pid);
        if (!p) return;
        const n = Math.min(b.callingActions, Math.floor(p.actions?.[br.calling] || 0));
        f.style.width = `${(n / b.callingActions) * 100}%`;
        t.textContent = `${n} / ${b.callingActions} ${skillName(br.calling)} actions`;
      });
      const card = el('div.pet-branch', {},
        el('div.pet-branch-top', {},
          faceIcon(`pet.${pet.archetype}.${br.id}.juvenile`, 48, br.juvenile?.species),
          el('div.pet-branch-text', {},
            el('b', {}, `${br.name} path`),
            el('span.small.muted', {}, `Becomes a ${br.juvenile?.species}`))),
        t, barBlock(f),
        ...br.strength.map((e) => el('p.small.pet-effect', {}, effectText(d, e))),
        el('p.small.muted', {}, `As an adult: ${b.evolve.adultStrengthMult} times as strong`),
        el('p.small.muted', {}, assistText(d, br)));
      if (atLevel && br.unlocked) {
        card.append(el('button.btn.wide', { type: 'button', onclick: () => confirmEvolve(pet, br.id, br.juvenile?.species, br.name) }, `Choose ${br.name}`));
      }
      panel.append(card);
    }
  } else if (info.next === 'adult') {
    const br = branchDef(d, pet.archetype, pet.branch);
    const adultName = br?.adult?.species || 'adult';
    panel.append(el('div.pet-branch-top', {},
      faceIcon(`pet.${pet.archetype}.${pet.branch}.adult`, 48, adultName),
      el('div.pet-branch-text', {},
        el('b', {}, `${br?.name || ''} path`),
        el('span.small.muted', {}, `Becomes a ${adultName}`))));
    if (br?.adult?.desc) panel.append(el('p.small.muted', {}, br.adult.desc));
    panel.append(checkRow(pet.level >= info.levelNeed, `Level ${info.levelNeed} (now ${pet.level})`));
    panel.append(checkRow(info.hearts >= info.heartsNeed, `Bond heart ${info.heartsNeed} (now ${info.hearts})`));
    if (info.catalyst) {
      const cat = info.catalyst;
      const have = el('b', {}, `${Math.min(1, cat.have)} / 1`);
      live((s) => { have.textContent = `${Math.min(1, s.bag[cat.item] || 0)} / 1`; });
      panel.append(el('div.pet-check', {},
        el('span.pet-check-mark', { 'aria-hidden': 'true' }, cat.have >= 1 ? '✓' : '○'),
        itemIcon(cat.item, 32, itemLabel(d, cat.item)),
        el('span.pet-check-name', {}, itemLabel(d, cat.item), cat.have >= 1 ? '' : el('span.small.muted', {}, ' - make it at the Alchemy Lab')),
        have));
    }
    if (!info.ready && info.reason) panel.append(el('p.small.muted', {}, info.reason));
    panel.append(el('button.btn.wide', { type: 'button', disabled: !info.ready, onclick: () => confirmEvolve(pet, null, adultName, br?.name) }, `Evolve into ${adultName}`));
  } else {
    panel.append(el('p', {}, 'Fully grown.'));
    const eff = petEffects(d, pet);
    for (const e of eff) panel.append(el('p.small.pet-effect', {}, effectText(d, e)));
  }
  return panel;
}

function talentCard(id, gift) {
  const t = talentDef(gdata(), id);
  return el('div.pet-talent', {},
    el('b', {}, gift ? el('span.pet-gift-star', { 'aria-hidden': 'true' }, '★ ') : '', t?.name || id, gift ? el('span.small.muted', {}, ' (Gift)') : ''),
    el('span.small', {}, t?.desc || ''));
}

function talentSheet(pet, offer) {
  let close = () => {};
  const cards = offer.map((id) => {
    const t = talentDef(gdata(), id);
    return el('button.pet-talent-card', {
      type: 'button',
      onclick: () => { if (act('pets/pickTalent', { pet: pet.id, talent: id })) close(); },
    }, el('b', {}, t?.name || id), el('span.small', {}, t?.desc || ''));
  });
  close = sheetWithClose('Later', `Choose a talent for ${pet.name}`, ...cards);
}

function buildTalents(st, pet) {
  const d = gdata();
  const info = talentInfo(st, d, pet.id);
  const panel = panelOf('Talents');
  if (pet.heirloom) {
    const parent = st.elders.list.find((e) => e.id === pet.parent);
    const t = talentDef(d, pet.heirloom);
    panel.append(el('div.pet-talent.heirloom', {},
      el('b', {}, el('span.pet-gift-star', { 'aria-hidden': 'true' }, '♥ '), `Heirloom: ${t?.name || pet.heirloom}`),
      el('span.small', {}, t?.desc || ''),
      parent && el('span.small.muted', {}, `Passed down by ${parent.name}`)));
  }
  for (const g of info.gifts) panel.append(talentCard(g, true));
  let nextDue = true;
  for (const pk of info.picks) {
    if (pk.talent) {
      panel.append(talentCard(pk.talent, false));
    } else if (pk.level <= pet.level && nextDue && info.offer) {
      nextDue = false;
      panel.append(el('div.pet-talent.due', {},
        el('b', {}, `Level ${pk.level} talent`),
        el('button.btn.wide', { type: 'button', onclick: () => talentSheet(pet, info.offer) }, 'Choose a talent')));
    } else {
      panel.append(el('div.pet-talent.later', {}, el('span.small.muted', {}, `Level ${pk.level}`)));
    }
  }
  return panel;
}

function buildHelping(st, pet) {
  const d = gdata();
  const pid = pet.id;
  const info = assistInfo(st, d, pid);
  if (pet.form === 'mythic') {
    return panelOf('Helping', el('p.small', {}, info.reason));
  }
  if (pet.form !== 'adult') {
    return panelOf('Helping', el('p.small.muted', {}, 'Adults can help at a crafting station.'));
  }
  if (!info.station) {
    return panelOf('Helping', el('p.small', {}, 'Scouts dig for treasure instead: assign them on the World tab.'));
  }
  const name = stationDef(d, info.station)?.name || info.station;
  const bonus = [];
  if (info.bonus?.speed) bonus.push(`+${Math.round(info.bonus.speed * 100)}% speed`);
  if (info.bonus?.quality) bonus.push('better quality odds');
  const panel = panelOf('Helping', el('p.small', {}, `Can help at the ${name}: ${bonus.join(' and ') || 'a steady hand'}.`));
  if (info.posted) {
    panel.append(
      el('p', {}, `Helping at the ${stationDef(d, info.posted)?.name || info.posted}: it keeps running while you work elsewhere.`),
      el('button.btn.wide', { type: 'button', onclick: () => act('pets/assist', { pet: pid, station: null }) }, 'Stop helping'));
  } else if (info.can) {
    panel.append(el('button.btn.wide', { type: 'button', onclick: () => act('pets/assist', { pet: pid, station: info.station }) }, `Help at the ${name}`));
  } else {
    panel.append(el('p.small.muted', {}, info.reason));
  }
  return panel;
}

// ---- retiring to the Elder Grove (Phase 9) ----

function retireSheet(pet, info) {
  const d = gdata();
  let pickedLoom = info.heirlooms.length ? info.heirlooms[0] : null;
  let step = 'pick';
  const body = el('div');
  let close = () => {};
  const qName = (id) => d.pets.qualities.find((q) => q.id === id)?.name || id;
  const draw = () => {
    if (step === 'pick') {
      const kids = [
        el('p', {}, `${pet.name} will move to the Elder Grove, stay on your homestead and give every pet a bonus. ${pet.name} leaves an heir egg of the same kind, ${qName(info.floor)} quality or better, and exactly ${qName(info.match)} 1 time in ${Math.round(1 / d.balance.elders.heir.matchChance)}.`),
      ];
      if (info.heirlooms.length) {
        kids.push(el('h3.pet-sub-h', {}, 'Pick the talent the heir inherits'));
        for (const id of info.heirlooms) {
          const t = talentDef(d, id);
          kids.push(el('button.pet-talent-card', {
            type: 'button', 'aria-pressed': id === pickedLoom ? 'true' : 'false',
            onclick: () => { pickedLoom = id; draw(); },
          }, el('b', {}, `${id === pickedLoom ? '✓ ' : ''}${t?.name || id}`), el('span.small', {}, t?.desc || '')));
        }
      }
      kids.push(el('button.btn.wide', { type: 'button', onclick: () => { step = 'confirm'; draw(); } }, 'Next'));
      body.replaceChildren(...kids);
    } else {
      const t = pickedLoom ? talentDef(d, pickedLoom) : null;
      body.replaceChildren(
        el('p', {}, `Retire ${pet.name} to the Elder Grove? This cannot be undone.`),
        t && el('p.small', {}, `Heirloom for the heir: ${t.name}`),
        el('button.btn.wide', {
          type: 'button',
          onclick: () => {
            if (!act('elders/retire', { pet: pet.id, heirloom: pickedLoom })) return;
            close();
            toast(`${pet.name} has moved to the Elder Grove. An heir egg is waiting.`, 3500);
          },
        }, `Yes, retire ${pet.name}`),
        el('button.btn.wide', { type: 'button', onclick: () => { step = 'pick'; draw(); } }, 'Go back'));
    }
  };
  draw();
  close = sheetWithClose('Not yet', `Retire ${pet.name}?`, body);
}

function buildRetire(st, pet) {
  const d = gdata();
  if (pet.form !== 'adult' && pet.form !== 'mythic') {
    if (pet.level < 25) return null;
    return panelOf('Retire', el('p.small.muted', {}, `Once ${pet.name} is fully grown and at level ${d.balance.elders.retireLevel}, it can retire to the Elder Grove.`));
  }
  const info = retireInfo(st, d, pet.id);
  const panel = panelOf('Retire',
    el('p.small.muted', {}, `A retired pet moves to the Elder Grove, stays on your homestead, gives every pet a bonus and leaves an heir egg.`));
  if (!info.can) {
    panel.append(el('p.small', {}, info.reason));
    return panel;
  }
  panel.append(el('button.btn.wide', { type: 'button', onclick: () => retireSheet(pet, info) }, `Retire ${pet.name}`));
  return panel;
}

function buildPage(st, day, pet) {
  const d = gdata();
  const b = d.balance.pets;
  const arch = archetypeOf(d, pet.archetype);
  const form = d.pets.forms.find((f) => f.id === pet.form);
  const quality = d.pets.qualities.find((q) => q.id === pet.quality);
  const lines = d.pets.lines;
  const out = [];
  const pid = pet.id;

  out.push(el('button.btn', { type: 'button', onclick: closePet }, 'Back'));

  // Header
  refs.portrait = el('div.pet-portrait', {}, faceIcon(petRole(pet), 96, pet.name));
  refs.note = el('p.pet-note', { 'aria-live': 'polite' }, ui.note);
  // Pat, Play, Tuck in (js/ui/petplay.js). A command rebuilds the page first, so the note lands in the new one.
  const playRow = playButtons(app.game, pid, (text, withHearts) => {
    setNote(text);
    if (withHearts) spawnHearts();
  });
  const moodLine = el('p.small.pet-mood', {});
  live((s) => {
    const p = getPet(s, pid);
    const text = p && moodText(d, p);
    moodLine.hidden = !text;
    moodLine.textContent = text || '';
  });
  out.push(el('div.panel.pet-head', {},
    refs.portrait,
    el('div.pet-head-text', {},
      el('div.pet-name-row', {},
        el('h2.pet-title', {}, pet.name),
        el('button.btn', { type: 'button', onclick: () => renameSheet(app.game, pet) }, 'Rename')),
      el('p.small.muted', {}, `${petSpecies(d, pet)} - ${form?.name || pet.form}`),
      el('p.pet-quality', {}, stars(pet), el('span.small', {}, quality?.name || pet.quality)))),
    playRow,
    refs.note,
    moodLine,
    el('p.small.muted', {}, playHelp(d, pet)));
  const noteFn = (text, withHearts) => {
    setNote(text);
    if (withHearts) spawnHearts();
  };
  const wish = wishCard(app.game, pid, { note: noteFn, onPlay: () => startPlay(app.game, pid, noteFn), live });
  if (wish) out.push(wish);

  // Energy and status
  const fill = el('div.fill', {});
  const eText = el('span.pet-energy-text', {});
  const leftText = el('p.small.muted', {});
  const status = petStatus(st, pid);
  live((s) => {
    const p = getPet(s, pid);
    if (!p) return;
    const max = petMaxEnergy(d, p);
    fill.style.width = `${Math.max(0, Math.min(100, (p.energy / max) * 100))}%`;
    eText.textContent = `${Math.round(p.energy)} / ${Math.round(max)}`;
    if (p.nap) leftText.textContent = 'Napping until full, then back to work';
    else if (status === 'working') leftText.textContent = `About ${fmtHours(workHoursLeft(d, p))} of work left`;
    else if (status === 'resting') leftText.textContent = 'Resting until full';
    else if (status === 'stabled') leftText.textContent = 'Resting in the Stable';
    else if (status === 'trip') leftText.textContent = 'Away on a day trip';
    else leftText.textContent = 'Not working right now';
  });
  const foods = foodList(st, d);
  const feedRows = foods.map((e) => {
    const r = pantryRow(e, null);
    return el('button.pet-row.pet-feed', {
      type: 'button',
      'aria-label': `Feed ${e.label} to ${pet.name}`,
      onclick: () => {
        if (act('pets/feed', { pet: pid, item: e.id })) {
          const after = getPet(gstate(), pid);
          if (after && after.favoriteKnown && !pet.favoriteKnown) {
            setNote(fmt(pick(lines.favorite), { name: pet.name, food: itemLabel(d, after.favorite) }));
            spawnHearts();
          } else setNote(fmt(pick(lines.ate), { name: pet.name, food: e.label }));
        }
      },
    }, r.parts);
  });
  const pct = Math.round(b.energy.autoFeedBelowFrac * 100);
  const autoBtn = el('button.btn.pet-toggle', {
    type: 'button',
    'aria-pressed': pet.autoFeed ? 'true' : 'false',
    'aria-label': 'Auto-feed from the pantry',
    onclick: () => act('pets/setAutoFeed', { pet: pid, on: !pet.autoFeed }),
  }, pet.autoFeed ? 'On' : 'Off');
  out.push(panelOf('Energy',
    el('div.pet-energy', {}, barBlock(fill), eText),
    el('p.pet-status-line', {}, statusInfo(st, pet).text),
    leftText,
    el('p.small.pet-favorite', {}, pet.favoriteKnown && pet.favorite
      ? `Favorite dish: ${itemLabel(d, pet.favorite)}`
      : 'Favorite dish: not found yet (try feeding different meals)'),
    el('h3.pet-sub-h', {}, 'Feed'),
    foods.length ? el('div.pet-feed-list', {}, feedRows) : el('p.small.muted', {}, 'No cooked food in your bag. Cook a meal in the Kitchen, or brew a tonic in the Alchemy Lab.'),
    el('div.toggle-row', {},
      el('span', {}, 'Auto-feed'),
      autoBtn),
    el('p.small.muted', {}, `Eats cooked meals and tonics from the pantry when energy drops below ${pct}%.`)));

  // Level
  const prog = petProgress(d, pet);
  const xpFill = el('div.fill', {});
  const xpText = el('span.small', {});
  live((s) => {
    const p = getPet(s, pid);
    if (!p) return;
    const pr = petProgress(d, p);
    if (pr.capped) {
      xpText.textContent = `${Math.floor(pr.xp)} XP saved`;
      xpFill.style.width = '100%';
    } else {
      xpText.textContent = `${Math.floor(pr.xp)} / ${pr.next} XP`;
      xpFill.style.width = `${Math.max(0, Math.min(100, (pr.xp / pr.next) * 100))}%`;
    }
  });
  out.push(panelOf('Level',
    el('p', {}, `Level ${prog.level}`),
    barBlock(xpFill),
    xpText,
    prog.capped && el('p.small.muted', {}, evolveInfo(st, d, pid).next
      ? `Highest level for a ${(form?.name || 'pet').toLowerCase()}. See the Evolution panel below to grow further; new XP is saved.`
      : 'Fully grown. New XP is saved.')));

  // Bond
  const bondFill = el('div.fill', {});
  const bondText = el('span.small', {});
  live((s) => {
    const p = getPet(s, pid);
    if (!p) return;
    const h = petHearts(d, p);
    if (h.to == null) {
      bondFill.style.width = '100%';
      bondText.textContent = `Bond ${Math.floor(h.bond)} - every heart earned`;
    } else {
      bondFill.style.width = `${Math.max(0, Math.min(100, ((h.bond - h.from) / (h.to - h.from)) * 100))}%`;
      bondText.textContent = `Bond ${Math.floor(h.bond)} / ${h.to} for the next heart`;
    }
  });
  out.push(panelOf('Bond',
    hearts(pet),
    barBlock(bondFill),
    bondText,
    el('p.small.muted', {}, `Pat and play with ${pet.name} each day, and let them work, to grow your bond. A pat gives ${b.bond.pat}, a game up to ${d.balance.petLife.play.bond.perfect}, and every ${b.bond.workMinutesPerPoint} minutes of work gives 1.`)));
  out.push(tricksPanel(app.game, pid, { note: noteFn, portrait: () => refs.portrait }));
  out.push(tripPanel(app.game, pid, { note: (text) => setNote(text), live }));

  // Stats
  const affinity = arch?.affinity || [];
  const plainSkill = d.skills.skills.find((s) => s.type === 'harvest' && !affinity.includes(s.id));
  const speedBits = [];
  if (affinity.length) speedBits.push(`x${petSpeed(d, pet, affinity[0]).toFixed(2)} at ${listNames(affinity.map(skillName))}`);
  const speedText = plainSkill
    ? `Work speed: x${petSpeed(d, pet, plainSkill.id).toFixed(2)}, ${speedBits.join('')}`
    : `Work speed: ${speedBits.join('')}`;
  out.push(panelOf('Stats',
    el('p.small', {}, speedText),
    el('p.small', {}, `Max energy: ${Math.round(petMaxEnergy(d, pet))}`),
    el('p.small', {}, `Energy used while working: ${round1(petDrainPerHour(d, pet))} per hour`),
    el('p.small', {}, `Energy gained while resting: ${round1(petRestPerHour(st, d, pet))} per hour`),
    el('h3.pet-sub-h', {}, 'Bonuses'),
    ...(petEffects(d, pet).length
      ? petEffects(d, pet).map((e) => el('p.small.pet-effect', {}, effectText(d, e)))
      : [el('p.small.muted', {}, 'No bonuses yet')])));

  out.push(buildEvolution(st, pet));
  out.push(buildTalents(st, pet));
  out.push(buildHelping(st, pet));
  const retire = buildRetire(st, pet);
  if (retire) out.push(retire);
  out.push(scrapbookPanel(d, pet.book, 'pet.book'));

  // Active / Stable
  const active = st.pets.active.includes(pid);
  const place = [];
  if (active) {
    if (petList(st).length > 1) {
      place.push(el('button.btn.wide', { type: 'button', onclick: () => act('pets/stable', { pet: pid }) }, 'Send to the Stable'));
    } else {
      place.push(el('p.small.muted', {}, 'Your only pet is working in an active slot.'));
    }
  } else {
    st.pets.active.forEach((other, i) => {
      const who = other ? getPet(st, other) : null;
      place.push(el('button.btn.wide', { type: 'button', onclick: () => act('pets/setActive', { pet: pid, slot: i }) },
        who ? `Make active in slot ${i + 1} (swaps out ${who.name})` : `Make active in slot ${i + 1} (free)`));
    });
  }
  out.push(panelOf(active ? 'Active' : 'In the Stable', place));
  if (petList(st).length > 1) {
    out.push(el('div.pet-release', {},
      el('button.btn.btn-danger', { type: 'button', onclick: () => releaseSheet(pet) }, 'Release to the wild')));
  }
  return out;
}
