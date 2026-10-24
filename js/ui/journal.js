// Journal tab. Phase 0 has Settings: sound toggles, save export/import, install, credits.
import { el, toast, formatAgo } from './dom.js';
import { exportCode, importCode } from '../core/save.js';
import { getPref, setPref } from './device.js';
import { createDevPanel } from './devpanel.js';
import { openMossbrook } from './mossbrook.js';
import { rankInfo } from '../systems/renown.js';
import { boardList, greatCommission } from '../systems/village.js';
import { achievementList, wornTitle } from '../systems/achievements.js';

export const id = 'journal';
export const label = 'Journal';
export const icon = 'assets/ui/tab-journal.png';

let showRender = null;
export function show() {
  showRender?.();
}

export function mount(container, app) {
  const { game } = app;

  // ---- Renown, commissions, achievements ----
  const progressHost = el('div');

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

  // ---- test mode: tap the version line 5 times within 3 seconds ----
  const devHost = el('div');
  let taps = [];
  const versionLine = el('p.small.muted', {
    style: 'margin-top:8px',
    onclick: () => {
      const now = Date.now();
      taps = taps.filter((t) => now - t < 3000).concat(now);
      if (taps.length < 5) return;
      taps = [];
      const on = !getPref('devMode', false);
      setPref('devMode', on);
      showDev(on);
      toast(on ? 'Test mode on' : 'Test mode off');
    },
  }, `Version ${self.PETCRAFT_VERSION}`);
  function showDev(on) {
    devHost.replaceChildren(...(on ? [createDevPanel(app)] : []));
  }
  showDev(getPref('devMode', false));

  container.append(
    el('h1', {}, 'Journal'),
    progressHost,
    el('p.small.muted', {}, 'Coming soon: Bestiary (Phase 8), Story journal and Elder Grove (Phase 9).'),
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
      versionLine),
    devHost,
    el('div.panel', {},
      el('h2', {}, 'Credits'),
      el('p.small', {}, 'Art, font and sound: the Ninja Adventure pack by Pixel-boy and AAA (CC0).'),
      el('p.small', {}, el('a', { href: 'https://pixel-boy.itch.io/ninja-adventure-asset-pack', target: '_blank', rel: 'noopener', style: 'color: var(--pale)' }, 'Visit the pack page')),
      el('p.small', {}, 'Rendering: PixiJS (MIT). Game design: Rob.')));


  // ---- Renown, commissions and achievements panels ----
  const GROUPS = [['skills', 'Skills'], ['homestead', 'Homestead'], ['pets', 'Pets'], ['village', 'Village'], ['collection', 'Collection']];
  let progressKey = null;
  function renderProgress(state) {
    const d = game.data;
    const info = rankInfo(state, d);
    const worn = wornTitle(state, d);
    const board = boardList(state, d);
    const great = greatCommission(state, d);
    const achs = achievementList(state, d);
    const key = JSON.stringify([info, worn, board, great, achs.map((a) => [a.id, a.done, a.progress.have])]);
    if (key === progressKey) return;
    progressKey = key;
    const itemName = (id) => d.items.items[id]?.name || id;
    const b = d.balance;

    const xpBar = el('div.bar.big.jr-bar', {}, el('div.fill'));
    xpBar.firstChild.style.width = info.max ? '100%' : `${Math.min(100, (info.xp / info.next) * 100)}%`;
    const [dMin, dMax] = b.village.daily.renown;
    const renownPanel = el('div.panel', {},
      el('h2', {}, `Renown ${info.rank}: ${info.title}`),
      worn && el('p.jr-tag', {}, `Wearing the title "${worn}"`),
      xpBar,
      el('p.small', {}, info.max ? 'You have reached the top rank!' : `${info.xp.toLocaleString()} / ${info.next.toLocaleString()} XP to Renown ${info.nextRank}`),
      info.nextUnlockRank != null && el('div', {},
        el('p.small.muted', {}, `Next: at Renown ${info.nextUnlockRank} you open`),
        el('ul.jr-list.small', {}, info.nextUnlocks.map((u) => el('li', {}, u)))),
      el('h3.jr-group', {}, 'Where Renown XP comes from'),
      el('ul.jr-list.small', {},
        el('li', {}, `Commissions: ${dMin} to ${dMax} XP each`),
        el('li', {}, `The Great Commission: ${b.village.great.renown} XP`),
        el('li', {}, 'Achievements'),
        el('li', {}, `Upgrading a building: ${b.buildings.renownXpPerTier} XP times its new tier`),
        el('li', {}, `The first time you craft each recipe: ${b.renown.firstCraft} XP`)));

    const commissionLine = (c, label) => {
      const status = c.done ? 'Delivered' : c.canDeliver ? 'Ready to deliver' : 'Still needed';
      const needs = c.items.map((i) => `${i.have}/${i.need} ${itemName(i.item)}`).join(', ');
      return el('li', {}, `${label}: `, el('b', {}, status), !c.done && !c.canDeliver ? ` (${needs})` : '');
    };
    const commissionPanel = el('div.panel', {},
      el('h2', {}, 'Commissions'),
      el('ul.jr-list.small', {},
        board.map((c) => commissionLine(c, c.giver)),
        great && commissionLine(great, 'Great Commission')),
      el('button.btn.wide', { type: 'button', style: 'margin-top:8px', onclick: () => openMossbrook(app, 'board') }, 'Go to the Commission Board'));

    const doneCount = achs.filter((a) => a.done).length;
    const achBody = [];
    for (const [gid, gname] of GROUPS) {
      const rows = achs.filter((a) => a.group === gid);
      if (!rows.length) continue;
      achBody.push(el('h3.jr-group', {}, gname), ...rows.map(achRow));
    }
    const achPanel = el('div.panel', {}, el('h2', {}, `Achievements (${doneCount} of ${achs.length} done)`), achBody);
    progressHost.replaceChildren(renownPanel, commissionPanel, achPanel);

    function achRow(a) {
      const wearing = a.done && a.title && state.achievements.title === a.id;
      const prog = a.progress;
      let bar = null;
      if (!a.done) {
        const fill = el('div.fill');
        fill.style.width = `${Math.min(100, (prog.have / prog.need) * 100)}%`;
        bar = el('div', {}, el('div.bar', {}, fill),
          el('p.small.muted', {}, `${Math.min(prog.have, prog.need).toLocaleString()} / ${prog.need.toLocaleString()}`));
      }
      return el('div.jr-ach' + (a.done ? '.done' : ''), {},
        el('div.jr-ach-top', {},
          el('span.jr-ach-name', {}, a.name),
          a.done ? el('span.jr-check', {}, '✓') : el('span.small.muted', {}, `${a.renown} XP`)),
        el('p.small.muted', {}, a.desc),
        bar,
        a.done && a.title && el('button.btn', {
          type: 'button',
          onclick: () => {
            try { game.dispatch('achievements/setTitle', { id: wearing ? null : a.id }); } catch (err) { toast(err.message); }
          },
        }, wearing ? 'Wearing' : `Wear title: ${a.title}`),
        a.done && el('p.small.muted', {}, `+${a.renown} Renown XP earned`));
    }
  }
  function render(state) {
    if (!container.hidden) renderProgress(state);
    for (const t of toggles) t.btn.textContent = state.settings[t.key] ? 'On' : 'Off';
    const opened = state.meta.launches;
    saveInfo.textContent = `Saved ${formatAgo(Date.now() - state.meta.lastSavedAt)}. Opened ${opened} time${opened === 1 ? '' : 's'} on this save.`;
  }
  game.subscribe(render);
  render(game.getState());
  renderProgress(game.getState());
  showRender = () => renderProgress(game.getState());
  setInterval(() => !container.hidden && render(game.getState()), 5000);
}
