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

  registerServiceWorker(beforeReload);
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
  };
}

function showInstallGuide() {
  if (isStandalone()) {
    sheet('Already installed', el('p', {}, "You're playing the installed app. Your progress is stored on this device."));
    return;
  }
  const steps = isIOS
    ? [
        'Open this page in Safari.',
        'Tap the Share button (the square with an arrow).',
        'Scroll down and tap "Add to Home Screen", then "Add".',
        'Open PetCraft from your Home Screen from now on.',
      ]
    : [
        'Open the browser menu (the three dots).',
        'Tap "Install app" or "Add to Home screen".',
        'Open PetCraft from your Home Screen from now on.',
      ];
  sheet('Add PetCraft to your Home Screen',
    el('p', {}, 'It plays full screen and offline, and on iPhone your progress is much safer there.'),
    el('ol', {}, steps.map((s) => el('li', {}, s))),
    el('p.small.muted', {}, 'Tip: Journal → Your save → Show save code makes a backup you can paste back any time.'));
}

function requestPersistentStorage() {
  if (getPref('persistAsked', false) || !navigator.storage?.persist) return;
  setPref('persistAsked', true);
  navigator.storage.persist().catch(() => {});
}

function registerServiceWorker(beforeReload) {
  if (!('serviceWorker' in navigator)) return;
  const bar = document.getElementById('update-bar');
  let reloading = false;

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      bar.hidden = false;
      bar.querySelector('button').onclick = () => {
        beforeReload();
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
  }).catch((err) => console.warn('service worker not registered', err));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !bar || bar.hidden) return; // first install takes control silently
    reloading = true;
    location.reload();
  });
}
