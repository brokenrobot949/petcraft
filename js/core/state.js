// The save schema (docs/architecture.md). Only the lead (Opus) changes this. Every change bumps
// SCHEMA_VERSION and adds a migration in migrations.js so existing saves keep working.
// Per-skill and per-tool entries are filled from data by each system's init(), not here.
import { newSeed } from './rng.js';

export const SCHEMA_VERSION = 2;

export function createInitialState(now) {
  return {
    version: SCHEMA_VERSION,
    meta: {
      createdAt: now,
      lastSavedAt: now,
      launches: 0,
    },
    rng: newSeed(),
    settings: {
      music: true,
      sound: true,
    },
    coins: 0,
    renown: { rank: 1, xp: 0 },
    buildings: {
      cottage: { tier: 1 },
    },
    skills: {},
    bag: {},
    tools: {},
    workers: {
      player: { task: null, progressMs: 0 },
    },
    stats: { actions: {} },
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isFinite(v) && v >= 0;

// Structural check used before every write and after every load/import.
// Returns null when valid, or a short reason string.
export function validateState(s) {
  if (!isObj(s)) return 'not an object';
  if (!Number.isInteger(s.version) || s.version < 1) return 'missing version';
  if (s.version > SCHEMA_VERSION) return 'save is from a newer version of the game';
  if (!s.meta || !Number.isFinite(s.meta.createdAt) || !Number.isFinite(s.meta.lastSavedAt)) return 'missing meta';
  if (!Number.isInteger(s.rng)) return 'missing rng';
  if (!isObj(s.settings)) return 'missing settings';
  if (!isCount(s.coins)) return 'bad coins';
  if (!s.renown || !Number.isInteger(s.renown.rank)) return 'bad renown';
  if (!s.buildings || !s.buildings.cottage || !Number.isInteger(s.buildings.cottage.tier)) return 'bad buildings';
  if (s.version < 2) return null; // older saves are checked again after migration
  if (!isObj(s.skills)) return 'bad skills';
  for (const v of Object.values(s.skills)) {
    if (!isObj(v) || !Number.isInteger(v.level) || v.level < 1 || !isCount(v.xp)) return 'bad skill entry';
  }
  if (!isObj(s.bag)) return 'bad bag';
  for (const v of Object.values(s.bag)) if (!Number.isInteger(v) || v < 0) return 'bad bag count';
  if (!isObj(s.tools)) return 'bad tools';
  if (!isObj(s.workers) || !isObj(s.workers.player)) return 'bad workers';
  for (const w of Object.values(s.workers)) {
    if (!isObj(w) || !isCount(w.progressMs)) return 'bad worker';
    if (w.task !== null && !(isObj(w.task) && w.task.zone && w.task.skill && w.task.node)) return 'bad worker task';
  }
  if (!isObj(s.stats) || !isObj(s.stats.actions)) return 'bad stats';
  return null;
}
