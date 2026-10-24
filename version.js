// The single version stamp for PetCraft. Bump on every release that changes any shipped file:
// the service worker re-caches everything and players see "New version, tap to reload".
// Loaded as a classic script by index.html (window) and by sw.js via importScripts (self).
self.PETCRAFT_VERSION = '0.9.0';
