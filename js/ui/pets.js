// Pets tab: first-egg choice and hatching, the roster (Active / Stable), the Pantry and pet pages.
// The UI only reads state and sends commands with game.dispatch. The screen is rebuilt only when a
// "structural key" changes (who/what is shown); bars and numbers are updated in place on every
// change so taps are never swallowed by a rebuild.
import { el, toast, sheet, sheetWithClose } from './dom.js';
import { buildingTier, petCapacity } from '../systems/buildings.js';
import { freePetSpaces } from '../systems/taming.js';
import { nestList, eggList } from '../systems/nest.js';
import { itemLabel } from '../systems/bag.js';
import { itemIcon, faceIcon } from './icons.js';
import { localDay } from '../core/time.js';
import {
  petList, getPet, needsStarter, canPatToday, petStatus, pantryList, foodList, workHoursLeft,
} from '../systems/pets.js';
import {
  archetypeOf, petProgress, petHearts, petMaxEnergy, petDrainPerHour, petRestPerHour, petSpeed, petRole,
} from '../systems/petstats.js';

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

function petKey(st, p, day) {
  const d = gdata();
  const t = st.workers[p.id]?.task;
  return [
    p.id, p.name, p.level, p.form, petHearts(d, p).hearts, petStatus(st, p.id), t ? `${t.zone}/${t.skill}` : '',
    canPatToday(st, p.id, day) ? 1 : 0, p.autoFeed ? 1 : 0, petProgress(d, p).capped ? 1 : 0,
  ].join(':');
}

function structKey(st, day) {
  const d = gdata();
  if (needsStarter(st)) return ui.hatch ? `hatch:${ui.hatch.arch}:${ui.hatch.step}` : `egg:${ui.sel}`;
  if (ui.page && !getPet(st, ui.page)) ui.page = null;
  const pantry = foodList(st, d).map((e) => e.id + (e.on ? '+' : '-')).join(',');
  const pets = petList(st).map((p) => petKey(st, p, day)).join('|');
  const nest = nestList(st, d).map((n) => `${n.slot}:${n.archetype || '-'}:${n.ready ? 1 : 0}`).join(',');
  const eggs = eggList(st, d).map((e) => `${e.key}x${e.count}`).join(',');
  const room = `${petCapacity(st, d)}/${freePetSpaces(st, d)}/${Object.keys(st.taming.traps).length}/${buildingTier(st, 'nest')}`;
  return `${ui.page ? `pet:${ui.page}` : 'roster'}#${st.pets.active.join(',')}#${pantry}#${pets}#${nest}#${eggs}#${room}`;
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
  const names = gdata().pets.suggestedNames;
  const h = { arch: ui.sel, step: reducedMotion() ? 'name' : 'crack', idx: Math.floor(Math.random() * names.length) };
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
  const names = d.pets.suggestedNames;
  const input = el('input.field.pet-name-input', {
    type: 'text',
    maxLength: d.balance.pets.nameMaxLength,
    autocomplete: 'off',
    enterKeyHint: 'done',
    value: names[h.idx],
    id: 'pet-name-field',
  });
  const submit = () => {
    if (!act('pets/hatchStarter', { archetype: h.arch, name: input.value })) return;
    const mine = petList(gstate())[0];
    ui.hatch = null;
    ui.sel = null;
    toast(`Welcome home, ${mine ? mine.name : input.value.trim()}!`);
    render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const suggest = () => { h.idx = (h.idx + 1) % names.length; input.value = names[h.idx]; };
  return [
    el('h1', {}, 'Pets'),
    el('div.panel.hatch-stage', {},
      faceIcon(petRole({ archetype: h.arch, form: 'hatchling' }), 96, arch.species),
      el('p', {}, d.pets.lines.hatch),
      el('h2', {}, arch.species),
      el('p.small.muted', {}, arch.blurb),
      el('label.small.muted', { for: 'pet-name-field' }, 'What will you call it?'),
      input,
      el('button.btn.wide', { type: 'button', onclick: suggest }, 'Suggest a name'),
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
  const waiting = eggs.map((e) => el('p.small.nest-waiting', {}, `${e.count} ${e.item.name}${e.count === 1 ? '' : 's'} waiting`));
  const panel = el('div.panel.nest-panel', {}, el('h2', {}, 'Nest'));
  if (buildingTier(st, 'nest') < 1) {
    panel.append(el('p.small.muted', {}, 'The Nest opens at Renown 8 - eggs you find wait in your bag'), ...waiting);
    return panel;
  }
  panel.append(el('p.small.muted', {}, 'Eggs warm in the Nest, even while you are away. What is inside stays a surprise until it hatches.'));
  for (const n of nestList(st, d)) {
    if (!n.egg) {
      const row = el('div.nest-slot.empty', {}, el('b', {}, `Slot ${n.slot + 1} is empty`));
      if (eggs.length) {
        for (const e of eggs) {
          row.append(el('button.btn.wide', { type: 'button', onclick: () => act('nest/place', { item: e.key, slot: n.slot }) }, `Place ${e.item.name}`));
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
        el('div.nest-body', {}, el('b', {}, `${n.egg.name} is warming`), el('div.bar.big', { 'aria-hidden': 'true' }, fill), txt)));
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
  const names = d.pets.suggestedNames;
  const body = el('div.hatch-stage.nest-hatch', {});
  let closeSheet = () => {};
  const nameStep = () => {
    let idx = Math.floor(Math.random() * names.length);
    const input = el('input.field.pet-name-input', {
      type: 'text', maxLength: d.balance.pets.nameMaxLength, autocomplete: 'off', enterKeyHint: 'done', value: names[idx], 'aria-label': 'Pet name',
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
      el('button.btn.wide', { type: 'button', onclick: () => { idx = (idx + 1) % names.length; input.value = names[idx]; } }, 'Suggest a name'),
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
  const arch = archetypeOf(d, pet.archetype);
  const form = d.pets.forms.find((f) => f.id === pet.form);
  return el('button.panel.pet-card', { type: 'button', onclick: () => openPet(pet.id), 'aria-label': `${pet.name}, open pet page` },
    faceIcon(petRole(pet), 48, pet.name),
    el('span.pet-card-body', {},
      el('span.pet-card-top', {},
        el('b.pet-name', {}, pet.name),
        canPatToday(st, pet.id, day) && el('span.pet-pat-badge', {}, 'Pat me!')),
      el('span.small.muted.pet-sub', {}, `${arch?.species || pet.archetype} - ${form?.name || ''} - Level ${pet.level}`),
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
    el('p.small.muted', {}, 'Pets eat cooked meals and tonics on their own when their energy runs low. Raw food can be hand-fed from a pet\'s page.'));
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

function renameSheet(pet) {
  const d = gdata();
  const input = el('input.field.pet-name-input', {
    type: 'text', maxLength: d.balance.pets.nameMaxLength, autocomplete: 'off', enterKeyHint: 'done', value: pet.name, 'aria-label': 'New name',
  });
  let close = () => {};
  const save = () => { if (act('pets/rename', { pet: pet.id, name: input.value })) close(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  close = sheet(`Rename ${pet.name}`, input, el('button.btn.wide', { type: 'button', onclick: save }, 'Save name'));
  input.focus();
  input.select();
}

function panelOf(title, ...kids) {
  return el('div.panel', {}, title && el('h2', {}, title), ...kids);
}

function barBlock(fillRef) {
  return el('div.bar.big', { 'aria-hidden': 'true' }, fillRef);
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
  const patOk = canPatToday(st, pid, day);
  const patBtn = el('button.btn.wide.pet-pat', {
    type: 'button',
    disabled: !patOk,
    onclick: () => {
      if (act('pets/pat', { pet: pid })) {
        setNote(fmt(pick(lines.patted), { name: pet.name }));
        spawnHearts();
      }
    },
  }, patOk ? `Pat ${pet.name}` : 'Patted today - come back tomorrow');
  out.push(el('div.panel.pet-head', {},
    refs.portrait,
    el('div.pet-head-text', {},
      el('div.pet-name-row', {},
        el('h2.pet-title', {}, pet.name),
        el('button.btn', { type: 'button', onclick: () => renameSheet(pet) }, 'Rename')),
      el('p.small.muted', {}, `${arch?.species || pet.archetype} - ${form?.name || pet.form}`),
      el('p.pet-quality', {}, stars(pet), el('span.small', {}, quality?.name || pet.quality)))),
    patBtn,
    refs.note);

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
    if (status === 'working') leftText.textContent = `About ${fmtHours(workHoursLeft(d, p))} of work left`;
    else if (status === 'resting') leftText.textContent = 'Resting until full';
    else if (status === 'stabled') leftText.textContent = 'Resting in the Stable';
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
          setNote(fmt(pick(lines.ate), { name: pet.name, food: e.label }));
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
    el('h3.pet-sub-h', {}, 'Feed'),
    foods.length ? el('div.pet-feed-list', {}, feedRows) : el('p.small.muted', {}, 'No food in your bag. Forage berries, fish or hunt in Meadowfold.'),
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
    prog.capped && el('p.small.muted', {}, `Highest level for a ${(form?.name || 'pet').toLowerCase()}. It can evolve in a later update; new XP is saved.`)));

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
    el('p.small.muted', {}, `Pat once a day and let ${pet.name} work to grow your bond. A pat gives ${b.bond.pat}, and every ${b.bond.workMinutesPerPoint} minutes of work gives 1.`)));

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
    el('p.small', {}, `Energy gained while resting: ${round1(petRestPerHour(st, d, pet))} per hour`)));

  // Calling progress
  const callRows = (arch?.branches || []).map((br) => {
    const f = el('div.fill', {});
    const t = el('span.small', {});
    live((s) => {
      const p = getPet(s, pid);
      if (!p) return;
      const n = Math.min(b.callingActions, Math.floor(p.actions?.[br.calling] || 0));
      f.style.width = `${(n / b.callingActions) * 100}%`;
      t.textContent = `${br.name}: ${n} / ${b.callingActions} ${skillName(br.calling)} actions`;
    });
    return el('div.pet-calling', {}, t, barBlock(f));
  });
  out.push(panelOf(`Paths for evolution (level ${b.stageLevelCaps[0]})`, callRows));

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
