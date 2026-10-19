// The app frame: top bar and the five bottom tabs. Each tab module exports
// { id, label, icon, mount(container, app), show?(), hide?() }.
import { el } from './dom.js';
import { getPref, setPref } from './device.js';
import { offlineCapMs, localDay } from '../core/time.js';
import { needsStarter, petList, canPatToday } from '../systems/pets.js';
import { craftNotice } from '../systems/crafting.js';
import * as home from './home.js';
import * as world from './world.js';
import * as pets from './pets.js';
import * as craft from './craft.js';
import * as journal from './journal.js';

const TABS = [home, world, pets, craft, journal];

export function mountShell(app) {
  const screens = document.getElementById('screens');
  const tabbar = document.getElementById('tabbar');
  tabbar.setAttribute('role', 'tablist');
  const entries = TABS.map((tab) => {
    const screen = el(`section.screen${tab.canvas ? '.canvas-screen' : ''}`, { id: `screen-${tab.id}`, role: 'tabpanel', hidden: true });
    const badge = el('span.badge', { hidden: true });
    const button = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': screen.id, onclick: () => select(tab.id) },
      el('img.px', { src: tab.icon, alt: '' }), tab.label, badge);
    screens.append(screen);
    tabbar.append(button);
    return { tab, screen, button, badge, mounted: false };
  });

  let current = null;
  function select(id) {
    const next = entries.find((e) => e.tab.id === id) || entries[0];
    if (current === next) return;
    if (current) {
      current.screen.hidden = true;
      current.button.setAttribute('aria-selected', 'false');
      current.tab.hide?.();
    }
    current = next;
    if (!next.mounted) {
      next.tab.mount(next.screen, app);
      next.mounted = true;
    }
    next.screen.hidden = false;
    next.button.setAttribute('aria-selected', 'true');
    next.tab.show?.();
    setPref('tab', next.tab.id);
  }

  // Pause/resume the visible tab's rendering when the whole page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!current) return;
    if (document.hidden) current.tab.hide?.();
    else current.tab.show?.();
  });

  const topbar = mountTopbar(app);
  app.game.subscribe(topbar);
  topbar(app.game.getState());
  select(getPref('tab', 'home'));

  const setBadge = (id, on) => {
    const e = entries.find((x) => x.tab.id === id);
    if (e) e.badge.hidden = !on;
  };
  // Pets badge: an egg is waiting, or a pet hasn't had today's pat.
  const petsBadge = (state) => {
    const today = localDay(Date.now());
    setBadge('pets', needsStarter(state) || petList(state).some((p) => canPatToday(state, p.id, today)));
  };
  app.game.subscribe(petsBadge);
  petsBadge(app.game.getState());
  // Craft badge: a station's queue ran empty since the Craft tab was last opened.
  const craftBadge = (state) => setBadge('craft', craftNotice(state));
  app.game.subscribe(craftBadge);
  craftBadge(app.game.getState());

  return { select, setBadge };
}

function mountTopbar(app) {
  const coins = document.querySelector('#stat-coins span');
  const rank = document.querySelector('#stat-renown b');
  const fill = document.querySelector('#stat-renown .fill');
  const cap = document.querySelector('#stat-cap span');
  return (state) => {
    coins.textContent = state.coins.toLocaleString();
    rank.textContent = state.renown.rank;
    fill.style.width = '0%'; // Renown XP per rank arrives with renown.json in Phase 6.
    cap.textContent = `Away ${Math.round(offlineCapMs(state, app.game.data.balance) / 3600000)}h`;
  };
}
