// Folds the events systems emit during offline catch-up into the "While you were away" summary:
// { ms, workers: { id: { actions, items: { id: n }, xp: { skill: n }, petXp } }, levelUps: { skill: level },
//   pets: { petId: { workMs, restMs, ate: { itemId: n }, level, hearts } },
//   stations: { stationId: { items: { key: n }, xp, skill } }, equipped: [bag key], buffsEnded: [itemId],
//   renown: { xp, rank (the new rank, or null) }, achievements: [id], garden: { itemId: n },
//   taming: { found: [{ zone, archetype }], results: [TrapResult], lureEnded }, treasure: { digs, coins, items: { key: n } },
//   nest: { ready: n }, bestiary: [{ entry, quality }], mastery: { skill: stars (the new total) }, story: [entryId] }
// pets[id] also has gifts: { itemId: n } (Heart 4 gifts), digs (Scout digs, also counted in treasure),
// talentReady (a talent pick came up) and favorite (its favorite dish, if found while away).
// Phase 13: trips ([{ zone, items }] day trips that ended) and wishes (wishes that came true).
// Tracking actions count in workers.player (actions, xp.taming).
// pets[id].level / .hearts are set only when the pet reached a new level / heart while away.
export function createReport(ms) {
  const summary = { ms, workers: {}, levelUps: {}, pets: {}, stations: {}, equipped: [], buffsEnded: [], renown: { xp: 0, rank: null }, achievements: [], garden: {},
    taming: { found: [], results: [], lureEnded: false }, treasure: { digs: 0, coins: 0, items: {} }, nest: { ready: 0 }, bestiary: [], mastery: {}, story: [] };
  const worker = (id) => summary.workers[id] || (summary.workers[id] = { actions: 0, items: {}, xp: {}, petXp: 0 });
  const pet = (id) => summary.pets[id] || (summary.pets[id] = { workMs: 0, restMs: 0, ate: {}, level: null, hearts: null, gifts: {}, digs: 0, talentReady: false, favorite: null, trips: [], wishes: 0 });
  function add(e) {
    if (e.type === 'harvest') {
      const w = worker(e.worker);
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
    } else if (e.type === 'tracked') {
      const w = worker('player');
      w.actions += 1;
      w.xp.taming = (w.xp.taming || 0) + e.xp;
    } else if (e.type === 'encounter') {
      summary.taming.found.push({ zone: e.zone, archetype: e.archetype, mythic: !!e.mythic });
    } else if (e.type === 'trapDone') {
      const { type, ...result } = e;
      summary.taming.results.push(result);
    } else if (e.type === 'lureEnded') {
      summary.taming.lureEnded = true;
    } else if (e.type === 'dig') {
      summary.treasure.digs += 1;
      if (e.worker && e.worker !== 'player') pet(e.worker).digs += 1;
      summary.treasure.coins += e.coins;
      for (const [id, n] of Object.entries(e.items)) summary.treasure.items[id] = (summary.treasure.items[id] || 0) + n;
    } else if (e.type === 'petGift') {
      const g = pet(e.pet).gifts;
      g[e.item] = (g[e.item] || 0) + e.qty;
    } else if (e.type === 'talentReady') {
      pet(e.pet).talentReady = true;
    } else if (e.type === 'favoriteFound') {
      pet(e.pet).favorite = e.item;
    } else if (e.type === 'bestiary') {
      summary.bestiary.push({ entry: e.entry, quality: e.quality });
    } else if (e.type === 'eggReady') {
      summary.nest.ready += 1;
    } else if (e.type === 'masteryStar') {
      summary.mastery[e.skill] = Math.max(summary.mastery[e.skill] || 0, e.stars);
    } else if (e.type === 'story') {
      summary.story.push(e.entry);
    } else if (e.type === 'tripDone') {
      pet(e.pet).trips.push({ zone: e.zone, items: e.items });
    } else if (e.type === 'wishGranted') {
      pet(e.pet).wishes += 1;
    }
  }
  return { summary, add };
}
