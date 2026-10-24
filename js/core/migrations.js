// Save migrations. MIGRATIONS[n] upgrades a version-n save to version n+1.
// Rules: never delete a migration, never edit one that has shipped, and add one for every
// SCHEMA_VERSION bump in state.js. Each migration must set the new version number.
import { SCHEMA_VERSION, newVillage, newTamingState, newEndgameState, petSeed } from './state.js';
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
  // 4 -> 5 (Phase 6): Mossbrook (commissions, merchant), the Garden, achievements, recipes learned
  // from scrolls, and the stations the player works at. Every station used to run at once; now the
  // player works one, so the first station (data order is filled in by crafting.init) with a queue
  // stays working and the others pause with their queues kept. renown.xp was a running total at
  // rank 1; it now means progress into the current rank, which renown.init settles into ranks.
  4: (s) => {
    s.crafting.working = [];
    const busy = Object.entries(s.crafting.stations).find(([, st]) => st.queue && st.queue.length);
    if (busy) s.crafting.working.push(busy[0]);
    s.crafting.known = s.crafting.known || {};
    s.village = newVillage(s.rng);
    s.garden = { plots: [], rng: deriveSeed(s.rng, 3000) };
    s.achievements = { done: {}, title: null };
    s.renown.xp = Number.isFinite(s.renown.xp) ? s.renown.xp : 0;
    s.version = 5;
    return s;
  },
  // 5 -> 6 (Phase 7): tracking encounters, traps, lures, treasure dig progress and the Nest's eggs.
  // Nothing old changes meaning; the player's harvest task stays as it was.
  5: (s) => {
    Object.assign(s, newTamingState(s.rng));
    s.version = 6;
    return s;
  },
  // 6 -> 7 (Phase 8): evolution and talents. Each pet gets its own random stream (talent offers,
  // gift talents, its favorite dish), an empty talent offer, and an unknown favorite dish; the
  // pets system's init rolls the gifts and the dish from data. Stations gain assistants; the
  // Bestiary starts empty and is filled from the pets the player has.
  6: (s) => {
    for (const pet of Object.values(s.pets.list)) {
      pet.rng = petSeed(s.rng, pet.id);
      pet.talents = Array.isArray(pet.talents) ? pet.talents : [];
      pet.gifts = Array.isArray(pet.gifts) ? pet.gifts : [];
      pet.offer = null;
      pet.favorite = null;
      pet.favoriteKnown = false;
    }
    s.crafting.assists = {};
    s.bestiary = {};
    s.version = 7;
    return s;
  },
  // 7 -> 8 (Phase 9): the endgame. The Grand Projects start at the first project, the story
  // journal and the Elder Grove start empty (their systems' init unlocks what the save already
  // earned), mythic encounters have no cooldown yet, and pets gain an empty heirloom talent and
  // no elder parent.
  7: (s) => {
    Object.assign(s, newEndgameState(s.rng));
    s.taming.mythicMs = 0;
    for (const pet of Object.values(s.pets.list)) {
      pet.heirloom = null;
      pet.parent = null;
    }
    s.version = 8;
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
