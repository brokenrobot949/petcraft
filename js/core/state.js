// The save schema. Only the lead (Opus) changes this. Every change bumps SCHEMA_VERSION
// and adds a migration in migrations.js so existing saves keep working.
import { newSeed } from './rng.js';

export const SCHEMA_VERSION = 1;

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
  };
}

// Structural check used before every write and after every load/import.
// Returns null when valid, or a short reason string.
export function validateState(s) {
  if (!s || typeof s !== 'object') return 'not an object';
  if (!Number.isInteger(s.version) || s.version < 1) return 'missing version';
  if (s.version > SCHEMA_VERSION) return 'save is from a newer version of the game';
  if (!s.meta || !Number.isFinite(s.meta.createdAt) || !Number.isFinite(s.meta.lastSavedAt)) return 'missing meta';
  if (!Number.isInteger(s.rng)) return 'missing rng';
  if (!s.settings || typeof s.settings !== 'object') return 'missing settings';
  if (!Number.isFinite(s.coins) || s.coins < 0) return 'bad coins';
  if (!s.renown || !Number.isInteger(s.renown.rank)) return 'bad renown';
  if (!s.buildings || !s.buildings.cottage || !Number.isInteger(s.buildings.cottage.tier)) return 'bad buildings';
  return null;
}
