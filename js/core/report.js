// Folds the events systems emit during offline catch-up into the "While you were away" summary:
// { ms, workers: { id: { actions, items: { id: n }, xp: { skill: n }, petXp } }, levelUps: { skill: level },
//   pets: { petId: { workMs, restMs, ate: { itemId: n }, level, hearts } },
//   stations: { stationId: { items: { key: n }, xp, skill } }, equipped: [bag key], buffsEnded: [itemId],
//   renown: { xp, rank (the new rank, or null) }, achievements: [id], garden: { itemId: n } }
// pets[id].level / .hearts are set only when the pet reached a new level / heart while away.
export function createReport(ms) {
  const summary = { ms, workers: {}, levelUps: {}, pets: {}, stations: {}, equipped: [], buffsEnded: [], renown: { xp: 0, rank: null }, achievements: [], garden: {} };
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
    } else if (e.type === 'craft') {
      const s = summary.stations[e.station] || (summary.stations[e.station] = { items: {}, xp: 0, skill: e.skill });
      s.items[e.item] = (s.items[e.item] || 0) + e.qty;
      s.xp += e.xp;
    } else if (e.type === 'toolEquipped') {
      summary.equipped.push(e.item);
    } else if (e.type === 'buffEnded') {
      summary.buffsEnded.push(e.item);
    } else if (e.type === 'renownXp') {
      summary.renown.xp += e.amount;
    } else if (e.type === 'rankUp') {
      summary.renown.rank = Math.max(summary.renown.rank || 0, e.rank);
    } else if (e.type === 'achievement') {
      summary.achievements.push(e.id);
    } else if (e.type === 'gardenHarvest') {
      summary.garden[e.item] = (summary.garden[e.item] || 0) + e.qty;
    }
  }
  return { summary, add };
}
