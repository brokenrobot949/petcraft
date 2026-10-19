// Journal tab. Phase 0 has Settings: sound toggles, save export/import, install, credits.
import { el, toast, formatAgo } from './dom.js';
import { exportCode, importCode } from '../core/save.js';

export const id = 'journal';
export const label = 'Journal';
export const icon = 'assets/ui/tab-journal.png';

export function mount(container, app) {
  const { game } = app;

  // ---- sound ----
  const toggles = ['music', 'sound'].map((key) => {
    const btn = el('button.btn', { type: 'button', onclick: () => game.dispatch('settings/toggle', { key }) });
    return { key, btn, row: el('div.toggle-row', {}, el('span', {}, key === 'music' ? 'Music' : 'Sound effects'), btn) };
  });

  // ---- save status ----
  const saveInfo = el('p.small.muted');
  const saveNow = el('button.btn', {
    type: 'button',
    onclick: () => {
      const r = app.saveNow();
      toast(r.ok ? 'Game saved' : `Could not save: ${r.error}`);
    },
  }, 'Save now');

  // ---- export ----
  const exportBox = el('textarea.code', { readOnly: true, hidden: true, rows: 4, 'aria-label': 'Your save code' });
  const copyBtn = el('button.btn', { type: 'button', hidden: true, onclick: copyCode }, 'Copy code');
  const exportBtn = el('button.btn', {
    type: 'button',
    onclick: () => {
      app.saveNow();
      exportBox.value = exportCode(game.getState());
      exportBox.hidden = false;
      copyBtn.hidden = false;
      exportBox.focus();
      exportBox.select();
    },
  }, 'Show save code');

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(exportBox.value);
      toast('Save code copied');
    } catch {
      exportBox.focus();
      exportBox.select();
      document.execCommand?.('copy');
      toast('Code selected: copy it from the box');
    }
  }

  // ---- import ----
  const importBox = el('textarea.code', { rows: 4, placeholder: 'Paste a save code here', 'aria-label': 'Save code to load', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const importBtn = el('button.btn', {
    type: 'button',
    onclick: () => {
      const r = importCode(importBox.value);
      if (r.error) {
        toast(`Can't load that: ${r.error}`, 3500);
        return;
      }
      if (!confirm('Load this save? It replaces your current game. Your current game is kept as a backup.')) return;
      const w = app.importSave(r.state);
      if (w.ok) {
        importBox.value = '';
        toast('Save loaded');
      } else {
        toast(`Could not load: ${w.error}`, 3500);
      }
    },
  }, 'Load this save');

  // ---- install ----
  const installBtn = el('button.btn.wide', { type: 'button', hidden: true, onclick: () => app.pwa.install() }, 'Install PetCraft on this device');
  const installHelp = el('button.btn.wide', { type: 'button', onclick: () => app.pwa.showInstallGuide() }, 'How to add to Home Screen');
  app.pwa.onInstallable((can) => {
    installBtn.hidden = !can;
  });

  container.append(
    el('h1', {}, 'Journal'),
    el('div.panel', {},
      el('h2', {}, 'Coming soon'),
      el('ul.soon-list', {},
        el('li', {}, 'Commissions, achievements and Renown: Phase 6'),
        el('li', {}, 'Bestiary: Phase 8'),
        el('li', {}, 'Story journal and Elder Grove: Phase 9'))),
    el('div.panel', {}, el('h2', {}, 'Sound'), ...toggles.map((t) => t.row),
      el('p.small.muted', {}, 'Music and sound arrive in Phase 10. Your choice is remembered.')),
    el('div.panel', {},
      el('h2', {}, 'Your save'),
      saveInfo,
      el('div.row', {}, saveNow),
      el('p.small', { style: 'margin-top:12px' }, 'Keep a copy of your game: tap Show save code, copy it, and keep it somewhere safe (a note or a message to yourself).'),
      el('div.row', {}, exportBtn, copyBtn),
      exportBox,
      el('p.small', { style: 'margin-top:12px' }, 'To restore a game, paste its code below.'),
      importBox,
      el('div.row', {}, importBtn)),
    el('div.panel', {}, el('h2', {}, 'App'), installBtn, installHelp,
      el('p.small.muted', { style: 'margin-top:8px' }, `Version ${self.PETCRAFT_VERSION}`)),
    el('div.panel', {},
      el('h2', {}, 'Credits'),
      el('p.small', {}, 'Art, font and sound: the Ninja Adventure pack by Pixel-boy and AAA (CC0).'),
      el('p.small', {}, el('a', { href: 'https://pixel-boy.itch.io/ninja-adventure-asset-pack', target: '_blank', rel: 'noopener', style: 'color: var(--pale)' }, 'Visit the pack page')),
      el('p.small', {}, 'Rendering: PixiJS (MIT). Game design: Rob.')));

  function render(state) {
    for (const t of toggles) t.btn.textContent = state.settings[t.key] ? 'On' : 'Off';
    const opened = state.meta.launches;
    saveInfo.textContent = `Saved ${formatAgo(Date.now() - state.meta.lastSavedAt)}. Opened ${opened} time${opened === 1 ? '' : 's'} on this save.`;
  }
  game.subscribe(render);
  render(game.getState());
  setInterval(() => !container.hidden && render(game.getState()), 5000);
}
