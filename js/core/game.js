// The game object owns the state. The UI reads it with getState() and changes it only through
// dispatch(type, payload). Every change notifies subscribers so screens can redraw.
import { SYSTEMS } from '../systems/index.js';
import { advance, catchUp } from './tick.js';

const COMMANDS = {};
for (const sys of SYSTEMS) {
  for (const [type, fn] of Object.entries(sys.commands || {})) {
    if (COMMANDS[type]) throw new Error(`command ${type} registered twice`);
    COMMANDS[type] = fn;
  }
}

export function createGame(data, initialState) {
  let state = initialState;
  const ctx = { data };
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));

  return {
    data,
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispatch(type, payload = {}) {
      const handler = COMMANDS[type];
      if (!handler) throw new Error(`unknown command ${type}`);
      handler(state, payload, ctx);
      notify();
    },
    advance(ms) {
      advance(state, ms, ctx);
      notify();
    },
    catchUp(ms) {
      catchUp(state, ms, ctx);
      notify();
    },
    // Used only by save import: swap in a whole validated state.
    replaceState(next) {
      state = next;
      notify();
    },
  };
}
