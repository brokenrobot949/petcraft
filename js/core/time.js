// Offline time rules (docs/handoff.md "Time"): elapsed = now - last save, capped at the offline cap;
// a clock that moved backwards counts as zero.

const HOUR_MS = 3600 * 1000;

export function offlineCapMs(state, balance) {
  const o = balance.offline;
  const tier = state.buildings.cottage.tier;
  return (o.baseCapHours + o.capHoursPerCottageTierAbove1 * (tier - 1)) * HOUR_MS;
}

export function elapsedOfflineMs(state, balance, now) {
  const raw = now - state.meta.lastSavedAt;
  if (!(raw > 0)) return 0;
  return Math.min(raw, offlineCapMs(state, balance));
}
