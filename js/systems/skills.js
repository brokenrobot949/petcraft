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

// Adds XP and levels up as many times as it covers. XP past the max level is kept: it earns
// Mastery stars (each one costs the next level's worth of XP, as if the levels went on).
export function addXp(state, ctx, skillId, amount) {
  const s = state.skills[skillId] || (state.skills[skillId] = { level: 1, xp: 0 });
  const balance = ctx.data.balance;
  const maxed = s.level >= balance.skills.maxLevel;
  const before = maxed ? starsFor(s.xp, balance) : 0;
  s.xp += amount;
  while (s.level < balance.skills.maxLevel) {
    const need = xpToNext(s.level, balance);
    if (s.xp < need) break;
    s.xp -= need;
    s.level += 1;
    ctx.emit?.({ type: 'levelUp', skill: skillId, level: s.level });
  }
  if (s.level < balance.skills.maxLevel) return;
  const after = starsFor(s.xp, balance);
  if (after > before) ctx.emit?.({ type: 'masteryStar', skill: skillId, stars: after });
}

// ---- Mastery (docs/design.md "Skills and progression") ----

// Stars covered by `xp` banked past the max level, and the XP into the next star.
// XP banked past the max level that each star count needs in total: cum[k] = XP for k stars.
// Built once per curve (a maxed player checks stars on every action, so this must be cheap).
const starCache = new WeakMap();
function starThresholds(balance) {
  const sk = balance.skills;
  const c = sk.xpCurve;
  const hit = starCache.get(sk);
  if (hit && hit.a === c.a && hit.exp === c.exp && hit.b === c.b && hit.maxLevel === sk.maxLevel && hit.max === sk.mastery.maxStars) return hit.cum;
  const cum = [0];
  for (let k = 0; k < sk.mastery.maxStars; k++) cum.push(cum[k] + xpToNext(sk.maxLevel + k, balance));
  starCache.set(sk, { a: c.a, exp: c.exp, b: c.b, maxLevel: sk.maxLevel, max: sk.mastery.maxStars, cum });
  return cum;
}

function starsAndRest(xp, balance) {
  const cum = starThresholds(balance);
  let stars = 0;
  while (stars < cum.length - 1 && xp >= cum[stars + 1]) stars += 1;
  return { stars, left: xp - cum[stars] };
}

function starsFor(xp, balance) {
  return starsAndRest(xp, balance).stars;
}

export function masteryStars(state, data, skillId) {
  const s = state.skills[skillId];
  return s && s.level >= data.balance.skills.maxLevel ? starsFor(s.xp, data.balance) : 0;
}

// Extra player speed in this skill from its Mastery stars (a fraction).
export function masterySpeed(state, data, skillId) {
  return masteryStars(state, data, skillId) * data.balance.skills.mastery.speedPerStar;
}

// { stars, max, xp (into the next star), next (XP that star costs; 0 when all are earned), speed }.
// Before the max level there are no stars yet and xp / next are 0.
export function masteryProgress(state, data, skillId) {
  const b = data.balance;
  const max = b.skills.mastery.maxStars;
  const s = state.skills[skillId];
  if (!s || s.level < b.skills.maxLevel) return { stars: 0, max, xp: 0, next: 0, speed: 0 };
  const { stars, left } = starsAndRest(s.xp, b);
  const next = stars >= max ? 0 : xpToNext(b.skills.maxLevel + stars, b);
  return { stars, max, xp: stars >= max ? 0 : left, next, speed: stars * b.skills.mastery.speedPerStar };
}
