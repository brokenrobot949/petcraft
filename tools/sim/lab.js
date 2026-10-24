// Dev only: console helpers for tuning runs (Phase 10). On the simulator page, in the browser console:
//   const lab = await import('./lab.js'); lab.go('A', 'regular', 90, 'd.balance.renown.xpCurve.a = 400;');
//   lab.show('A')  -> paced milestones, coins, flags;  lab.pets('A') -> best pet's level and Bond by day
// Each run is its own Web Worker (worker.js), so several can run at once. Results stay in lab.results.
export const results = {};
export const full = {};

export function go(key, player = 'regular', days = 90, patch = '', { keepState = false, seed = 12345 } = {}) {
  results[key] = 'running';
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    if (e.data.error) results[key] = { error: e.data.error };
    else {
      full[key] = e.data.result;
      results[key] = summary(e.data.result);
    }
    w.terminate();
  };
  w.onerror = (e) => { results[key] = { error: e.message }; };
  w.postMessage({ player, days, seed, patch, keepState });
}

const PACED = /rank (10|12|15)$|Grand Project [15]|mythic|Starmetal|Fourth|Elder/;

export function summary(r) {
  return {
    player: r.player,
    seconds: Math.round(r.elapsedMs / 1000),
    milestones: r.milestones.filter((m) => m.targetDays != null || PACED.test(m.label))
      .map((m) => `${m.label.trim()} | ${m.actualDays == null ? '-' : m.actualDays.toFixed(1)} | ${m.targetText || ''} ${m.status || ''}`),
    coins: r.coins.balance,
    earned: r.coins.earned,
    restShare: +(r.petRestMs / (r.petRestMs + r.petWorkMs || 1)).toFixed(3),
    flags: r.flags.filter((f) => f.kind !== 'pace').map((f) => f.text),
  };
}

export function show(...keys) {
  return keys.map((k) => (typeof results[k] === 'string' ? `${k}: ${results[k]}` : `${k}: ${JSON.stringify({ ...results[k], flags: undefined }, null, 1)}`)).join('\n\n');
}

export function pets(key, days = [1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 25, 30, 40, 50, 60]) {
  return full[key].snapshots.filter((s) => days.includes(s.day))
    .map((s) => `day ${s.day}: best pet level ${s.petTopLevel}, Bond ${Math.round(s.petTopHearts)}, elders ${s.elders}, Renown ${s.renownRank}`).join('\n');
}
