// Skill levels and XP. Each skill stores its level and the XP earned toward the next level, so
// retuning the XP curve never takes levels away from an existing save.
export const id = 'skills';

export function init(state, ctx) {
  for (const s of ctx.data.skills.skills) {
    if (!state.skills[s.id]) state.skills[s.id] = { level: 1, xp: 0 };
  }
}

// XP needed to go from `level` to level + 1 (balance.skills.xpCurve: a x L^exp + b).
export function xpToNext(level, balance) {
  const c = balance.skills.xpCurve;
  return Math.round(c.a * Math.pow(level, c.exp) + c.b);
}

export function skillLevel(state, skillId) {
  return state.skills[skillId]?.level ?? 1;
}

// { level, xp, next, max }: next is the XP needed for the next level (0 at max level).
export function skillProgress(state, data, skillId) {
  const s = state.skills[skillId] || { level: 1, xp: 0 };
  const maxLevel = data.balance.skills.maxLevel;
  const max = s.level >= maxLevel;
  return { level: s.level, xp: s.xp, next: max ? 0 : xpToNext(s.level, data.balance), max };
}

// Adds XP and levels up as many times as it covers. XP past the max level is kept (Mastery
// stars spend it in a later phase).
export function addXp(state, ctx, skillId, amount) {
  const s = state.skills[skillId] || (state.skills[skillId] = { level: 1, xp: 0 });
  const balance = ctx.data.balance;
  s.xp += amount;
  while (s.level < balance.skills.maxLevel) {
    const need = xpToNext(s.level, balance);
    if (s.xp < need) break;
    s.xp -= need;
    s.level += 1;
    ctx.emit?.({ type: 'levelUp', skill: skillId, level: s.level });
  }
}
