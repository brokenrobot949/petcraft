// Craft tab: buffs, the four stations (queues, recipe picker, Focus tap), equipped tools and the bag.
import { el, sheet, sheetWithClose, toast } from './dom.js';
import { itemIcon } from './icons.js';
import { bagList, itemLabel, itemKey } from '../systems/bag.js';
import { skillProgress } from '../systems/skills.js';
import {
  stationList, recipesFor, recipeDef, recipeCheck, itemMs, itemXp, makesQuality, qualityOdds, stationTimeLeft, workSlots,
} from '../systems/crafting.js';
import { activeBuffs, buffOf } from '../systems/buffs.js';
import { isUpgrade } from '../systems/tools.js';
import { foodValue } from '../systems/pets.js';
import { sellPrice } from '../systems/village.js';

export const id = 'craft';
export const label = 'Craft';
export const icon = 'assets/ui/tab-craft.png';

let container = null;
let app = null;
let buffsBox = null;
let stationsBox = null;
let workLine = null;
let toolsBox = null;
let bagBox = null;
let keys = {};
let cards = {}; // station id -> refs for the per-tick updates

export function mount(c, a) {
  container = c;
  app = a;
  buffsBox = el('div');
  workLine = el('p.small.muted.work-line');
  stationsBox = el('div.stations');
  toolsBox = el('div');
  bagBox = el('div.bag');
  container.append(
    el('h1', {}, 'Craft'),
    buffsBox, workLine, stationsBox, toolsBox,
    el('h1.bag-title', {}, 'Bag'),
    bagBox);
  app.game.subscribe(() => !container.hidden && render());
}

export function show() {
  keys = {};
  try { app.game.dispatch('crafting/seen'); } catch { /* nothing to clear */ }
  if (bagBox) render();
}

const data = () => app.game.data;
const state = () => app.game.getState();
const skillName = (sid) => data().skills.skills.find((s) => s.id === sid)?.name || sid;
const itemName = (itemId) => data().items.items[itemId]?.name || itemId;

function run(type, payload) {
  try {
    app.game.dispatch(type, payload);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const qualityName = (q) => data().tools.qualities.find((x) => x.id === q)?.name || q;

function render() {
  renderBuffs();
  renderStations();
  renderTools();
  renderBag();
}

// Swap a region's content only when its key changed.
function changed(name, key) {
  if (keys[name] === key) return false;
  keys[name] = key;
  return true;
}

// ---- buffs ----

function renderBuffs() {
  const list = activeBuffs(state(), data());
  if (!changed('buffs', list.map((b) => `${b.id}:${Math.ceil(b.msLeft / 60000)}`).join(','))) return;
  if (!list.length) { buffsBox.replaceChildren(); return; }
  buffsBox.replaceChildren(el('div.panel', {},
    el('h2', {}, 'Your buffs'),
    list.map((b) => el('div.buff-row', {},
      itemIcon(b.id, 32, b.item?.name),
      el('div.buff-text', {},
        el('div', {}, b.item?.name || b.id),
        el('div.small.muted', {}, `+${pct(b.speed)} ${b.skills.map(skillName).join(', ')}`)),
      el('div.small.muted.buff-time', {}, `${Math.max(1, Math.ceil(b.msLeft / 60000))} min left`)))));
}

// ---- stations ----

function renderStations() {
  const list = stationList(state(), data());
  const key = list.map((s) => `${s.id}/${s.slots}/${s.status}/${s.queue.map((b) => `${b.recipe}x${b.qty}`).join('+')}`).join('|');
  if (changed('stations', key)) buildStations(list);
  updateStations(list);
  renderWorkLine();
}

// "You work at N stations at a time" (and when to expect a second one).
function renderWorkLine() {
  const n = workSlots(state(), data());
  const tiers = data().balance.crafting.workSlotsByCottageTier;
  const text = `You work at ${n} station${n === 1 ? '' : 's'} at a time.`;
  const more = tiers.findIndex((x) => x > n);
  workLine.textContent = more >= 0 ? `${text} (${tiers[more]} from Cottage tier ${more + 1})` : text;
}

function buildStations(list) {
  cards = {};
  stationsBox.replaceChildren(...list.map((s, i) => stationCard(s, i, list)));
}

function stationCard(s, _i, list) {
  const refs = { batches: [] };
  cards[s.id] = refs;
  refs.level = el('span.small');
  refs.xp = el('div.fill');
  refs.left = el('div.small.muted');
  const slots = [];
  for (let i = 0; i < s.slots; i++) {
    const b = s.queue[i];
    if (b) slots.push(batchRow(s, b, i, refs));
    else slots.push(el('button.btn.wide.craft-add', { type: 'button', onclick: () => openPicker(s.id) }, '+ Craft something'));
  }
  let status = null;
  if (s.status === 'working') status = el('p.station-status', {}, "You're working here.");
  else if (s.status === 'paused') {
    const other = list.find((x) => x.working);
    status = el('div', {},
      el('p.station-status', {}, `Paused - you're at the ${other ? other.name : 'other station'}.`),
      el('button.btn.wide', { type: 'button', onclick: () => run('crafting/work', { station: s.id }) }, 'Work here'));
  }
  if (s.status === 'unbuilt') {
    return el('div.panel.station.unbuilt', {},
      el('div.station-top', {}, el('h2', {}, s.name), refs.level),
      el('div.bar', {}, refs.xp),
      el('p.small.muted.station-blurb', {}, s.blurb),
      el('p.station-status', {}, `Build the ${s.name} on the Home tab.`));
  }
  return el('div.panel.station', {},
    el('div.station-top', {}, el('h2', {}, s.name), refs.level),
    el('div.bar', {}, refs.xp),
    el('p.small.muted.station-blurb', {}, s.blurb),
    status,
    el('p.small.muted', {}, s.slots === 1 ? '1 slot' : `${s.slots} slots`),
    slots,
    refs.left);
}

function batchRow(s, b, index, refs) {
  const r = recipeDef(data(), b.recipe);
  const out = r.output;
  const row = {
    count: el('span'),
    fill: el('div.fill'),
    time: el('span.small.muted'),
    bar: el('div.bar.big', {}, null),
  };
  row.bar.append(row.fill);
  refs.batches.push({ recipe: r, batch: b, index, ...row });
  return el('div.batch', {},
    itemIcon(out, 32, itemName(out)),
    el('div.batch-body', {},
      el('div.batch-name', {}, row.count, ` ${itemName(out)}`),
      row.bar,
      row.time),
    el('button.btn.batch-cancel', { type: 'button', onclick: () => confirmCancel(s.id, index) }, 'Cancel'));
}

function updateStations(list) {
  const st = state();
  const d = data();
  for (const s of list) {
    const refs = cards[s.id];
    if (!refs) continue;
    const p = skillProgress(st, d, s.skill);
    refs.level.textContent = `${skillName(s.skill)} level ${p.level}`;
    refs.xp.style.width = p.max ? '100%' : `${Math.min(100, (p.xp / p.next) * 100)}%`;
    refs.batches.forEach((r, i) => {
      const b = s.queue[i];
      if (!b) return;
      const dur = itemMs(st, d, r.recipe);
      const prog = i === 0 ? s.progressMs : 0;
      r.count.textContent = `${b.done} / ${b.qty}`;
      r.fill.style.width = `${i === 0 ? Math.min(100, (prog / dur) * 100) : 0}%`;
      const left = (b.qty - b.done) * dur - prog;
      r.time.textContent = i === 0 ? `${fmtTime(left)} left` : `Waiting - ${fmtTime(left)} once it starts`;
    });
    refs.left.textContent = s.queue.length > 1 ? `Everything done in ${fmtTime(stationTimeLeft(st, d, s.id).total)}` : '';
  }
}

function confirmCancel(stationId, index) {
  const close = sheetWithClose('Keep it', 'Cancel this batch?',
    el('p', {}, 'Materials for the items not made yet come back to your bag. Anything already finished is yours to keep.'),
    el('button.btn.wide', { type: 'button', onclick: () => { run('crafting/cancel', { station: stationId, index }); close(); } }, 'Yes, cancel it'));
}

// ---- recipe picker ----

function openPicker(stationId) {
  const box = el('div.picker');
  const close = sheetWithClose('Close', `${data().recipes.stations.find((s) => s.id === stationId).name} recipes`, box);
  showList();

  function showList() {
    box.replaceChildren(...recipesFor(data(), stationId).map((r) => recipeRow(r)));
  }

  function recipeRow(r) {
    const st = state();
    const d = data();
    const chk = recipeCheck(st, d, r.id, 1);
    const locked = chk.reason.startsWith('Needs');
    const noMats = chk.max < 1;
    const full = !chk.ok && !locked && !noMats; // queue full
    const note = locked ? chk.reason : noMats ? 'Not enough materials' : full ? chk.reason : '';
    const inputs = Object.entries(r.inputs).map(([iid, n]) => {
      const have = st.bag[iid] || 0;
      return el('span.need' + (have < n ? '.short' : ''), {}, itemIcon(iid, 16, itemName(iid)), ` ${have}/${n}`);
    });
    return el('button.recipe' + (locked ? '.locked' : '') + (noMats && !locked ? '.nomats' : ''),
      { type: 'button', onclick: () => (chk.max >= 1 && !locked ? showQty(r) : toast(note)) },
      itemIcon(r.output, 32, itemName(r.output)),
      el('div.recipe-body', {},
        el('div.recipe-name', {}, itemName(r.output), r.qty > 1 && ` x${r.qty}`),
        el('div.recipe-inputs', {}, inputs),
        el('div.small.muted', {}, `${fmtTime(itemMs(st, d, r))} each - level ${r.level || 1}`),
        note && el('div.small.recipe-note', {}, note)));
  }

  function showQty(r) {
    const st = state();
    const d = data();
    let qty = 1;
    const max = Math.max(1, recipeCheck(st, d, r.id, 1).max);
    const info = el('div.qty-info');
    const qtyText = el('div.qty-num');
    const start = el('button.btn.wide', { type: 'button', onclick: go }, 'Start');
    const set = (n) => { qty = Math.min(max, Math.max(1, n)); refresh(); };
    const step = (label, fn) => el('button.btn.qty-btn', { type: 'button', onclick: () => set(fn()) }, label);

    function refresh() {
      const now = state();
      const chk = recipeCheck(now, d, r.id, qty);
      qtyText.textContent = `${qty} x ${itemName(r.output)}${r.qty > 1 ? ` (makes ${qty * r.qty})` : ''}`;
      const lines = [
        el('p', {}, `Time: ${fmtTime(qty * itemMs(now, d, r))}`),
        el('p', {}, `Skill XP: ${Math.round(qty * itemXp(d, r)).toLocaleString()}`),
      ];
      if (makesQuality(d, r)) {
        const o = qualityOdds(now, d, r, null);
        lines.push(el('p', {}, `Chance of Fine ${pct(o.fine)}, Masterwork ${pct(o.masterwork)} per item. A good Focus tap raises it.`));
      }
      if (!chk.ok) lines.push(el('p.recipe-note', {}, chk.reason));
      info.replaceChildren(...lines);
      start.disabled = !chk.ok;
    }

    function go() {
      const quality = makesQuality(d, r);
      const finish = (focus) => {
        if (run('crafting/start', { recipe: r.id, qty, focus })) close();
      };
      if (quality) focusTap(r, finish);
      else finish(null);
    }

    box.replaceChildren(
      el('div.qty-head', {}, itemIcon(r.output, 48, itemName(r.output)), qtyText),
      el('div.row.qty-row', {}, step('-1', () => qty - 1), step('+1', () => qty + 1), step('+10', () => qty + 10), step('Max', () => max)),
      info, start,
      el('button.btn.wide', { type: 'button', onclick: showList }, 'Back'));
    refresh();
  }
}

// ---- Focus tap ----

function focusTap(recipe, done) {
  const d = data();
  const f = d.balance.crafting.focus;
  const marker = el('div.focus-marker');
  const bar = el('div.focus-bar', {},
    el('div.focus-zone.good', { style: `width:${f.goodWidth * 100}%` }),
    el('div.focus-zone.perfect', { style: `width:${f.perfectWidth * 100}%` }),
    marker);
  const result = el('div.focus-result', {}, ' ');
  const offset = Math.random() * f.sweepMs;
  const t0 = performance.now();
  let raf = 0;
  let pos = 0;
  let locked = false;

  const tick = (now) => {
    const frac = (((now - t0) + offset) % f.sweepMs) / f.sweepMs;
    pos = frac < 0.5 ? frac * 2 : 2 - frac * 2;
    marker.style.left = `${pos * 100}%`;
    raf = requestAnimationFrame(tick);
  };

  const finish = (focus) => {
    cancelAnimationFrame(raf);
    overlay.remove();
    done(focus);
  };

  const tap = () => {
    if (locked) return;
    locked = true;
    cancelAnimationFrame(raf);
    const dist = Math.abs(pos - 0.5);
    const focus = dist <= f.perfectWidth / 2 ? 'perfect' : dist <= f.goodWidth / 2 ? 'good' : 'miss';
    const o = qualityOdds(state(), d, recipe, focus);
    const word = { perfect: 'Perfect!', good: 'Good!', miss: 'Missed it' }[focus];
    result.textContent = `${word} Fine ${pct(o.fine)}, Masterwork ${pct(o.masterwork)}`;
    result.className = `focus-result ${focus}`;
    setTimeout(() => finish(focus), 800);
  };

  const overlay = el('div.focus-overlay', {}, el('div.focus-box', {},
    el('h2', {}, 'Focus!'),
    el('p', {}, 'Tap when the marker is in the middle to make better things.'),
    el('div', { onclick: tap }, bar),
    result,
    el('button.btn.wide.focus-tap', { type: 'button', onclick: tap }, 'Tap!'),
    el('button.btn.wide', { type: 'button', onclick: () => !locked && finish(null) }, 'Skip')));
  document.body.append(overlay);
  raf = requestAnimationFrame(tick);
}

// ---- equipped tools ----

function renderTools() {
  const st = state();
  const kinds = data().tools.kinds;
  const key = kinds.map((k) => `${st.tools[k.id]?.item}:${st.tools[k.id]?.quality}`).join(',');
  if (!changed('tools', key)) return;
  toolsBox.replaceChildren(el('div.panel', {},
    el('h2', {}, 'Equipped tools'),
    el('div.tool-grid', {}, kinds.map((k) => {
      const t = st.tools[k.id];
      const kkey = t && itemKey(t.item, t.quality);
      return el('div.tool-cell', {},
        t ? itemIcon(t.item, 32, itemName(t.item)) : el('span.item-icon'),
        el('div.small', {}, kkey ? itemLabel(data(), kkey) : 'None'),
        el('div.small.muted', {}, k.name));
    }))));
}

// ---- bag ----

function renderBag() {
  const d = data();
  const list = bagList(state(), d);
  const key = list.map((e) => `${e.id}:${e.count}`).join(',');
  if (!changed('bag', key)) return;
  if (!list.length) {
    bagBox.replaceChildren(el('div.panel', {}, el('p', {}, 'Your bag is empty. Head to the World tab and pick a task to start gathering.')));
    return;
  }
  const out = [];
  for (const cat of d.items.categories) {
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
    el('span.bag-name', {}, e.item.name),
    e.quality !== 'normal' && el('span.bag-quality.q-' + e.quality, {}, qualityName(e.quality)));
}

function detail(e, catName) {
  const st = state();
  const d = data();
  const key = e.id;
  const count = st.bag[key] || 0;
  const name = itemLabel(d, key);
  const parts = [];
  let close = null;

  if (e.item.tool) {
    const eq = st.tools[e.item.tool];
    const kind = d.tools.kinds.find((k) => k.id === e.item.tool);
    parts.push(el('p.small.muted', {}, `Equipped ${kind?.name.toLowerCase() || 'tool'}: ${eq ? itemLabel(d, itemKey(eq.item, eq.quality)) : 'none'}`));
    if (isUpgrade(st, d, key)) parts.push(el('p', {}, 'Better than yours!'));
    parts.push(el('button.btn.wide', { type: 'button', onclick: () => { if (run('tools/equip', { item: key })) close(); } }, 'Equip'));
  }

  const buff = buffOf(d, key);
  if (buff) {
    const verb = e.item.category === 'potion' ? 'Drink' : 'Eat';
    parts.push(el('p', {}, `${verb} for +${pct(buff.speed)} ${buff.skills.map(skillName).join(', ')} for ${Math.round(buff.ms / 60000)} min.`));
    if (e.item.food) parts.push(el('p.small.muted', {}, `Pets can eat this too (+${Math.round(foodValue(d, key))} energy).`));
    parts.push(el('button.btn.wide', { type: 'button', onclick: () => { run('buffs/use', { item: key }); close(); } }, verb));
  } else if (e.item.food) {
    parts.push(el('p.small.muted', {}, `Pets can eat this (+${Math.round(foodValue(d, key))} energy).`));
  }

  close = sheet(name,
    el('div.item-detail', {}, itemIcon(key, 64, name),
      el('div', {}, el('p.small.muted', {}, catName), el('p', {}, `You have ${count.toLocaleString()}`))),
    e.item.desc && el('p', {}, e.item.desc),
    ...parts,
    sellPrice(d, key) > 0 && el('p.small.muted', {}, `Sells for ${sellPrice(d, key)} coins in Mossbrook`));
}
