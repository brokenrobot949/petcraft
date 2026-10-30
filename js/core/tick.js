// The one simulation entry point. Live play, offline catch-up and the balance simulator all
// advance the game through these two functions, so they always agree.
import { SYSTEMS } from '../systems/index.js';

const EPS = 1e-6;

// Advance every system by ms of game time. A system may export nextBoundaryMs(state, ctx): the
// time until something it owns changes another system (a buff running out, a crafted tool being
// equipped). The span is split there, so every system sees that change at the same moment
// whether time arrives in small live ticks or big offline chunks.
export function advance(state, ms, ctx) {
  let left = ms;
  while (left > EPS) {
    let t = left;
    for (const sys of SYSTEMS) {
      if (!sys.nextBoundaryMs) continue;
      const b = sys.nextBoundaryMs(state, ctx);
      if (b > EPS && b < t) t = b;
    }
    for (const sys of SYSTEMS) if (sys.advance) sys.advance(state, t, ctx);
    if (Number.isFinite(ctx.now)) ctx.now += t; // the game clock moves with the span (scrapbook dates)
    left -= t;
  }
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
