// Service worker: caches every game file so PetCraft plays offline. The cache name carries the
// version from version.js; bumping it makes browsers fetch the new files and the page shows
// "New version, tap to reload". Every shipped file must be listed in FILES
// (tools/check-precache.ps1 checks this).
importScripts('./version.js');

const CACHE = `petcraft-${self.PETCRAFT_VERSION}`;
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

const FILES = [
  './',
  'index.html',
  'version.js',
  'manifest.webmanifest',
  'css/main.css',
  'css/pets.css',
  'css/craft.css',
  'lib/pixi.mjs',
  'data/balance.json',
  'data/sprites.json',
  'data/skills.json',
  'data/tools.json',
  'data/items.json',
  'data/zones.json',
  'data/pets.json',
  'data/recipes.json',
  'js/main.js',
  'js/core/data.js',
  'js/core/game.js',
  'js/core/migrations.js',
  'js/core/report.js',
  'js/core/rng.js',
  'js/core/save.js',
  'js/core/state.js',
  'js/core/tick.js',
  'js/core/time.js',
  'js/systems/index.js',
  'js/systems/bag.js',
  'js/systems/buffs.js',
  'js/systems/crafting.js',
  'js/systems/dev.js',
  'js/systems/harvest.js',
  'js/systems/meta.js',
  'js/systems/pets.js',
  'js/systems/petstats.js',
  'js/systems/settings.js',
  'js/systems/skills.js',
  'js/systems/tools.js',
  'js/render/homeScene.js',
  'js/render/sprites.js',
  'js/render/zoneScene.js',
  'js/ui/away.js',
  'js/ui/craft.js',
  'js/ui/device.js',
  'js/ui/devpanel.js',
  'js/ui/dom.js',
  'js/ui/home.js',
  'js/ui/icons.js',
  'js/ui/journal.js',
  'js/ui/pets.js',
  'js/ui/pwa.js',
  'js/ui/shell.js',
  'js/ui/world.js',
  'assets/atlas/atlas.json',
  'assets/atlas/atlas.png',
  'assets/fonts/NormalFont.ttf',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon-32.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/ui/button-pressed.png',
  'assets/ui/button.png',
  'assets/ui/coin.png',
  'assets/ui/tab-craft.png',
  'assets/ui/tab-home.png',
  'assets/ui/tab-journal.png',
  'assets/ui/tab-pets.png',
  'assets/ui/tab-world.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version never caches stale files.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('petcraft-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Local preview: always fetch fresh files so edits show on reload.
      if (DEV) {
        try {
          return await fetch(req);
        } catch {}
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
        throw err;
      }
    }),
  );
});
