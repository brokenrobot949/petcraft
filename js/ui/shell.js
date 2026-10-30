// The app frame: top bar and the five bottom tabs. Each tab module exports
// { id, label, icon, mount(container, app), show?(), hide?() }.
import { el, toast } from './dom.js';
import { getPref, setPref } from './device.js';
import { offlineCapMs, localDay } from '../core/time.js';
import { needsStarter, petList, canPatToday, petNotice } from '../systems/pets.js';
import { craftNotice } from '../systems/crafting.js';
import { canUpgradeAny } from '../systems/buildings.js';
import { villageNotice } from '../systems/village.js';
import { tamingNotice } from '../systems/taming.js';
import { nestNotice } from '../systems/nest.js';
import { sanctuaryNotice } from '../systems/sanctuary.js';
import { storyNotice } from '../systems/story.js';
import { rankInfo, rankTitle } from '../systems/renown.js';
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
    // Music: Home has its own track; the World tab sets its zone's track itself (world.js);
    // the other tabs keep whatever is playing (or Home's track if nothing is yet).
    if (next.tab.id === 'home' || !app.audio?.getScene()) app.audio?.setScene('home');
    setPref('tab', next.tab.id);
  }

  // Another screen can open a pet's page (the Home pet sheet).
  app.openPet = (petId) => {
    select('pets');
    pets.openPetPage(petId);
  };

  // Pause/resume the visible tab's rendering when the whole page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!current) return;
    if (document.hidden) current.tab.hide?.();
    else current.tab.show?.();
  });

  // Tapping the Renown bar opens the Journal's Renown panel.
  const renownStat = document.getElementById('stat-renown');
  renownStat.setAttribute('role', 'button');
  renownStat.setAttribute('tabindex', '0');
  renownStat.addEventListener('click', () => select('journal'));
  renownStat.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && select('journal'));

  // Live toasts: achievements first, the new rank last.
  app.game.onEvents((events) => {
    const d = app.game.data;
    for (const e of events) {
      if (e.type === 'achievement') toast(`Achievement: ${d.achievements.achievements.find((a) => a.id === e.id)?.name || e.id}`, 3000);
    }
    for (const e of events) {
      if (e.type === 'rankUp') toast(`Renown ${e.rank}: ${rankTitle(d, e.rank)}!`, 3000);
    }
    // Phase 9 events (the World tab says its own thing about mythic encounters and catches).
    const projectName = (id) => d.projects?.projects?.find((p) => p.id === id)?.name || 'The project';
    for (const e of events) {
      if (e.type === 'projectStage') toast('Stage complete!', 2500);
      else if (e.type === 'projectDone') toast(`${projectName(e.project)} is finished!`, 3500);
      else if (e.type === 'story') toast(`New journal entry: ${d.story?.entries?.find((x) => x.id === e.entry)?.title || ''}`, 3000);
      else if (e.type === 'masteryStar') toast(`${d.skills.skills.find((s) => s.id === e.skill)?.name || e.skill} Mastery: ${e.stars} star${e.stars === 1 ? '' : 's'}!`, 3000);
      else if (e.type === 'retired') toast(`${e.name} has retired to the Elder Grove.`, 3000);
      else if (e.type === 'groveOpened') toast('The Elder Grove has opened on your homestead', 3500);
      else if (e.type === 'tripDone') {
        const name = app.game.getState().pets.list[e.pet]?.name || 'Your pet';
        const lines = d.trips?.lines?.back || ['{name} is back from {zone}.'];
        toast(lines[Math.floor(Math.random() * lines.length)].replace('{name}', name).replace('{zone}', d.zones.zones.find((z) => z.id === e.zone)?.name || e.zone), 3000);
      }
    }
  });

  const topbar = mountTopbar(app);
  app.game.subscribe(topbar);
  topbar(app.game.getState());
  select(getPref('tab', 'home'));

  const setBadge = (id, on) => {
    const e = entries.find((x) => x.tab.id === id);
    if (e) e.badge.hidden = !on;
  };
  // Pets badge: the starter egg is waiting, an egg in the Nest is ready, a pet hasn't had today's pat,
  // or a pet can evolve or has a talent to choose.
  const petsBadge = (state) => {
    const today = localDay(Date.now());
    setBadge('pets', needsStarter(state) || nestNotice(state) || petNotice(state, app.game.data) || petList(state).some((p) => canPatToday(state, p.id, today)));
  };
  app.game.subscribe(petsBadge);
  petsBadge(app.game.getState());
  // Craft badge: a station's queue ran empty since the Craft tab was last opened.
  const craftBadge = (state) => setBadge('craft', craftNotice(state));
  app.game.subscribe(craftBadge);
  craftBadge(app.game.getState());
  // Home badge: a building can be upgraded right now, or Mossbrook has news (new board, something to deliver).
  const homeBadge = (state) => setBadge('home', canUpgradeAny(state, app.game.data) || villageNotice(state, app.game.data) || sanctuaryNotice(state, app.game.data));
  app.game.subscribe(homeBadge);
  homeBadge(app.game.getState());
  // Journal badge: a story entry the player has not read.
  const journalBadge = (state) => setBadge('journal', storyNotice(state));
  app.game.subscribe(journalBadge);
  journalBadge(app.game.getState());
  // World badge: a trap finished since the player last looked (cleared by taming/seen on the zone page).
  const worldBadge = (state) => setBadge('world', tamingNotice(state));
  app.game.subscribe(worldBadge);
  worldBadge(app.game.getState());

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
    const info = rankInfo(state, app.game.data);
    fill.style.width = info.max || !info.next ? '100%' : `${Math.min(100, (info.xp / info.next) * 100)}%`;
    cap.textContent = `Away ${Math.round(offlineCapMs(state, app.game.data.balance) / 3600000)}h`;
  };
}
