// Pet numbers derived from a pet's level, quality, archetype and Bond (docs/design.md "Pets").
// Pure read-only helpers shared by the harvest and pets systems and the UI. Nothing here changes
// state, and every number comes from data.balance.pets.
import { sanctuaryBonus } from './sanctuary.js';

export const HOUR_MS = 3600 * 1000;

const archCache = new WeakMap(); // archetypes by id, per data (looked up on every pet action)
export function archetypeOf(data, archetypeId) {
  let m = archCache.get(data.pets.archetypes);
  if (!m) {
    m = new Map();
    for (const a of data.pets.archetypes) if (!m.has(a.id)) m.set(a.id, a);
    archCache.set(data.pets.archetypes, m);
  }
  return m.get(archetypeId) || null;
}

export function isPet(state, workerId) {
  return workerId !== 'player' && !!state.pets?.list[workerId];
}

// Stage 1-3 from the form id ('hatchling', 'juvenile', 'adult').
export function petStage(data, pet) {
  return data.pets.forms.find((f) => f.id === pet.form)?.stage || 1;
}

// Highest level the pet's current stage allows; extra XP is banked until it evolves.
export function petLevelCap(data, pet) {
  const b = data.balance.pets;
  return Math.min(b.maxLevel, b.stageLevelCaps[petStage(data, pet) - 1] ?? b.maxLevel);
}

// XP to go from `level` to level + 1 (balance.pets.xpCurve: a x L^exp + b).
export function petXpToNext(level, balance) {
  const c = balance.pets.xpCurve;
  return Math.round(c.a * Math.pow(level, c.exp) + c.b);
}

// { level, xp, next, capped }: capped = at the stage cap (XP banks) or the max level.
export function petProgress(data, pet) {
  const cap = petLevelCap(data, pet);
  const capped = pet.level >= cap;
  return { level: pet.level, xp: pet.xp, next: capped ? 0 : petXpToNext(pet.level, data.balance), capped, cap };
}

// Hearts 0-5 from Bond XP, plus progress toward the next heart.
export function petHearts(data, pet) {
  const marks = data.balance.pets.bond.hearts;
  let hearts = 0;
  while (hearts < marks.length && pet.bond >= marks[hearts]) hearts++;
  const from = hearts ? marks[hearts - 1] : 0;
  const to = marks[hearts] ?? null;
  return { hearts, max: marks.length, bond: pet.bond, from, to };
}

function growthOf(data, pet) {
  return data.balance.pets.qualities[pet.quality]?.growth ?? 1;
}

// Level growth term: (level - 1) x quality growth.
function grown(data, pet) {
  return (pet.level - 1) * growthOf(data, pet);
}

export function petMaxEnergy(data, pet) {
  const b = data.balance.pets;
  return b.energy.max * (1 + b.stamina.maxPerLevel * grown(data, pet) + effectValue(data, pet, 'stamina'));
}

// Energy used per hour of work.
export function petDrainPerHour(data, pet) {
  const b = data.balance.pets;
  return b.energy.drainPerHour * Math.max(0, 1 - b.stamina.drainCutPerLevel * grown(data, pet) - effectValue(data, pet, 'drain'));
}

// Energy regained per hour while resting (or idle). Stabled pets rest faster.
export function petRestPerHour(state, data, pet, { stabled = false } = {}) {
  const e = data.balance.pets.energy;
  const stableTier = state.buildings.stable?.tier ?? 1;
  const rate = e.restPerHour * (1 + e.stableRestBonusPerTier * (stableTier - 1) + effectValue(data, pet, 'rest') + sanctuaryBonus(state, data, 'petRest'));
  return stabled ? rate * e.stabledRestMult : rate;
}

// Energy at or below which auto-feed kicks in.
export function petFeedThreshold(data, pet) {
  return petMaxEnergy(data, pet) * data.balance.pets.energy.autoFeedBelowFrac;
}

export function hasAffinity(data, pet, skillId) {
  return !!archetypeOf(data, pet.archetype)?.affinity.includes(skillId);
}

// Work speed multiplier for one skill (multiplies the action rate; 1 = the base action time).
export function petSpeed(data, pet, skillId) {
  const s = data.balance.pets.speed;
  let speed = s.base + s.perLevel * grown(data, pet);
  if (hasAffinity(data, pet, skillId)) speed *= 1 + s.affinityBonus;
  speed *= 1 + s.bondPerHeart * petHearts(data, pet).hearts;
  speed *= 1 + effectValue(data, pet, 'speed', skillId);
  return speed;
}

// Extra rare-find chance (added to the base) from the pet's Luck, branch and talents.
export function petRareBonus(data, pet, skillId = null) {
  return data.balance.pets.luck.rarePerLevel * grown(data, pet) + effectValue(data, pet, 'rare', skillId);
}

// Sprite role for the pet's current form (data/sprites.json).
export function petRole(pet) {
  if (pet.form === 'mythic') return `mythic.${pet.archetype}`;
  return pet.form === 'hatchling' || !pet.branch ? `pet.${pet.archetype}.hatchling` : `pet.${pet.archetype}.${pet.branch}.${pet.form}`;
}

// ---- evolution and talents (Phase 8) ----

export function branchDef(data, archetypeId, branchId) {
  return archetypeOf(data, archetypeId)?.branches.find((b) => b.id === branchId) || null;
}

// Species name of the pet's current form (hatchlings use the archetype's species).
export function petSpecies(data, pet) {
  if (pet.form === 'mythic') return mythicDef(data, pet.archetype)?.species || pet.archetype;
  const br = pet.form !== 'hatchling' && branchDef(data, pet.archetype, pet.branch);
  return (br && br[pet.form]?.species) || archetypeOf(data, pet.archetype)?.species || pet.archetype;
}

// The mythic of an archetype (pets.json mythics), or null.
export function mythicDef(data, archetypeId) {
  return (data.pets.mythics || []).find((m) => m.archetype === archetypeId) || null;
}

export function talentDef(data, talentId) {
  return data.talents?.talents[talentId] || null;
}

// The effect kinds a branch strength or talent can have (docs/architecture.md "Phase 8").
export const EFFECT_KINDS = ['speed', 'rare', 'extraItem', 'byproduct', 'maps', 'drain', 'stamina', 'rest', 'meal', 'bond', 'xp', 'track', 'garden', 'gift', 'dig'];

// Every effect the pet has: its branch strength (juvenile x1, adult x adultStrengthMult) or its
// mythic strength, its gift talents, its chosen talents and its heirloom talent (from an elder
// parent). Cached per pet object until its form or talents change.
const effectCache = new WeakMap();
export function petEffects(data, pet) {
  // Talent and gift lists only change by push or by being replaced, so their identity and length
  // (plus form, branch and heirloom) tell whether the cached list still holds. Checked on every action.
  const hit = effectCache.get(pet);
  if (hit && hit.data === data && hit.form === pet.form && hit.branch === pet.branch && hit.heirloom === pet.heirloom
    && hit.gifts === pet.gifts && hit.nGifts === pet.gifts?.length && hit.talents === pet.talents && hit.nTalents === pet.talents?.length) return hit.list;
  const list = [];
  const br = pet.form !== 'hatchling' && branchDef(data, pet.archetype, pet.branch);
  if (br) {
    const mult = pet.form === 'adult' ? data.balance.pets.evolve.adultStrengthMult : 1;
    for (const e of br.strength || []) list.push({ ...e, value: e.value * mult });
  }
  if (pet.form === 'mythic') list.push(...(mythicDef(data, pet.archetype)?.strength || []));
  const talents = [...(pet.gifts || []), ...(pet.talents || []), ...(pet.heirloom ? [pet.heirloom] : [])];
  for (const t of talents) list.push(...(talentDef(data, t)?.effects || []));
  effectCache.set(pet, {
    data, list, form: pet.form, branch: pet.branch, heirloom: pet.heirloom,
    gifts: pet.gifts, nGifts: pet.gifts?.length, talents: pet.talents, nTalents: pet.talents?.length,
  });
  return list;
}

// Sum of one effect kind for a skill (effects without `skills` count for every skill).
export function effectValue(data, pet, kind, skillId = null) {
  let v = 0;
  for (const e of petEffects(data, pet)) {
    if (e.kind === kind && (!e.skills || (skillId && e.skills.includes(skillId)))) v += e.value;
  }
  return v;
}

// The best value of an effect kind among some pets (track: active pets; garden: every pet).
export function bestEffect(data, pets, kind) {
  return pets.reduce((best, p) => Math.max(best, effectValue(data, p, kind)), 0);
}

// A short player-readable line for one effect: "+15% Chopping speed".
export function effectText(data, e) {
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const pts = (v) => `${Math.round(v * 1000) / 10} ${Math.abs(v * 100 - 1) < 1e-9 ? 'point' : 'points'}`;
  const names = (e.skills || []).map((s) => data.skills.skills.find((x) => x.id === s)?.name || s);
  const where = names.length ? names.join(' and ') : 'all harvesting';
  switch (e.kind) {
    case 'speed': return `+${pct(e.value)} ${names.length ? names.join(' and ') : 'work'} speed`;
    case 'rare': return `+${pts(e.value)} rare-find chance (${where})`;
    case 'extraItem': return `${pct(e.value)} chance of an extra item (${where})`;
    case 'byproduct': return `+${pct(e.value)} by-product chance (${where})`;
    case 'maps': return `+${pct(e.value)} treasure map chance`;
    case 'drain': return `-${pct(e.value)} energy used while working`;
    case 'stamina': return `+${pct(e.value)} max energy`;
    case 'rest': return `+${pct(e.value)} rest speed`;
    case 'meal': return `+${pct(e.value)} energy from food`;
    case 'bond': return `+${pct(e.value)} Bond gained`;
    case 'xp': return `+${pct(e.value)} pet XP`;
    case 'track': return `+${pts(e.value)} chance to find wild monsters while you track (when active)`;
    case 'garden': return `+${pct(e.value)} Garden harvests`;
    case 'gift': return `+${pct(e.value)} chance of bringing gifts`;
    case 'dig': return e.value ? `Can dig up treasure (+${pct(e.value)} dig speed)` : 'Can dig up treasure';
    default: return '';
  }
}

// Can this pet dig treasure (Scout branch)?
export function canDig(data, pet) {
  return petEffects(data, pet).some((e) => e.kind === 'dig');
}
