// "While you were away" sheet, shown after offline catch-up (real or test-mode).
import { el, sheet } from './dom.js';
import { offlineCapMs } from '../core/time.js';
import { itemIcon, faceIcon } from './icons.js';
import { getPet } from '../systems/pets.js';
import { petRole } from '../systems/petstats.js';
import { itemLabel } from '../systems/bag.js';
import { stationDef } from '../systems/crafting.js';

export function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return 'less than a minute';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function showAwaySummary(app, summary, { awayMs }) {
  const { game } = app;
  const data = game.data;
  const state = game.getState();
  const skillName = (id) => data.skills.skills.find((s) => s.id === id)?.name || id;
  const itemName = (key) => itemLabel(data, key);
  const body = [el('p', {}, `You were away ${formatDuration(awayMs)}.`)];

  if (summary.ms < awayMs - 1000) {
    const hours = Math.round(offlineCapMs(state, data.balance) / 3600000);
    body.push(el('p.small.muted', {}, `The world keeps working for up to ${hours} h while you're away. Upgrade the Cottage to stretch that.`));
  }

  const scroll = el('div.away-scroll');
  const petName = (id) => getPet(state, id)?.name || 'A pet';
  const petsInfo = summary.pets || {};
  const sectionIds = new Set();
  for (const [id, w] of Object.entries(summary.workers || {})) if (w.actions > 0) sectionIds.add(id);
  for (const [id, p] of Object.entries(petsInfo)) if (p.workMs > 0 || p.restMs > 0) sectionIds.add(id);
  // The player first, then pets in the order they appear.
  const ordered = [...sectionIds].sort((a, b) => (a === 'player' ? -1 : b === 'player' ? 1 : 0));
  let anyWork = false;
  for (const workerId of ordered) {
    const isPlayer = workerId === 'player';
    const w = summary.workers?.[workerId] || { actions: 0, items: {}, xp: {}, petXp: 0 };
    const info = petsInfo[workerId];
    if (isPlayer ? w.actions > 0 : (w.actions > 0 || info?.workMs > 0)) anyWork = true;
    const pet = isPlayer ? null : getPet(state, workerId);
    const name = isPlayer ? 'You' : petName(workerId);
    const rows = Object.entries(w.items || {}).map(([id, n]) =>
      el('div.away-item', {}, itemIcon24(id, itemName(id)), el('span.grow', {}, itemName(id)), el('b', {}, `+${n.toLocaleString()}`)));
    const xp = Object.entries(w.xp || {}).map(([s, n]) => el('p.small', {}, `+${Math.round(n).toLocaleString()} ${skillName(s)} XP`));
    const extra = [];
    if (!isPlayer) {
      if (w.petXp > 0) extra.push(el('p.small', {}, `+${Math.round(w.petXp).toLocaleString()} pet XP`));
      if (info) {
        const times = [];
        if (info.workMs > 0) times.push(`Worked ${formatDuration(info.workMs)}`);
        if (info.restMs > 0) times.push(`${times.length ? 'rested' : 'Rested'} ${formatDuration(info.restMs)}`);
        if (times.length) extra.push(el('p.small', {}, times.join(', ')));
        const ate = Object.entries(info.ate || {}).map(([id, n]) => `${n} ${itemName(id)}`);
        if (ate.length) extra.push(el('p.small', {}, `Ate ${ate.join(', ')}`));
        if (info.level != null) extra.push(el('p.away-levelup', {}, `${name} reached level ${info.level}!`));
        if (info.hearts != null) extra.push(el('p.away-levelup', {}, `${name} now has ${info.hearts} heart${info.hearts === 1 ? '' : 's'}!`));
      }
    }
    scroll.append(el('div.away-worker', {},
      el('h3', {}, pet ? faceIcon(petRole(pet), 24, name) : null, el('span', {}, name)),
      w.actions > 0 ? el('p.small.muted', {}, `${w.actions.toLocaleString()} action${w.actions === 1 ? '' : 's'}`) : null,
      ...rows, ...xp, ...extra));
  }
  // Crafting stations: what each queue made.
  for (const [stationId, s] of Object.entries(summary.stations || {})) {
    anyWork = true;
    const rows = Object.entries(s.items).map(([key, n]) =>
      el('div.away-item', {}, itemIcon24(key, itemName(key)), el('span.grow', {}, itemName(key)), el('b', {}, `+${n.toLocaleString()}`)));
    scroll.append(el('div.away-worker', {},
      el('h3', {}, el('span', {}, stationDef(data, stationId)?.name || stationId)),
      ...rows,
      s.xp > 0 ? el('p.small', {}, `+${Math.round(s.xp).toLocaleString()} ${skillName(s.skill)} XP`) : null));
  }
  // Garden harvests, Renown and achievements (Phase 6).
  const gardenRows = Object.entries(summary.garden || {});
  if (gardenRows.length) {
    anyWork = true;
    scroll.append(el('div.away-worker', {},
      el('h3', {}, el('span', {}, 'Garden')),
      ...gardenRows.map(([key, n]) =>
        el('div.away-item', {}, itemIcon24(key, itemName(key)), el('span.grow', {}, itemName(key)), el('b', {}, `+${n.toLocaleString()}`)))));
  }
  for (const id of summary.achievements || []) {
    const a = data.achievements.achievements.find((x) => x.id === id);
    scroll.append(el('p.away-levelup', {}, `Achievement: ${a?.name || id}`));
  }
  if (summary.renown?.xp > 0) scroll.append(el('p.small', {}, `+${Math.round(summary.renown.xp).toLocaleString()} Renown XP`));
  if (summary.renown?.rank) scroll.append(el('p.away-levelup', {}, `You reached Renown ${summary.renown.rank}!`));
  for (const key of summary.equipped || []) {
    scroll.append(el('p.away-levelup', {}, `You equipped your new ${itemName(key)}!`));
  }
  for (const id of summary.buffsEnded || []) {
    scroll.append(el('p.small.muted', {}, `The ${itemName(id)} boost wore off.`));
  }
  for (const [s, level] of Object.entries(summary.levelUps || {})) {
    scroll.append(el('p.away-levelup', {}, `${skillName(s)} reached level ${level}!`));
  }
  if (!anyWork) {
    scroll.append(el('p', {}, "Nobody was working. Pick a task on the World tab and the world keeps working while you're away."));
  }
  body.push(scroll);
  document.querySelectorAll('.sheet-backdrop.away-sheet').forEach((n) => n.remove());
  const close = sheet('While you were away', ...body);
  document.body.lastElementChild?.classList.add('away-sheet');
  return close;
}

function itemIcon24(id, name) {
  return itemIcon(id, 24, name);
}
