// The Elder Grove (docs/design.md "Legacy loop"): a pet at the top level with full Bond (an adult
// or a mythic) can retire. It leaves the roster but stays on the homestead as an elder, with a
// record like a Hall of Champions, and leaves an heir egg (same archetype, quality near its own)
// that inherits one of its talents as an extra Heirloom talent. Every elder gives all pets a
// legacy bonus: +speed in its branch's skill (data/pets.json branch `legacy`), with shrinking
// returns for elders of the same branch; mythic elders boost every harvest skill.
// state.elders = { open, list: [Elder], eggs: [HeirEgg], rng } (docs/architecture.md "Phase 9").
import { chance } from '../core/rng.js';
import { archetypeOf, branchDef, petHearts, petSpecies, petRole, talentDef } from './petstats.js';
import { rollQuality } from './taming.js';

export const id = 'elders';

const DAY_MS = 86400000;

export function init(state, ctx) {
  if (state.stats.retired == null) state.stats.retired = 0;
  const el = state.elders;
  el.eggs = el.eggs.filter((e) => archetypeOf(ctx.data, e.archetype));
  for (const e of el.eggs) if (e.heirloom && !talentDef(ctx.data, e.heirloom)) e.heirloom = null;
  checkOpen(state, { ...ctx, emit: null });
}

// The Grove appears the first time any pet reaches the opening level, and stays.
function checkOpen(state, ctx) {
  if (state.elders.open) return;
  const lvl = ctx.data.balance.elders.openLevel;
  if (!Object.values(state.pets.list).some((p) => p.level >= lvl) && !state.elders.list.length) return;
  state.elders.open = true;
  ctx.emit?.({ type: 'groveOpened' });
}

export function advance(state, _ms, ctx) {
  checkOpen(state, ctx);
}

export function afterCommand(state, ctx) {
  checkOpen(state, ctx);
}

// ---- legacy bonus ----

// [Effect] of kind 'speed' from every elder (shared by all pets). Cached until the elders change.
const legacyCache = new WeakMap();
export function legacyEffects(state, data) {
  const list = state.elders.list;
  const sig = list.length;
  const hit = legacyCache.get(list);
  if (hit && hit.sig === sig && hit.data === data) return hit.effects;
  const b = data.balance.elders;
  const effects = [];
  const perBranch = {};
  const harvestSkills = data.skills.skills.filter((s) => s.type === 'harvest').map((s) => s.id);
  for (const e of list) {
    if (e.form === 'mythic') {
      effects.push({ kind: 'speed', skills: harvestSkills, value: b.mythicBonus });
      continue;
    }
    const skills = branchDef(data, e.archetype, e.branch)?.legacy?.skills;
    if (!skills?.length) continue;
    const key = `${e.archetype}.${e.branch}`;
    const i = perBranch[key] = (perBranch[key] ?? -1) + 1;
    effects.push({ kind: 'speed', skills, value: b.branchBonus * b.stack[Math.min(i, b.stack.length - 1)] });
  }
  legacyCache.set(list, { sig, data, effects });
  return effects;
}

// Sum of the legacy effects of one kind for a skill.
export function legacyValue(state, data, kind, skillId = null) {
  let v = 0;
  for (const e of legacyEffects(state, data)) {
    if (e.kind === kind && (!e.skills || (skillId && e.skills.includes(skillId)))) v += e.value;
  }
  return v;
}

// Player-readable totals per skill: ['+3.5% Chopping speed for every pet'].
export function legacyLines(state, data) {
  return data.skills.skills
    .filter((s) => s.type === 'harvest')
    .map((s) => ({ s, v: legacyValue(state, data, 'speed', s.id) }))
    .filter((x) => x.v > 0)
    .map(({ s, v }) => `+${Math.round(v * 1000) / 10}% ${s.name} speed for every pet`);
}

// ---- selectors ----

export function groveOpen(state) {
  return !!state.elders.open;
}

// Elders, oldest first, with their sprite role and the bonus each one gives: [{ ...elder, role, bonus }].
export function elderList(state, data) {
  const b = data.balance.elders;
  const perBranch = {};
  return state.elders.list.map((e) => {
    let bonus = '';
    if (e.form === 'mythic') {
      bonus = `+${Math.round(b.mythicBonus * 1000) / 10}% speed in every harvesting skill for all pets`;
    } else {
      const skills = branchDef(data, e.archetype, e.branch)?.legacy?.skills || [];
      const key = `${e.archetype}.${e.branch}`;
      const i = perBranch[key] = (perBranch[key] ?? -1) + 1;
      const v = b.branchBonus * b.stack[Math.min(i, b.stack.length - 1)];
      const names = skills.map((s) => data.skills.skills.find((x) => x.id === s)?.name || s).join(' and ');
      if (names) bonus = `+${Math.round(v * 1000) / 10}% ${names} speed for all pets`;
    }
    return { ...e, role: petRole(e), bonus };
  });
}

// Heir eggs waiting for the Nest: [{ index, archetype, quality, heirloom, elder (its name) }].
export function heirEggList(state) {
  return state.elders.eggs.map((e, index) => ({
    index, archetype: e.archetype, quality: e.quality, heirloom: e.heirloom,
    elder: state.elders.list.find((x) => x.id === e.elder)?.name || '',
  }));
}

function qualityIds(data) {
  return data.pets.qualities.map((q) => q.id);
}

// Can this pet retire now? { can, reason, heirlooms: [talentId], match, floor }
// heirlooms: the talents its heir can inherit. match / floor: the heir egg's possible qualities.
export function retireInfo(state, data, petId) {
  const pet = state.pets.list[petId];
  const b = data.balance.elders;
  const ids = qualityIds(data);
  const qi = ids.indexOf(pet.quality);
  const out = {
    can: false, reason: '',
    heirlooms: [...new Set([...pet.talents, ...pet.gifts, ...(pet.heirloom ? [pet.heirloom] : [])])].filter((t) => talentDef(data, t)),
    match: pet.quality,
    floor: ids[Math.max(0, qi - b.heir.bandsBelow)],
  };
  if (pet.form !== 'adult' && pet.form !== 'mythic') out.reason = 'Only fully grown pets (adults and mythics) can retire.';
  else if (pet.level < b.retireLevel) out.reason = `Retires at level ${b.retireLevel}.`;
  else if (petHearts(data, pet).hearts < b.retireHearts) out.reason = `Needs Bond heart ${b.retireHearts} to retire.`;
  else if (Object.keys(state.pets.list).length <= 1) out.reason = `${pet.name} is your only pet. Keep them close for now!`;
  else out.can = true;
  return out;
}

// ---- changes ----

// The heir's quality: the parent's with matchChance, else a roll with a floor bandsBelow under it,
// never above the parent's (from the elders stream).
function heirQuality(state, data, quality) {
  const b = data.balance.elders.heir;
  const ids = qualityIds(data);
  const qi = Math.max(0, ids.indexOf(quality));
  const el = state.elders;
  if (chance(el, b.matchChance)) return ids[qi];
  const rolled = ids.indexOf(rollQuality(el, data, { min: ids[Math.max(0, qi - b.bandsBelow)] }));
  return ids[Math.min(qi, rolled)];
}

// Takes an heir egg out of the waiting list (the Nest places it). Returns it, or null.
export function takeHeirEgg(state, index) {
  const egg = state.elders.eggs[index];
  if (!egg) return null;
  state.elders.eggs.splice(index, 1);
  return egg;
}

export const commands = {
  // heirloom: one of the pet's talents for its heir (null only when it has none).
  'elders/retire': (state, { pet: petId, heirloom = null }, ctx) => {
    const { data } = ctx;
    const pet = state.pets.list[petId];
    if (!pet) throw new Error("That pet isn't here.");
    const info = retireInfo(state, data, petId);
    if (!info.can) throw new Error(info.reason);
    if (info.heirlooms.length && !info.heirlooms.includes(heirloom)) throw new Error('Choose the talent its heir will inherit.');
    const p = state.pets;
    const i = p.active.indexOf(petId);
    if (i >= 0) p.active[i] = null;
    for (const s of Object.keys(state.crafting.assists)) if (state.crafting.assists[s] === petId) delete state.crafting.assists[s];
    delete state.workers[petId];
    delete p.list[petId];
    const now = ctx.now || 0;
    const elder = {
      id: pet.id, name: pet.name, archetype: pet.archetype, form: pet.form, branch: pet.branch, quality: pet.quality,
      species: petSpecies(data, pet), level: pet.level, bornAt: pet.bornAt, retiredAt: now,
      days: pet.bornAt > 0 && now > pet.bornAt ? Math.floor((now - pet.bornAt) / DAY_MS) : 0,
      actions: Object.values(pet.actions || {}).reduce((a, n) => a + n, 0),
      talents: [...pet.talents], gifts: [...pet.gifts], heirloom: pet.heirloom || null,
    };
    state.elders.list.push(elder);
    const egg = { elder: pet.id, archetype: pet.archetype, quality: heirQuality(state, data, pet.quality), heirloom: info.heirlooms.length ? heirloom : null };
    state.elders.eggs.push(egg);
    state.stats.retired += 1;
    ctx.emit?.({ type: 'retired', pet: petId, name: pet.name, egg: { ...egg } });
  },
};
