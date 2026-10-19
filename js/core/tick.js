// The one simulation entry point. Live play, offline catch-up and the balance simulator all
// advance the game through these two functions, so they always agree.
import { SYSTEMS } from '../systems/index.js';

// Advance every system by ms of game time.
export function advance(state, ms, ctx) {
  if (!(ms > 0)) return;
  for (const sys of SYSTEMS) if (sys.advance) sys.advance(state, ms, ctx);
}

// Advance a long span in fixed chunks (balance.offline.catchupStepSeconds) rather than
// action by action, so 16 hours stays fast on a phone.
export function catchUp(state, ms, ctx) {
  const step = ctx.data.balance.offline.catchupStepSeconds * 1000;
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(step, left);
    advance(state, chunk, ctx);
    left -= chunk;
  }
}
