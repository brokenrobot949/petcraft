// The Bestiary (docs/design.md "Long tail"): 20 archetype forms (4 hatchlings, 8 juveniles, 8 adults)
// and 4 mythics, each with five quality stars. A star is earned the first time the player has a
// pet of that form at that quality (hatched, caught or evolved), and is never lost.
// state.bestiary = { entryId: { qualityId: true } } (docs/architecture.md "Phase 8").
// Entry ids: '<archetype>.hatchling', '<archetype>.<branch>.<form>', 'mythic.<archetype>'.
import { archetypeOf } from './petstats.js';

export const id = 'bestiary';

export function init(state, ctx) {
  if (!state.bestiary) state.bestiary = {};
  const quiet = { ...ctx, emit: null };
  for (const pet of Object.values(state.pets.list)) recordPet(state, quiet, pet);
}

export function entryIdOf(pet) {
  if (pet.form === 'mythic') return `mythic.${pet.archetype}`;
  return pet.form === 'hatchling' || !pet.branch ? `${pet.archetype}.hatchling` : `${pet.archetype}.${pet.branch}.${pet.form}`;
}

// Marks the pet's form and quality as seen. Emits { type: 'bestiary', entry, quality } for a new star.
export function recordPet(state, ctx, pet) {
  if (!archetypeOf(ctx.data, pet.archetype)) return;
  const entry = entryIdOf(pet);
  const stars = state.bestiary[entry] || (state.bestiary[entry] = {});
  if (stars[pet.quality]) return;
  stars[pet.quality] = true;
  ctx.emit?.({ type: 'bestiary', entry, quality: pet.quality });
}

// ---- selectors ----

// Every entry in display order (each archetype's hatchling, then its branches' juvenile and adult,
// then the mythics): [{ id, archetype, branch, form, species, desc, role, stars: { quality: bool },
// count, seen }]. role is the sprite role (data/sprites.json) for its picture.
export function bestiaryList(state, data) {
  const quals = data.pets.qualities.map((q) => q.id);
  const make = (id, archetype, branch, form, species, desc, role) => {
    const got = state.bestiary[id] || {};
    const stars = Object.fromEntries(quals.map((q) => [q, !!got[q]]));
    const count = quals.filter((q) => got[q]).length;
    return { id, archetype, branch, form, species, desc, role, stars, count, seen: count > 0 };
  };
  const list = [];
  for (const a of data.pets.archetypes) {
    list.push(make(`${a.id}.hatchling`, a.id, null, 'hatchling', a.species, a.bestiary || a.blurb, `pet.${a.id}.hatchling`));
    for (const br of a.branches) {
      for (const form of ['juvenile', 'adult']) {
        list.push(make(`${a.id}.${br.id}.${form}`, a.id, br.id, form, br[form]?.species || br.name, br[form]?.desc || '', `pet.${a.id}.${br.id}.${form}`));
      }
    }
  }
  for (const m of data.pets.mythics || []) {
    list.push(make(`mythic.${m.archetype}`, m.archetype, null, 'mythic', m.species, m.desc, `mythic.${m.archetype}`));
  }
  return list;
}

// Stars collected out of the total (entries x qualities).
export function bestiaryStars(state, data) {
  const list = bestiaryList(state, data);
  return { have: list.reduce((n, e) => n + e.count, 0), max: list.length * data.pets.qualities.length, seen: list.filter((e) => e.seen).length, entries: list.length };
}
