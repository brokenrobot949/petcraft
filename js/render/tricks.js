// Trick animations (Phase 12): the pack's pets have only a few frames, so tricks are made in code by moving,
// squashing and turning the sprite. trickPose(trick, t, h) gives the pose at t (0..1) for a sprite of height h
// (sprite pixels) anchored at its feet: { x, y, rot, sx, sy }. The home scene plays known tricks on idle pets.
const TAU = Math.PI * 2;

export function trickPose(trick, t, h, liftPx) {
  const s = Math.sin(Math.PI * t);
  switch (trick) {
    case 'spin': // turns round (the sprite flips through its back) with a little lift
      return { x: 0, y: -liftPx * 0.6 * s, rot: 0, sx: Math.cos(TAU * t), sy: 1 };
    case 'hop': { // one big hop: crouch, fly, land
      const air = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.15) / 0.75))));
      const crouch = t < 0.15 ? Math.sin(Math.PI * t / 0.15) : t > 0.9 ? Math.sin(Math.PI * (t - 0.9) / 0.1) : 0;
      return { x: 0, y: -liftPx * 2 * air, rot: 0, sx: 1 + 0.15 * crouch, sy: 1 - 0.2 * crouch + 0.1 * air };
    }
    case 'bow': // dips low and comes back up
      return { x: 0, y: 0, rot: 0, sx: 1 + 0.12 * s, sy: 1 - 0.3 * s };
    case 'roll': { // one full roll about its middle, a step forward and back
      const a = TAU * t;
      return { x: -(h / 2) * Math.sin(a) + 2 * s, y: -(h / 2) + (h / 2) * Math.cos(a) - liftPx * 0.4 * s, rot: a, sx: 1, sy: 1 };
    }
    case 'dance': { // sways side to side with two little skips
      const w = Math.sin(2 * TAU * t);
      return { x: 2 * w, y: -liftPx * 0.5 * Math.abs(w), rot: 0.18 * w, sx: 1, sy: 1 };
    }
    default:
      return { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
  }
}
