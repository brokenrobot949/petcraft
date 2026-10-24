// Renown: the account level (docs/design.md "Renown"). state.renown = { rank, xp } where xp is the
// progress into the current rank, like a skill. Renown XP comes from commissions, achievements,
// first crafts of a recipe and building upgrades; every source calls addRenownXp(). Ranks open
// zones and buildings (their own unlock.renown in zones.json / buildings.json) and give a title
// (data/renown.json).
export const id = 'renown';

// Settles saves whose xp covers one or more ranks (Phase 5 saves kept a running total at rank 1).
export function init(state, ctx) {
  settle(state, ctx.data.balance, null);
}

// XP needed to go from `rank` to rank + 1 (balance.renown.xpCurve: a x R^exp + b).
export function xpToNextRank(rank, balance) {
  const c = balance.renown.xpCurve;
  return Math.round(c.a * Math.pow(rank, c.exp) + c.b);
}

function settle(state, balance, emit) {
  const r = state.renown;
  while (r.rank < balance.renown.maxRank) {
    const need = xpToNextRank(r.rank, balance);
    if (r.xp < need) break;
    r.xp -= need;
    r.rank += 1;
    emit?.({ type: 'rankUp', rank: r.rank });
  }
}

// source: 'commission' | 'great' | 'achievement' | 'building' | 'firstCraft' | 'dev' (for the summary).
export function addRenownXp(state, ctx, amount, source) {
  if (!(amount > 0)) return;
  state.renown.xp += amount;
  ctx.emit?.({ type: 'renownXp', amount, source });
  settle(state, ctx.data.balance, ctx.emit);
}

// ---- selectors ----

export function rankDef(data, rank) {
  return data.renown.ranks.find((r) => r.rank === rank) || null;
}

// The title for a rank: the band it falls in (data/renown.json "titles").
export function rankTitle(data, rank) {
  let title = '';
  for (const t of data.renown.titles) if (rank >= t.from) title = t.name;
  return title;
}

// Player-readable lines for what opens at a rank: zones, buildings, then renown.json's own extras.
export function unlocksAt(data, rank) {
  const out = [];
  for (const z of data.zones.zones) if (z.unlock?.renown === rank && rank > 1) out.push(z.name);
  for (const b of data.buildings.buildings) if (b.startTier === 0 && b.unlock?.renown === rank) out.push(`Build the ${b.name}`);
  for (const line of rankDef(data, rank)?.unlocks || []) out.push(line);
  return out;
}

// { rank, title, xp, next, max, nextRank, nextUnlocks: [string], nextUnlockRank }
// nextUnlocks / nextUnlockRank: the next rank above this one that opens something.
export function rankInfo(state, data) {
  const { rank, xp } = state.renown;
  const max = rank >= data.balance.renown.maxRank;
  let nextUnlockRank = null;
  let nextUnlocks = [];
  for (let r = rank + 1; r <= data.balance.renown.maxRank; r++) {
    const u = unlocksAt(data, r);
    if (u.length) {
      nextUnlockRank = r;
      nextUnlocks = u;
      break;
    }
  }
  return { rank, title: rankTitle(data, rank), xp, next: max ? 0 : xpToNextRank(rank, data.balance), max, nextRank: max ? null : rank + 1, nextUnlocks, nextUnlockRank };
}
