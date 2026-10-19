// Boot: load data and save, catch up offline time, start the live loop, autosave, mount the UI.
import { loadData } from './core/data.js';
import { loadSave, writeSave, SAVE_KEY } from './core/save.js';
import { createInitialState } from './core/state.js';
import { elapsedOfflineMs, offlineCapMs } from './core/time.js';
import { createGame } from './core/game.js';
import { mountShell } from './ui/shell.js';
import { initPwa } from './ui/pwa.js';
import { loadIcons } from './ui/icons.js';
import { showAwaySummary } from './ui/away.js';
import { el, toast } from './ui/dom.js';

async function boot() {
  const data = await loadData();
  const { balance } = data;
  await loadIcons(data.sprites);

  const loaded = loadSave();
  const now = Date.now();
  const state = loaded.state || createInitialState(now);
  const game = createGame(data, state);

  // Offline catch-up runs through the same systems as live play.
  const awayMs = Math.max(0, now - game.getState().meta.lastSavedAt);
  const offlineSummary = game.catchUp(elapsedOfflineMs(game.getState(), balance, now));
  game.dispatch('meta/launched');

  let saveError = null;
  let suspended = false;
  function saveNow() {
    if (suspended) return { ok: false, error: 'the game is open in another tab' };
    const r = writeSave(game.getState(), Date.now());
    if (!r.ok && r.error !== saveError) toast(`Could not save: ${r.error}`, 4000);
    saveError = r.ok ? null : r.error;
    return r;
  }
  saveNow();

  // Only one copy of the game may own the save. When another tab or window saves, this one
  // stops (so it can't overwrite newer progress) until the player taps to continue here.
  window.addEventListener('storage', (e) => {
    if (e.key !== SAVE_KEY || suspended) return;
    suspended = true;
    clearInterval(liveTimer);
    clearInterval(autosaveTimer);
    showElsewhere();
  });

  // "While you were away" for absences long enough to matter.
  const summaryMinMs = balance.offline.summaryMinSeconds * 1000;
  const maybeShowAway = (summary, away) => {
    if (away >= summaryMinMs) showAwaySummary(app, summary, { awayMs: away });
  };

  // Live loop: small real-time steps. While the page is hidden nothing runs (browsers throttle
  // background timers anyway); on return the whole gap is one capped catch-up with one summary.
  let last = Date.now();
  const tickLive = () => {
    if (document.hidden || suspended) return;
    const t = Date.now();
    const dt = t - last;
    last = t;
    if (dt <= 0) return;
    if (dt > balance.tick.maxLiveStepMs) {
      const summary = game.catchUp(Math.min(dt, offlineCapMs(game.getState(), balance)));
      maybeShowAway(summary, dt);
    } else {
      game.advance(dt);
    }
  };
  const liveTimer = setInterval(tickLive, balance.tick.liveTickMs);

  // Autosave every N seconds, when the page is hidden, and when it closes.
  const autosaveTimer = setInterval(saveNow, balance.save.autosaveSeconds * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow();
    else tickLive();
  });
  window.addEventListener('pagehide', saveNow);

  const app = {
    game,
    saveNow,
    importSave(next) {
      saveNow(); // current game becomes the backup on the next write
      game.replaceState(next);
      return saveNow();
    },
    // Test mode: pretend the player was away for ms. Same cap and catch-up as a real return.
    simulateAway(ms) {
      const summary = game.catchUp(Math.min(ms, offlineCapMs(game.getState(), balance)));
      saveNow();
      showAwaySummary(app, summary, { awayMs: ms });
    },
    // Test mode: start over. The old game is kept as the backup.
    resetGame() {
      saveNow();
      game.replaceState(createInitialState(Date.now()));
      return saveNow();
    },
    pwa: initPwa({ beforeReload: saveNow }),
  };
  mountShell(app);

  if (loaded.source === 'backup') toast('Your last save was damaged, so your backup was loaded.', 5000);
  if (loaded.error) toast(`Started a new game: ${loaded.error}.`, 5000);
  if (loaded.state) maybeShowAway(offlineSummary, awayMs);
}

function showElsewhere() {
  document.body.append(
    el('div.sheet-backdrop', {},
      el('div.sheet', { role: 'dialog', 'aria-modal': 'true' },
        el('h2', {}, 'PetCraft is open somewhere else'),
        el('p', {}, 'Your game was saved from another tab or window, so this one has paused to keep your progress safe.'),
        el('button.btn.wide', { type: 'button', onclick: () => location.reload() }, 'Continue here'))));
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('screens').textContent = 'PetCraft could not start. Please reload the page.';
});
