// Test mode panel (hidden; toggled by tapping the version line in Journal five times).
// For testing only. Removed before release.
import { el, toast } from './dom.js';

export function createDevPanel(app) {
  const { game } = app;
  const data = game.data;
  const run = (type, payload) => {
    try {
      game.dispatch(type, payload);
    } catch (err) {
      toast(err.message);
    }
  };

  const itemSel = el('select.field', { 'aria-label': 'Item' },
    Object.entries(data.items.items).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, it]) => el('option', { value: id }, it.name)));
  const qty = el('input.field', { type: 'number', value: '10', min: '1', inputMode: 'numeric', 'aria-label': 'Quantity' });
  const skillSel = el('select.field', { 'aria-label': 'Skill' },
    data.skills.skills.map((s) => el('option', { value: s.id }, s.name)));
  const level = el('input.field', { type: 'number', value: '5', min: '1', max: String(data.balance.skills.maxLevel), inputMode: 'numeric', 'aria-label': 'Level' });

  const away = (label, ms) => el('button.btn', { type: 'button', onclick: () => app.simulateAway(ms) }, label);
  const H = 3600000;

  return el('div.panel.dev-panel', {},
    el('h2', {}, 'Test mode'),
    el('p.small.muted', {}, 'For testing. Removed before release.'),
    el('h3', {}, 'Give items'),
    el('div.row', {}, itemSel, qty,
      el('button.btn', { type: 'button', onclick: () => run('dev/grant', { item: itemSel.value, qty: Number(qty.value) }) }, 'Grant')),
    el('h3', {}, 'Set skill level'),
    el('div.row', {}, skillSel, level,
      el('button.btn', { type: 'button', onclick: () => run('dev/setLevel', { skill: skillSel.value, level: Number(level.value) }) }, 'Set')),
    el('h3', {}, 'Coins'),
    el('div.row', {},
      el('button.btn', { type: 'button', onclick: () => run('dev/addCoins', { amount: 100 }) }, '+100'),
      el('button.btn', { type: 'button', onclick: () => run('dev/addCoins', { amount: 1000 }) }, '+1000')),
    el('h3', {}, 'Pretend I was away'),
    el('div.row', {}, away('10 min', 600000), away('1 h', H), away('8 h', 8 * H), away('20 h', 20 * H)),
    el('h3', {}, 'Start over'),
    el('button.btn.wide', {
      type: 'button',
      onclick: () => {
        if (confirm('Start a new game? Your current game is kept as a backup.')) app.resetGame();
      },
    }, 'Start a new game'));
}
