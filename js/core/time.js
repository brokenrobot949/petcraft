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

// The player's local calendar day as a whole number (days since 1970-01-01 in local time).
// Daily things (the pat, later commissions) reset when this number changes, at local midnight.
export function localDay(ms) {
  const d = new Date(ms);
  return Math.floor((ms - d.getTimezoneOffset() * 60000) / 86400000);
}
