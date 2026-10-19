// Pet numbers derived from a pet's level, quality, archetype and Bond (docs/design.md "Pets").
// Pure read-only helpers shared by the harvest and pets systems and the UI. Nothing here changes
// state, and every number comes from data.balance.pets.
export const HOUR_MS = 3600 * 1000;

export function archetypeOf(data, archetypeId) {
  return data.pets.archetypes.find((a) => a.id === archetypeId) || null;
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
  return b.energy.max * (1 + b.stamina.maxPerLevel * grown(data, pet));
}

// Energy used per hour of work.
export function petDrainPerHour(data, pet) {
  const b = data.balance.pets;
  return b.energy.drainPerHour * Math.max(0, 1 - b.stamina.drainCutPerLevel * grown(data, pet));
}

// Energy regained per hour while resting (or idle). Stabled pets rest faster.
export function petRestPerHour(state, data, pet, { stabled = false } = {}) {
  const e = data.balance.pets.energy;
  const stableTier = state.buildings.stable?.tier ?? 1;
  const rate = e.restPerHour * (1 + e.stableRestBonusPerTier * (stableTier - 1));
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
  return speed;
}

// Extra rare-find chance (added to the base) from the pet's Luck.
export function petRareBonus(data, pet) {
  return data.balance.pets.luck.rarePerLevel * grown(data, pet);
}

// Sprite role for the pet's current form (data/sprites.json).
export function petRole(pet) {
  return pet.form === 'hatchling' || !pet.branch ? `pet.${pet.archetype}.hatchling` : `pet.${pet.archetype}.${pet.branch}.${pet.form}`;
}
