// Service worker: caches every game file so PetCraft plays offline. The cache name carries the
// version from version.js; bumping it makes browsers fetch the new files and the page shows
// "New version, tap to reload". Every shipped file must be listed in FILES
// (tools/check-precache.ps1 checks this).
importScripts('./version.js');

const CACHE = `petcraft-${self.PETCRAFT_VERSION}`;
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// Music is too big for the install precache (about 9 MB). Each track is cached the first time it plays
// and kept in its own cache, so it also survives updates and then plays offline.
const MUSIC_CACHE = 'petcraft-music';
const MUSIC = [
  'assets/audio/music/emberfall-temple.ogg',
  'assets/audio/music/heartgrove-ascension.ogg',
  'assets/audio/music/home-peaceful.ogg',
  'assets/audio/music/meadowfold-clearing.ogg',
  'assets/audio/music/mistfen-aquatic.ogg',
  'assets/audio/music/mossbrook-village.ogg',
  'assets/audio/music/stonecrag-road.ogg',
  'assets/audio/music/whisperwood-mystical.ogg',
];

const FILES = [
  './',
  'index.html',
  'version.js',
  'manifest.webmanifest',
  'css/main.css',
  'css/pets.css',
  'css/craft.css',
  'css/home.css',
  'css/village.css',
  'css/taming.css',
  'css/bestiary.css',
  'css/endgame.css',
  'lib/pixi.mjs',
  'data/balance.json',
  'data/sprites.json',
  'data/skills.json',
  'data/tools.json',
  'data/items.json',
  'data/zones.json',
  'data/pets.json',
  'data/recipes.json',
  'data/buildings.json',
  'data/renown.json',
  'data/commissions.json',
  'data/achievements.json',
  'data/market.json',
  'data/treasure.json',
  'data/talents.json',
  'data/projects.json',
  'data/story.json',
  'data/audio.json',
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
  'js/systems/achievements.js',
  'js/systems/bag.js',
  'js/systems/buffs.js',
  'js/systems/buildings.js',
  'js/systems/coins.js',
  'js/systems/crafting.js',
  'js/systems/garden.js',
  'js/systems/taming.js',
  'js/systems/treasure.js',
  'js/systems/nest.js',
  'js/systems/bestiary.js',
  'js/systems/harvest.js',
  'js/systems/meta.js',
  'js/systems/pets.js',
  'js/systems/petstats.js',
  'js/systems/renown.js',
  'js/systems/settings.js',
  'js/systems/skills.js',
  'js/systems/tools.js',
  'js/systems/village.js',
  'js/systems/sanctuary.js',
  'js/systems/story.js',
  'js/systems/elders.js',
  'js/render/homeScene.js',
  'js/render/polish.js',
  'js/render/sprites.js',
  'js/render/zoneScene.js',
  'js/ui/away.js',
  'js/ui/craft.js',
  'js/ui/device.js',
  'js/ui/dom.js',
  'js/ui/home.js',
  'js/ui/icons.js',
  'js/ui/bestiary.js',
  'js/ui/elders.js',
  'js/ui/layer.js',
  'js/ui/mastery.js',
  'js/ui/sanctuary.js',
  'js/ui/story.js',
  'js/ui/journal.js',
  'js/ui/mossbrook.js',
  'js/ui/pets.js',
  'js/ui/petname.js',
  'js/ui/pwa.js',
  'js/ui/shell.js',
  'js/ui/world.js',
  'js/ui/audio.js',
  'assets/atlas/atlas.json',
  'assets/atlas/atlas.png',
  'assets/audio/sfx/achievement.wav',
  'assets/audio/sfx/alert.wav',
  'assets/audio/sfx/batch-done.wav',
  'assets/audio/sfx/bounce.wav',
  'assets/audio/sfx/chop.wav',
  'assets/audio/sfx/coin.wav',
  'assets/audio/sfx/evolve.wav',
  'assets/audio/sfx/fish.wav',
  'assets/audio/sfx/forage.wav',
  'assets/audio/sfx/gold.wav',
  'assets/audio/sfx/heal.wav',
  'assets/audio/sfx/hunt.wav',
  'assets/audio/sfx/jump.wav',
  'assets/audio/sfx/level-up.wav',
  'assets/audio/sfx/magic.wav',
  'assets/audio/sfx/mine.wav',
  'assets/audio/sfx/power-up.wav',
  'assets/audio/sfx/project-done.wav',
  'assets/audio/sfx/project-stage.wav',
  'assets/audio/sfx/rank-up.wav',
  'assets/audio/sfx/tap.wav',
  'assets/audio/sfx/trap.wav',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('petcraft-') && k !== CACHE && k !== MUSIC_CACHE).map((k) => caches.delete(k))))
      .then(pruneMusic)
      .then(() => self.clients.claim()),
  );
});

// Forget cached tracks that are no longer in the MUSIC list.
async function pruneMusic() {
  try {
    const cache = await caches.open(MUSIC_CACHE);
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!MUSIC.some((m) => path.endsWith('/' + m))) await cache.delete(req);
    }
  } catch {}
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === 'no-store') return; // "Check for updates" asks the website itself
  if (new URL(req.url).pathname.includes('/assets/audio/music/')) {
    // Music: cache-first from its own cache; fetched and kept on the first listen.
    event.respondWith(caches.open(MUSIC_CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }
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
