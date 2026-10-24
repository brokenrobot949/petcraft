// Achievements (docs/design.md "Achievements"): one-time milestones from data/achievements.json
// that give Renown XP and sometimes a title the player can wear. Conditions are checked after every
// command and at the end of every advance, so live play and offline catch-up earn them alike.
// stats.found remembers every item ever held (collection achievements).
import { addRenownXp } from './renown.js';
import { parseKey } from './bag.js';
import { zoneUnlocked } from './harvest.js';
import { petHearts } from './petstats.js';

export const id = 'achievements';

export function init(state, ctx) {
  const st = state.stats;
  if (!st.found) st.found = {};
  for (const key of Object.keys(state.bag)) st.found[parseKey(key).id] = true;
  for (const t of Object.values(state.tools)) if (t?.item) st.found[t.item] = true;
  if (!st.quality) st.quality = { fine: 0, masterwork: 0 };
  settle(state, { ...ctx, emit: null }); // a migrated save gets what it already earned, quietly
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const progress = (have, need) => ({ have: Math.min(have, need), need });

// { have, need } toward an achievement's condition ("when" in achievements.json).
export function conditionProgress(state, data, w) {
  const skills = data.skills.skills;
  const lvl = (id) => state.skills[id]?.level || 1;
  const pets = Object.values(state.pets.list);
  const toolTier = (kind) => data.items.items[state.tools[kind]?.item]?.tier || 0;
  switch (w.kind) {
    case 'skillLevel': return progress(lvl(w.skill), w.level);
    case 'anySkillLevel': return progress(Math.max(...skills.map((s) => lvl(s.id))), w.level);
    case 'allSkillsLevel': {
      const list = skills.filter((s) => (w.type ? s.type === w.type : s.type !== 'special'));
      return progress(list.filter((s) => lvl(s.id) >= w.level).length, list.length);
    }
    case 'actions': return progress(w.skill ? state.stats.actions[w.skill] || 0 : sum(state.stats.actions), w.n);
    case 'crafts': return progress(w.recipe ? state.stats.crafts[w.recipe] || 0 : sum(state.stats.crafts), w.n);
    case 'quality': return progress(state.stats.quality?.[w.quality] || 0, w.n || 1);
    case 'buildingTier': {
      const tiers = w.building ? [state.buildings[w.building]?.tier || 0] : Object.values(state.buildings).map((b) => b.tier);
      return progress(Math.max(0, ...tiers), w.tier);
    }
    case 'allBuildingsTier': {
      const list = data.buildings.buildings;
      return progress(list.filter((b) => (state.buildings[b.id]?.tier || 0) >= w.tier).length, list.length);
    }
    case 'renown': return progress(state.renown.rank, w.rank);
    case 'zone': return progress(zoneUnlocked(state, data, w.zone) ? 1 : 0, 1);
    case 'pets': return progress(pets.length, w.n);
    case 'tamed': return progress(state.stats.tamed || 0, w.n);
    case 'digs': return progress(state.stats.digs || 0, w.n);
    case 'hatched': return progress(state.stats.hatched || 0, w.n);
    case 'petLevel': return progress(Math.max(0, ...pets.map((p) => p.level)), w.level);
    case 'petHearts': return progress(Math.max(0, ...pets.map((p) => petHearts(data, p).hearts)), w.hearts);
    case 'toolTier': {
      const kinds = w.tool ? [w.tool] : data.tools.kinds.map((k) => k.id);
      return progress(Math.max(0, ...kinds.map(toolTier)), w.tier);
    }
    case 'allToolsTier': {
      const kinds = data.tools.kinds;
      return progress(kinds.filter((k) => toolTier(k.id) >= w.tier).length, kinds.length);
    }
    case 'coinsEarned': return progress(state.stats.coinsEarned || 0, w.n);
    case 'sold': return progress(state.stats.sold || 0, w.n);
    case 'commissions': return progress(state.stats.commissions || 0, w.n);
    case 'greats': return progress(state.stats.greats || 0, w.n);
    case 'garden': return progress(state.stats.garden || 0, w.n);
    case 'found': return progress(Object.keys(state.stats.found || {}).length, w.n);
    case 'foundItem': return progress(state.stats.found?.[w.item] ? 1 : 0, 1);
    default: return { have: 0, need: 1 };
  }
}

export function achievementDef(data, achId) {
  return data.achievements.achievements.find((a) => a.id === achId) || null;
}

function settle(state, ctx) {
  const done = state.achievements.done;
  for (const a of ctx.data.achievements.achievements) {
    if (done[a.id]) continue;
    const p = conditionProgress(state, ctx.data, a.when);
    if (p.have < p.need) continue;
    done[a.id] = true;
    ctx.emit?.({ type: 'achievement', id: a.id, renown: a.renown || 0 });
    addRenownXp(state, ctx, a.renown || 0, 'achievement');
  }
}

export function advance(state, _ms, ctx) {
  settle(state, ctx);
}

export function afterCommand(state, ctx) {
  settle(state, ctx);
}

// ---- selectors ----

// [{ ...def, done, progress: { have, need } }] in data order.
export function achievementList(state, data) {
  return data.achievements.achievements.map((a) => ({ ...a, done: !!state.achievements.done[a.id], progress: conditionProgress(state, data, a.when) }));
}

// The title the player wears ('' for none): an earned achievement's title.
export function wornTitle(state, data) {
  const id = state.achievements.title;
  return (id && state.achievements.done[id] && achievementDef(data, id)?.title) || '';
}

export const commands = {
  // id: an earned achievement with a title, or null to wear none.
  'achievements/setTitle': (state, { id }, ctx) => {
    if (id == null) {
      state.achievements.title = null;
      return;
    }
    const a = achievementDef(ctx.data, id);
    if (!a?.title) throw new Error("That achievement doesn't give a title.");
    if (!state.achievements.done[id]) throw new Error('Earn it first!');
    state.achievements.title = id;
  },
};
