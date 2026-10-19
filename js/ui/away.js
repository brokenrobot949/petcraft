// "While you were away" sheet, shown after offline catch-up (real or test-mode).
import { el, sheet } from './dom.js';
import { offlineCapMs } from '../core/time.js';
import { itemIcon } from './icons.js';

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
  const itemName = (id) => data.items.items[id]?.name || id;
  const body = [el('p', {}, `You were away ${formatDuration(awayMs)}.`)];

  if (summary.ms < awayMs - 1000) {
    const hours = Math.round(offlineCapMs(state, data.balance) / 3600000);
    body.push(el('p.small.muted', {}, `The world keeps working for up to ${hours} h while you're away. Upgrade the Cottage to stretch that.`));
  }

  const scroll = el('div.away-scroll');
  const workers = Object.entries(summary.workers || {}).filter(([, w]) => w.actions > 0);
  for (const [workerId, w] of workers) {
    const label = workerId === 'player' ? 'You' : workerId;
    const rows = Object.entries(w.items || {}).map(([id, n]) =>
      el('div.away-item', {}, itemIcon24(id, itemName(id)), el('span.grow', {}, itemName(id)), el('b', {}, `+${n.toLocaleString()}`)));
    const xp = Object.entries(w.xp || {}).map(([s, n]) => el('p.small', {}, `+${Math.round(n).toLocaleString()} ${skillName(s)} XP`));
    scroll.append(el('div.away-worker', {},
      el('h3', {}, label),
      el('p.small.muted', {}, `${w.actions.toLocaleString()} action${w.actions === 1 ? '' : 's'}`),
      ...rows, ...xp));
  }
  for (const [s, level] of Object.entries(summary.levelUps || {})) {
    scroll.append(el('p.away-levelup', {}, `${skillName(s)} reached level ${level}!`));
  }
  if (!workers.length) {
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
