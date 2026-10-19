// Registry of game systems. Each system module exports:
//   id        - short name
//   advance   - optional (state, ms, ctx) => void: moves the system forward by ms of game time
//   commands  - optional { 'type': (state, payload, ctx) => void } handlers the UI can dispatch
// System code is deterministic: no Date.now(), no Math.random() (use core/rng.js), no DOM.
// Time arrives as arguments; content and numbers come from ctx.data (the data/*.json files).
import * as meta from './meta.js';
import * as settings from './settings.js';

export const SYSTEMS = [meta, settings];
