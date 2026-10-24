// Registry of game systems. Each system module exports:
//   id        - short name
//   init      - optional (state, ctx) => void: fills defaults from data; runs on every load
//   advance   - optional (state, ms, ctx) => void: moves the system forward by ms of game time
//   nextBoundaryMs - optional (state, ctx) => ms until a change other systems must see on time
//   afterCommand - optional (state, ctx) => void: runs after every command (achievement checks)
//   commands  - optional { 'type': (state, payload, ctx) => void } handlers the UI can dispatch
// System code is deterministic: no Date.now(), no Math.random() (use core/rng.js), no DOM.
// Time arrives as arguments; content and numbers come from ctx.data (the data/*.json files).
// Systems advance in this order; buffs come last so a buff counts for the whole span it ends in.
// See docs/architecture.md for the state schema, events and selectors.
import * as meta from './meta.js';
import * as settings from './settings.js';
import * as skills from './skills.js';
import * as bag from './bag.js';
import * as buildings from './buildings.js';
import * as tools from './tools.js';
import * as harvest from './harvest.js';
import * as pets from './pets.js';
import * as crafting from './crafting.js';
import * as buffs from './buffs.js';
import * as renown from './renown.js';
import * as village from './village.js';
import * as garden from './garden.js';
import * as achievements from './achievements.js';
import * as dev from './dev.js';

// Achievements come after everything they watch. renown and village have no advance().
export const SYSTEMS = [meta, settings, skills, bag, buildings, tools, harvest, pets, crafting, garden, buffs, renown, village, achievements, dev];
