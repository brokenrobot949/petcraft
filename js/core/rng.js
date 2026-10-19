// Seeded random numbers (mulberry32). The generator's whole state is one uint32 kept in the save
// (state.rng), so any run can be replayed exactly. Systems must use this, never Math.random().

export function newSeed() {
  // Only used once, when a brand-new save is created.
  return (Math.random() * 0x100000000) >>> 0;
}

// Returns a float in [0, 1) and advances state.rng.
export function random(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}

// Integer in [min, max], inclusive.
export function randomInt(state, min, max) {
  return min + Math.floor(random(state) * (max - min + 1));
}

// True with the given probability (0..1).
export function chance(state, p) {
  return random(state) < p;
}
