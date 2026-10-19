// Save migrations. MIGRATIONS[n] upgrades a version-n save to version n+1.
// Rules: never delete a migration, never edit one that has shipped, and add one for every
// SCHEMA_VERSION bump in state.js. Each migration must set the new version number.
import { SCHEMA_VERSION } from './state.js';

const MIGRATIONS = {
  // 1: (s) => { s.newThing = ...; s.version = 2; return s; },
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
