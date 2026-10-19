// Folds the events systems emit during offline catch-up into the "While you were away" summary:
// { ms, workers: { id: { actions, items: { id: n }, xp: { skill: n } } }, levelUps: { skill: level } }
export function createReport(ms) {
  const summary = { ms, workers: {}, levelUps: {} };
  function add(e) {
    if (e.type === 'harvest') {
      const w = summary.workers[e.worker] || (summary.workers[e.worker] = { actions: 0, items: {}, xp: {} });
      w.actions += 1;
      for (const [id, n] of Object.entries(e.items)) w.items[id] = (w.items[id] || 0) + n;
      w.xp[e.skill] = (w.xp[e.skill] || 0) + e.xp;
    } else if (e.type === 'levelUp') {
      summary.levelUps[e.skill] = Math.max(summary.levelUps[e.skill] || 0, e.level);
    }
  }
  return { summary, add };
}
