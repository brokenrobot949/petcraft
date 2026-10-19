// Per-device preferences that should NOT travel with a save code (last open tab, guides seen).
// Kept apart from the game save under petcraft.device.
const KEY = 'petcraft.device';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function getPref(name, fallback) {
  const v = readAll()[name];
  return v === undefined ? fallback : v;
}

export function setPref(name, value) {
  try {
    const all = readAll();
    all[name] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
