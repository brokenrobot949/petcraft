// Saving and loading (docs/handoff.md "Saves"). The current save lives under petcraft.save; the
// previous good one under petcraft.save.bak. A save that fails to load is kept untouched under
// petcraft.save.corrupt so it can be recovered by hand, and the backup is used instead.
import { validateState } from './state.js';
import { migrate } from './migrations.js';

export const SAVE_KEY = 'petcraft.save';
const KEY = SAVE_KEY;
const BACKUP_KEY = 'petcraft.save.bak';
const CORRUPT_KEY = 'petcraft.save.corrupt';
const EXPORT_PREFIX = 'PETCRAFT1:';

// Text -> { state } or { error }. Runs migrations, then validates.
export function parseSave(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    return { error: 'not readable' };
  }
  if (!s || !Number.isInteger(s.version)) return { error: 'missing version' };
  try {
    s = migrate(s);
  } catch (e) {
    return { error: e.message };
  }
  const problem = validateState(s);
  return problem ? { error: problem } : { state: s };
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Returns { state, source: 'main' | 'backup' } or { state: null, source: 'new', error? }.
export function loadSave() {
  const main = read(KEY);
  if (main) {
    const r = parseSave(main);
    if (r.state) return { state: r.state, source: 'main' };
    try {
      localStorage.setItem(CORRUPT_KEY, main);
    } catch {}
  }
  const bak = read(BACKUP_KEY);
  if (bak) {
    const r = parseSave(bak);
    if (r.state) return { state: r.state, source: 'backup' };
  }
  return { state: null, source: 'new', error: main ? 'save and backup could not be read' : undefined };
}

// Stamps lastSavedAt, checks the new save round-trips, keeps the previous good save as the backup,
// then writes. Returns { ok } or { ok: false, error }.
export function writeSave(state, now) {
  state.meta.lastSavedAt = now;
  const text = JSON.stringify(state);
  const check = parseSave(text);
  if (!check.state) return { ok: false, error: `refused to write a bad save (${check.error})` };
  try {
    const current = localStorage.getItem(KEY);
    if (current && current !== text && parseSave(current).state) localStorage.setItem(BACKUP_KEY, current);
    localStorage.setItem(KEY, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'storage is full' : 'storage unavailable' };
  }
}

// Journal -> Start a new game: writes a brand-new game, then deletes the backup and any damaged
// copy, so nothing of the old game is left on this device. If the write fails, nothing is deleted.
export function startFresh(state, now) {
  const r = writeSave(state, now);
  if (!r.ok) return r;
  try {
    localStorage.removeItem(BACKUP_KEY);
    localStorage.removeItem(CORRUPT_KEY);
  } catch {}
  return { ok: true };
}

// Save code for Journal -> Settings: a prefix plus base64 of the UTF-8 JSON.
export function exportCode(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return EXPORT_PREFIX + btoa(bin);
}

// Save code (or raw save JSON) -> { state } or { error }.
export function importCode(code) {
  const text = (code || '').trim();
  if (!text) return { error: 'the box is empty' };
  if (text.startsWith('{')) return parseSave(text);
  if (!text.startsWith(EXPORT_PREFIX)) return { error: "that doesn't look like a PetCraft save code" };
  try {
    const bin = atob(text.slice(EXPORT_PREFIX.length).replace(/\s+/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return parseSave(new TextDecoder().decode(bytes));
  } catch {
    return { error: 'the save code is damaged or incomplete' };
  }
}
