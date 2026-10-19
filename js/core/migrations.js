// Save migrations. MIGRATIONS[n] upgrades a version-n save to version n+1.
// Rules: never delete a migration, never edit one that has shipped, and add one for every
// SCHEMA_VERSION bump in state.js. Each migration must set the new version number.
import { SCHEMA_VERSION } from './state.js';
import { deriveSeed } from './rng.js';

const MIGRATIONS = {
  // 1 -> 2 (Phase 2): skills, bag, tools, workers and stats. Skill and tool entries are filled
  // in from data by the systems' init().
  1: (s) => {
    s.skills = s.skills || {};
    s.bag = s.bag || {};
    s.tools = s.tools || {};
    s.workers = s.workers || { player: { task: null, progressMs: 0 } };
    s.stats = s.stats || { actions: {} };
    s.version = 2;
    return s;
  },
  // 2 -> 3 (Phase 3): pets and the pantry; each worker gets its own random stream.
  2: (s) => {
    let salt = 1;
    for (const w of Object.values(s.workers)) if (!Number.isInteger(w.rng)) w.rng = deriveSeed(s.rng, salt++);
    s.pets = s.pets || { nextId: 1, active: [], list: {} };
    s.pantry = s.pantry || {};
    s.version = 3;
    return s;
  },
  // 3 -> 4 (Phase 4): crafting station queues, player buffs, lifetime craft counts. Stations are
  // filled in from data/recipes.json by the crafting system's init().
  3: (s) => {
    s.crafting = s.crafting || { stations: {} };
    s.buffs = s.buffs || {};
    s.stats.crafts = s.stats.crafts || {};
    s.version = 4;
    return s;
  },
};

export function migrate(save) {
  let s = save;
  while (s.version < SCHEMA_VERSION) {
    const step = MIGRATIONS[s.version];
    if (!step) throw new Error(`no migration from save version ${s.version}`);
    const from = s.version;
    s = step(s);
    if (s.version !== from + 1) throw new Error(`migration ${from} did not advance the version`);
  }
  return s;
}
