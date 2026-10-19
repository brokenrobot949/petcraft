// Folds the events systems emit during offline catch-up into the "While you were away" summary:
// { ms, workers: { id: { actions, items: { id: n }, xp: { skill: n }, petXp } }, levelUps: { skill: level },
//   pets: { petId: { workMs, restMs, ate: { itemId: n }, level, hearts } } }
// pets[id].level / .hearts are set only when the pet reached a new level / heart while away.
export function createReport(ms) {
  const summary = { ms, workers: {}, levelUps: {}, pets: {} };
  const pet = (id) => summary.pets[id] || (summary.pets[id] = { workMs: 0, restMs: 0, ate: {}, level: null, hearts: null });
  function add(e) {
    if (e.type === 'harvest') {
      const w = summary.workers[e.worker] || (summary.workers[e.worker] = { actions: 0, items: {}, xp: {}, petXp: 0 });
      w.actions += 1;
      for (const [id, n] of Object.entries(e.items)) w.items[id] = (w.items[id] || 0) + n;
      if (e.xp > 0) w.xp[e.skill] = (w.xp[e.skill] || 0) + e.xp;
      if (e.petXp > 0) w.petXp += e.petXp;
    } else if (e.type === 'levelUp') {
      summary.levelUps[e.skill] = Math.max(summary.levelUps[e.skill] || 0, e.level);
    } else if (e.type === 'petTime') {
      const p = pet(e.pet);
      p.workMs += e.workMs;
      p.restMs += e.restMs;
    } else if (e.type === 'petAte') {
      const p = pet(e.pet);
      p.ate[e.item] = (p.ate[e.item] || 0) + 1;
    } else if (e.type === 'petLevelUp') {
      const p = pet(e.pet);
      p.level = Math.max(p.level || 0, e.level);
    } else if (e.type === 'petHeart') {
      const p = pet(e.pet);
      p.hearts = Math.max(p.hearts || 0, e.hearts);
    }
  }
  return { summary, add };
}
