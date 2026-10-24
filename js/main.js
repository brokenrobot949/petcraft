// Boot: load data and save, catch up offline time, start the live loop, autosave, mount the UI.
import { loadData } from './core/data.js';
import { loadSave, writeSave, startFresh, SAVE_KEY } from './core/save.js';
import { createInitialState } from './core/state.js';
import { elapsedOfflineMs, offlineCapMs } from './core/time.js';
import { createGame } from './core/game.js';
import { mountShell } from './ui/shell.js';
import { initPwa } from './ui/pwa.js';
import { createAudio } from './ui/audio.js';
import { loadIcons } from './ui/icons.js';
import { showAwaySummary } from './ui/away.js';
import { el, toast } from './ui/dom.js';
import { needsStarter } from './systems/pets.js';
import { setPref } from './ui/device.js';

const HOUR_MS = 3600000;

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
  const catchUpMs = elapsedOfflineMs(game.getState(), balance, now);
  const t0 = performance.now();
  const offlineSummary = game.catchUp(catchUpMs);
  // Shown in Journal -> App, so catch-up speed can be read on a real phone (target: 16 h in under 300 ms).
  if (catchUpMs >= HOUR_MS) setPref('lastCatchUp', { awayMs: catchUpMs, ms: Math.round(performance.now() - t0) });
  game.dispatch('meta/launched');
  // Daily commissions reset at local midnight; the board checks the date on load, on return and every minute.
  const checkDay = () => {
    if (!suspended) game.dispatch('village/newDay');
  };

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
  checkDay();
  setInterval(checkDay, balance.village.dayCheckSeconds * 1000);

  // Autosave every N seconds, when the page is hidden, and when it closes.
  const autosaveTimer = setInterval(saveNow, balance.save.autosaveSeconds * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow();
    else {
      tickLive();
      checkDay();
    }
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
    // Journal -> Start a new game: delete this device's save (and its backup) and reload into a
    // fresh game. Saving stops first, so closing the page can't write the old game back.
    startNewGame() {
      suspended = true;
      const t = Date.now();
      const r = startFresh(createInitialState(t), t);
      if (!r.ok) {
        suspended = false;
        return r;
      }
      for (const pref of ['tab', 'worldZone', 'lastCatchUp']) setPref(pref, undefined);
      location.reload();
      return r;
    },
    // Test mode: start over. The old game is kept as the backup.
    resetGame() {
      saveNow();
      game.replaceState(createInitialState(Date.now()));
      shell.select('pets');
      return saveNow();
    },
    pwa: initPwa({ beforeReload: saveNow }),
  };
  app.audio = createAudio(game);
  // Local preview only: a handle for checking the audio from the browser console.
  if (location.hostname === 'localhost') window.__petcraft = app;
  const shell = mountShell(app);
  // A new player starts at the four eggs.
  if (needsStarter(game.getState())) shell.select('pets');

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
