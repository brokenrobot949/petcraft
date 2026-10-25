// Installable-app plumbing: service worker + update bar, install prompt, iPhone guide,
// persistent storage request.
import { el, sheet } from './dom.js';
import { getPref, setPref } from './device.js';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function initPwa({ beforeReload }) {
  let deferredPrompt = null;
  const installListeners = new Set();
  const emitInstallable = () => installListeners.forEach((fn) => fn(!!deferredPrompt));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    emitInstallable();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emitInstallable();
  });

  const regReady = registerServiceWorker(beforeReload);
  requestPersistentStorage();

  // One-time iPhone guide: Safari may clear data for sites not visited in about a week;
  // home-screen apps are exempt.
  if (isIOS && !isStandalone() && !getPref('iosGuideShown', false)) {
    setPref('iosGuideShown', true);
    setTimeout(showInstallGuide, 800);
  }

  return {
    onInstallable(fn) {
      installListeners.add(fn);
      fn(!!deferredPrompt);
    },
    async install() {
      if (!deferredPrompt) return showInstallGuide();
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      emitInstallable();
    },
    showInstallGuide,
    checkForUpdate: () => checkForUpdate(regReady, beforeReload),
  };
}

function showInstallGuide() {
  if (isStandalone()) {
    sheet('Already installed', el('p', {}, "You're playing the installed app. Your progress is stored on this device."));
    return;
  }
  const steps = isIOS
    ? [
        'Already playing here? First copy your save code: Journal → Your save → Show save code → Copy code.',
        'Tap the Share button: the square with an arrow pointing up. It is at the bottom of Safari, or behind the ••• button on newer iPhones.',
        'Scroll down the list and tap "Add to Home Screen". If you see "Open as Web App", leave it on. Then tap "Add".',
        'Open PetCraft from the new icon on your Home Screen. If you copied a save code, paste it in Journal → Your save and tap "Load this save".',
        'From now on, always play from the Home Screen icon.',
      ]
    : [
        'Open the browser menu (the three dots).',
        'Tap "Install app" or "Add to Home screen".',
        'Open PetCraft from your Home Screen from now on.',
      ];
  sheet('Add PetCraft to your Home Screen',
    el('p', {}, isIOS
      ? 'Safari can clear a website’s saved data if you don’t visit it for about a week. The Home Screen app is kept safe, and it plays full screen and offline.'
      : 'It plays full screen and offline.'),
    el('ol', {}, steps.map((s) => el('li', {}, s))),
    el('p.small.muted', {}, isIOS
      ? 'The Home Screen app keeps its own save, separate from Safari, which is why step 1 copies your game across.'
      : 'Tip: Journal → Your save → Show save code makes a backup you can paste back any time.'));
}

function requestPersistentStorage() {
  if (getPref('persistAsked', false) || !navigator.storage?.persist) return;
  setPref('persistAsked', true);
  navigator.storage.persist().catch(() => {});
}

const UPDATE_CHECK_MS = 15 * 60 * 1000; // also look for a new version this often while the game is open
const FORCE_UPDATE_AFTER_MS = 8000; // "Check for updates": wait this long for the new version before reloading fresh
let acceptedUpdate = false; // the player asked for the new version: reload when it takes over

function registerServiceWorker(beforeReload) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  const bar = document.getElementById('update-bar');
  let reloading = false;

  // updateViaCache 'none': update checks skip the phone's web cache, so a new version.js is seen at once.
  const ready = navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const offer = (worker) => {
      bar.hidden = false;
      bar.querySelector('button').onclick = () => {
        beforeReload();
        acceptedUpdate = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // Look for a new version whenever the player comes back to the game.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
    setInterval(() => { if (!document.hidden) reg.update().catch(() => {}); }, UPDATE_CHECK_MS);
    return reg;
  }).catch((err) => {
    console.warn('service worker not registered', err);
    return null;
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !acceptedUpdate) return; // first install takes control silently
    reloading = true;
    location.reload();
  });
  return ready;
}

// Journal -> "Check for updates". Asks the website for its version (past every cache). If it is newer,
// saves, then installs it the normal way; if that stalls, drops the old offline copy and reloads fresh.
// The save lives in localStorage, which none of this touches.
async function checkForUpdate(regReady, beforeReload) {
  let live;
  try {
    const res = await fetch(`version.js?check=${Date.now()}`, { cache: 'no-store' });
    live = (await res.text()).match(/PETCRAFT_VERSION\s*=\s*'([^']+)'/)?.[1];
  } catch {}
  if (!live) return { ok: false, error: "Couldn't reach the website. Are you online?" };
  if (live === self.PETCRAFT_VERSION) return { ok: true, latest: true, version: live };

  beforeReload();
  acceptedUpdate = true;
  const reg = await regReady;
  await reg?.update().catch(() => {});
  const worker = reg?.waiting || reg?.installing;
  if (worker) {
    worker.postMessage({ type: 'SKIP_WAITING' });
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
    });
    setTimeout(reloadFresh, FORCE_UPDATE_AFTER_MS);
  } else {
    reloadFresh();
  }
  return { ok: true, latest: false, version: live };
}

async function reloadFresh() {
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) if (k.startsWith('petcraft-') && k !== 'petcraft-music') await caches.delete(k);
  } catch {}
  location.reload();
}
