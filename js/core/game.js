// The game object owns the state. The UI reads it with getState() and changes it only through
// dispatch(type, payload). Every change notifies subscribers so screens can redraw.
// Events that systems emit (a harvest, a level up) go to onEvents listeners during live play
// and into the returned summary during catch-up (docs/architecture.md "Events").
import { SYSTEMS } from '../systems/index.js';
import { advance, catchUp } from './tick.js';
import { createReport } from './report.js';

const COMMANDS = {};
for (const sys of SYSTEMS) {
  for (const [type, fn] of Object.entries(sys.commands || {})) {
    if (COMMANDS[type]) throw new Error(`command ${type} registered twice`);
    COMMANDS[type] = fn;
  }
}

// Fill per-skill / per-tool defaults from data. Safe to run on any loaded save.
export function initState(state, ctx) {
  for (const sys of SYSTEMS) if (sys.init) sys.init(state, ctx);
  return state;
}

export function createGame(data, initialState) {
  const ctx = { data, emit: null };
  let state = initState(initialState, ctx);
  const listeners = new Set();
  const eventListeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));

  // Runs fn with emit collecting events, then hands them to the event listeners.
  function withLiveEvents(fn) {
    const events = [];
    ctx.emit = (e) => events.push(e);
    try {
      fn();
    } finally {
      ctx.emit = null;
    }
    notify();
    if (events.length) eventListeners.forEach((l) => l(events));
  }

  return {
    data,
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onEvents(fn) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    dispatch(type, payload = {}) {
      const handler = COMMANDS[type];
      if (!handler) throw new Error(`unknown command ${type}`);
      withLiveEvents(() => handler(state, payload, ctx));
    },
    advance(ms) {
      withLiveEvents(() => advance(state, ms, ctx));
    },
    // Long spans (offline time, a phone that slept): returns the "While you were away" summary.
    catchUp(ms) {
      const report = createReport(ms);
      ctx.emit = report.add;
      try {
        catchUp(state, ms, ctx);
      } finally {
        ctx.emit = null;
      }
      notify();
      return report.summary;
    },
    // Used by save import and test-mode reset: swap in a whole validated state.
    replaceState(next) {
      state = initState(next, ctx);
      notify();
    },
  };
}
