// The save schema (docs/architecture.md). Only the lead (Opus) changes this. Every change bumps
// SCHEMA_VERSION and adds a migration in migrations.js so existing saves keep working.
// Per-skill and per-tool entries are filled from data by each system's init(), not here.
import { newSeed, deriveSeed } from './rng.js';

export const SCHEMA_VERSION = 8;

// seed: optional, for reproducible runs (the balance simulator, tests); a new game picks a random one.
export function createInitialState(now, seed = newSeed()) {
  return {
    version: SCHEMA_VERSION,
    meta: {
      createdAt: now,
      lastSavedAt: now,
      launches: 0,
    },
    rng: seed,
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
      player: { task: null, progressMs: 0, rng: deriveSeed(seed, 1) },
    },
    stats: { actions: {}, crafts: {} },
    pets: { nextId: 1, active: [], list: {} },
    pantry: {},
    crafting: { stations: {}, working: [], known: {}, assists: {} },
    buffs: {},
    village: newVillage(seed),
    garden: { plots: [], rng: deriveSeed(seed, 3000) },
    achievements: { done: {}, title: null },
    ...newTamingState(seed),
    bestiary: {},
    ...newEndgameState(seed),
  };
}

// The Grand Projects, the story journal and the Elder Grove (v8).
export function newEndgameState(seed) {
  return {
    sanctuary: { project: 0, stage: 0, delivered: {}, coins: 0, done: [], scenes: [] },
    story: { got: {}, seen: {} },
    elders: { open: false, list: [], eggs: [], rng: deriveSeed(seed, 9000) },
  };
}

// Taming, treasure and the Nest (v6). Their stats counters are filled by each system's init.
export function newTamingState(seed) {
  return {
    taming: { encounters: {}, traps: {}, lure: null, results: [], seen: true, mythicMs: 0, rng: deriveSeed(seed, 5000) },
    treasure: { progress: {}, rng: deriveSeed(seed, 5100) },
    nest: { slots: [], rng: deriveSeed(seed, 5200) },
  };
}

// A pet's own random stream (v7): talent offers, gift talents and its favorite dish.
export function petSeed(seed, petId) {
  return deriveSeed(seed, 7000 + (Number(String(petId).replace(/\D/g, '')) || 0));
}

// Mossbrook (v5): today's Commission Board, this week's Great Commission and merchant stock.
// day / week are null until the first village/newDay command fills them.
export function newVillage(seed) {
  return { day: null, board: [], rerolls: 0, seen: true, week: null, great: null, merchant: [], rng: deriveSeed(seed, 4000) };
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
  if (!isObj(s.buildings) || !s.buildings.cottage || !Number.isInteger(s.buildings.cottage.tier)) return 'bad buildings';
  for (const b of Object.values(s.buildings)) if (!isObj(b) || !Number.isInteger(b.tier) || b.tier < 0) return 'bad building';
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
  if (s.version < 3) return null;
  for (const w of Object.values(s.workers)) if (!Number.isInteger(w.rng)) return 'bad worker rng';
  const p = s.pets;
  if (!isObj(p) || !Number.isInteger(p.nextId) || !Array.isArray(p.active) || !isObj(p.list)) return 'bad pets';
  for (const [id, pet] of Object.entries(p.list)) {
    if (!isObj(pet) || pet.id !== id || typeof pet.name !== 'string' || !pet.archetype || !pet.quality) return 'bad pet';
    if (!Number.isInteger(pet.level) || pet.level < 1 || !isCount(pet.xp) || !isCount(pet.energy) || !isCount(pet.bond)) return 'bad pet numbers';
    if (!isObj(pet.actions)) return 'bad pet actions';
  }
  for (const id of p.active) if (id !== null && !p.list[id]) return 'active pet is missing';
  for (const id of Object.keys(s.workers)) if (id !== 'player' && !p.list[id]) return 'worker for a missing pet';
  if (!isObj(s.pantry)) return 'bad pantry';
  if (s.version < 4) return null;
  if (!isObj(s.crafting) || !isObj(s.crafting.stations)) return 'bad crafting';
  for (const st of Object.values(s.crafting.stations)) {
    if (!isObj(st) || !Array.isArray(st.queue) || !isCount(st.progressMs) || !Number.isInteger(st.rng)) return 'bad station';
    for (const b of st.queue) {
      if (!isObj(b) || typeof b.recipe !== 'string' || !Number.isInteger(b.qty) || b.qty < 1) return 'bad batch';
      if (!Number.isInteger(b.done) || b.done < 0 || b.done > b.qty || !isObj(b.inputs) || !isObj(b.made)) return 'bad batch';
    }
  }
  if (!isObj(s.buffs)) return 'bad buffs';
  for (const b of Object.values(s.buffs)) {
    if (!isObj(b) || !Array.isArray(b.skills) || !Number.isFinite(b.speed) || !Number.isFinite(b.msLeft)) return 'bad buff';
  }
  if (!isObj(s.stats.crafts)) return 'bad stats';
  if (s.version < 5) return null;
  if (!Number.isFinite(s.renown.xp) || s.renown.xp < 0) return 'bad renown';
  if (!Array.isArray(s.crafting.working) || !s.crafting.working.every((id) => typeof id === 'string')) return 'bad working stations';
  if (!isObj(s.crafting.known)) return 'bad known recipes';
  const v = s.village;
  if (!isObj(v) || !Array.isArray(v.board) || !Array.isArray(v.merchant) || !Number.isInteger(v.rng) || !Number.isInteger(v.rerolls)) return 'bad village';
  for (const c of [...v.board, ...(v.great ? [v.great] : [])]) {
    if (!isObj(c) || typeof c.template !== 'string' || !isObj(c.items) || !isCount(c.coins) || !isCount(c.renown)) return 'bad commission';
  }
  for (const m of v.merchant) if (!isObj(m) || typeof m.item !== 'string' || !isCount(m.price) || !Number.isInteger(m.left)) return 'bad merchant stock';
  const g = s.garden;
  if (!isObj(g) || !Array.isArray(g.plots) || !Number.isInteger(g.rng)) return 'bad garden';
  for (const p of g.plots) if (!isObj(p) || !isCount(p.ms) || (p.seed !== null && typeof p.seed !== 'string')) return 'bad garden plot';
  if (!isObj(s.achievements) || !isObj(s.achievements.done)) return 'bad achievements';
  if (s.version < 6) return null;
  const t = s.taming;
  if (!isObj(t) || !isObj(t.encounters) || !isObj(t.traps) || !Array.isArray(t.results) || !Number.isInteger(t.rng)) return 'bad taming';
  for (const e of Object.values(t.encounters)) {
    if (!isObj(e) || typeof e.archetype !== 'string' || typeof e.quality !== 'string' || (e.msLeft !== null && !isCount(e.msLeft))) return 'bad encounter';
  }
  for (const [zone, tr] of Object.entries(t.traps)) {
    if (!isObj(tr) || typeof tr.trap !== 'string' || !isCount(tr.msLeft) || !Number.isFinite(tr.chance) || !Number.isInteger(tr.rng)) return 'bad trap';
    if (!t.encounters[zone]) return 'trap without an encounter';
  }
  if (t.lure !== null && !(isObj(t.lure) && isCount(t.lure.msLeft) && Number.isInteger(t.lure.bands))) return 'bad lure';
  if (!isObj(s.treasure) || !isObj(s.treasure.progress) || !Number.isInteger(s.treasure.rng)) return 'bad treasure';
  for (const v of Object.values(s.treasure.progress)) if (!isCount(v)) return 'bad dig progress';
  if (!isObj(s.nest) || !Array.isArray(s.nest.slots) || !Number.isInteger(s.nest.rng)) return 'bad nest';
  for (const e of s.nest.slots) {
    if (e !== null && !(isObj(e) && typeof e.archetype === 'string' && typeof e.quality === 'string' && isCount(e.msLeft))) return 'bad nest egg';
  }
  if (s.version < 7) return null;
  for (const pet of Object.values(p.list)) {
    if (!Number.isInteger(pet.rng) || !Array.isArray(pet.talents) || !Array.isArray(pet.gifts)) return 'bad pet talents';
    if (pet.offer != null && !(Array.isArray(pet.offer) && pet.offer.every((t) => typeof t === 'string'))) return 'bad talent offer';
  }
  if (!isObj(s.crafting.assists)) return 'bad assists';
  for (const petId of Object.values(s.crafting.assists)) if (!p.list[petId]) return 'assistant is missing';
  if (!isObj(s.bestiary)) return 'bad bestiary';
  if (s.version < 8) return null;
  const sa = s.sanctuary;
  if (!isObj(sa) || !Number.isInteger(sa.project) || sa.project < 0 || !Number.isInteger(sa.stage) || sa.stage < 0) return 'bad sanctuary';
  if (!isObj(sa.delivered) || !isCount(sa.coins) || !Array.isArray(sa.done) || !Array.isArray(sa.scenes)) return 'bad sanctuary';
  for (const v of Object.values(sa.delivered)) if (!isCount(v)) return 'bad sanctuary delivery';
  if (!isObj(s.story) || !isObj(s.story.got) || !isObj(s.story.seen)) return 'bad story';
  const el = s.elders;
  if (!isObj(el) || !Array.isArray(el.list) || !Array.isArray(el.eggs) || !Number.isInteger(el.rng)) return 'bad elders';
  for (const e of el.list) if (!isObj(e) || typeof e.archetype !== 'string' || typeof e.name !== 'string') return 'bad elder';
  for (const e of el.eggs) if (!isObj(e) || typeof e.archetype !== 'string' || typeof e.quality !== 'string') return 'bad heir egg';
  if (!isCount(t.mythicMs)) return 'bad mythic timer';
  return null;
}
