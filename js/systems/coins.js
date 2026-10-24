// Coins, the only currency (docs/design.md "Coins"). Every source and sink goes through these two
// helpers so lifetime totals (stats.coinsEarned / stats.coinsSpent) stay right; the balance
// simulator uses them to check that every coin source has a sink.

export function earnCoins(state, amount) {
  const n = Math.floor(amount);
  if (!(n > 0)) return;
  state.coins += n;
  state.stats.coinsEarned = (state.stats.coinsEarned || 0) + n;
}

// Throws a player-readable error when there aren't enough coins.
export function spendCoins(state, amount) {
  const n = Math.floor(amount);
  if (!(n > 0)) return;
  if (state.coins < n) throw new Error(`You need ${n - state.coins} more coins.`);
  state.coins -= n;
  state.stats.coinsSpent = (state.stats.coinsSpent || 0) + n;
}
