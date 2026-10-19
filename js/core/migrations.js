// Save migrations. MIGRATIONS[n] upgrades a version-n save to version n+1.
// Rules: never delete a migration, never edit one that has shipped, and add one for every
// SCHEMA_VERSION bump in state.js. Each migration must set the new version number.
import { SCHEMA_VERSION } from './state.js';

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
