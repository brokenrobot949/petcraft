// Mastery stars (shown once a skill is at its max level). Read-only helpers for the screens.
import { masteryProgress } from '../systems/skills.js';

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

// { text, frac } for a skill at max level, or null before that.
// frac is the progress toward the next star (1 when all stars are earned).
export function masteryInfo(state, data, skillId) {
  const s = state.skills[skillId];
  if (!s || s.level < data.balance.skills.maxLevel) return null;
  const m = masteryProgress(state, data, skillId);
  const done = m.next <= 0;
  const text = done
    ? `Mastery: all ${m.max} stars earned, +${pct(m.speed)} speed`
    : `Mastery ${m.stars} / ${m.max} stars, +${pct(m.speed)} speed`;
  return { text, frac: done ? 1 : Math.min(1, m.xp / m.next), done, stars: m.stars, max: m.max };
}
