// Registry of game systems. Each system module exports:
//   id        - short name
//   init      - optional (state, ctx) => void: fills defaults from data; runs on every load
//   advance   - optional (state, ms, ctx) => void: moves the system forward by ms of game time
//   commands  - optional { 'type': (state, payload, ctx) => void } handlers the UI can dispatch
// System code is deterministic: no Date.now(), no Math.random() (use core/rng.js), no DOM.
// Time arrives as arguments; content and numbers come from ctx.data (the data/*.json files).
// See docs/architecture.md for the state schema, events and selectors.
import * as meta from './meta.js';
import * as settings from './settings.js';
import * as skills from './skills.js';
import * as bag from './bag.js';
import * as harvest from './harvest.js';
import * as pets from './pets.js';
import * as dev from './dev.js';

export const SYSTEMS = [meta, settings, skills, bag, harvest, pets, dev];
