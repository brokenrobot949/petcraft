// Boot: load data and save, catch up offline time, start the live loop, autosave, mount the UI.
import { loadData } from './core/data.js';
import { loadSave, writeSave, SAVE_KEY } from './core/save.js';
import { createInitialState } from './core/state.js';
import { elapsedOfflineMs, offlineCapMs } from './core/time.js';
import { createGame } from './core/game.js';
import { mountShell } from './ui/shell.js';
import { initPwa } from './ui/pwa.js';
import { el, toast } from './ui/dom.js';

async function boot() {
  const data = await loadData();
  const { balance } = data;

  const loaded = loadSave();
  const now = Date.now();
  const state = loaded.state || createInitialState(now);
  const game = createGame(data, state);

  // Offline catch-up runs through the same systems as live play.
  game.catchUp(elapsedOfflineMs(state, balance, now));
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

  // Live loop: small real-time steps. A long gap (tab in background, phone asleep) is handled
  // as catch-up, capped like offline time.
  let last = Date.now();
  const liveTimer = setInterval(() => {
    const t = Date.now();
    const dt = t - last;
    last = t;
    if (dt <= 0) return;
    if (dt > balance.tick.maxLiveStepMs) game.catchUp(Math.min(dt, offlineCapMs(game.getState(), balance)));
    else game.advance(dt);
  }, balance.tick.liveTickMs);

  // Autosave every N seconds, when the page is hidden, and when it closes.
  const autosaveTimer = setInterval(saveNow, balance.save.autosaveSeconds * 1000);
  document.addEventListener('visibilitychange', () => document.hidden && saveNow());
  window.addEventListener('pagehide', saveNow);

  const app = {
    game,
    saveNow,
    importSave(next) {
      saveNow(); // current game becomes the backup on the next write
      game.replaceState(next);
      return saveNow();
    },
    pwa: initPwa({ beforeReload: saveNow }),
  };
  mountShell(app);

  if (loaded.source === 'backup') toast('Your last save was damaged, so your backup was loaded.', 5000);
  if (loaded.error) toast(`Started a new game: ${loaded.error}.`, 5000);
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
