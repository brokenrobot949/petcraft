// The homestead's buildings (docs/design.md "Homestead"). state.buildings[id] = { tier } for every
// building in data/buildings.json; tier 0 means the plot is empty (not built yet). Upgrading is
// instant: it takes the tier's materials, coins and blueprint from the bag and adds Renown XP.
// No building can go past the Cottage's tier. What each tier does is read where it applies:
// the offline cap (core/time.js), station queue slots and speed (crafting.js), Stable rest speed
// (petstats.js) and Stable spaces (petCapacity, used by pets.js).
import { itemCount, removeItem } from './bag.js';

export const id = 'buildings';

export function init(state, ctx) {
  for (const b of ctx.data.buildings.buildings) {
    if (!state.buildings[b.id]) state.buildings[b.id] = { tier: b.startTier };
  }
}

// ---- lookups ----

export function buildingDef(data, buildingId) {
  return data.buildings.buildings.find((b) => b.id === buildingId) || null;
}

export function buildingTier(state, buildingId) {
  return state.buildings[buildingId]?.tier ?? 0;
}

// What it costs to reach `tier`: { coins, items: { itemId: n }, blueprint: itemId | null }.
export function tierCost(data, buildingId, tier) {
  const c = buildingDef(data, buildingId)?.costs?.[String(tier)];
  return c ? { coins: c.coins || 0, items: c.items || {}, blueprint: c.blueprint || null } : null;
}

// Pets the player can keep in all: the active slots plus the Stable's spaces.
export function petCapacity(state, data) {
  const spaces = data.balance.buildings.stableSpacesByTier;
  const tier = Math.max(1, buildingTier(state, 'stable'));
  return data.balance.pets.activeSlots + spaces[Math.min(spaces.length, tier) - 1];
}

// The name of the look a building has at a tier ('' for an empty plot).
export function lookName(data, buildingId, tier) {
  return tier > 0 ? buildingDef(data, buildingId)?.looks?.[tier - 1] || '' : '';
}

// Player-readable lines for what a building does at a tier, e.g. ['Away cap 10 h', 'Other buildings up to tier 2'].
export function effectLines(state, data, buildingId, tier) {
  const def = buildingDef(data, buildingId);
  if (!def || tier < 1) return [];
  const bal = data.balance;
  const at = (list) => list[Math.min(list.length, tier) - 1];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const lines = [];
  for (const e of def.effects) {
    switch (e) {
      case 'offlineCap':
        lines.push(`Works while you're away for up to ${bal.offline.baseCapHours + bal.offline.capHoursPerCottageTierAbove1 * (tier - 1)} h`);
        break;
      case 'tierCap':
        lines.push(`Other buildings can reach tier ${tier}`);
        break;
      case 'petSpaces':
        lines.push(`${at(bal.buildings.stableSpacesByTier)} pet spaces (plus ${bal.pets.activeSlots} working pets)`);
        break;
      case 'restSpeed':
        if (tier > 1) lines.push(`Pets rest ${pct(bal.pets.energy.stableRestBonusPerTier * (tier - 1))} faster`);
        break;
      case 'queueSlots': {
        const n = at(bal.crafting.queueSlotsByTier);
        lines.push(`${n} queue slot${n === 1 ? '' : 's'}`);
        break;
      }
      case 'craftSpeed':
        if (tier > 1) lines.push(`Crafts ${pct(bal.crafting.stationSpeedPerTier * (tier - 1))} faster`);
        break;
      case 'gardenPlots':
        lines.push(`${at(bal.buildings.gardenPlotsByTier)} garden plots`);
        break;
      case 'eggSlots': {
        const n = at(bal.buildings.nestEggSlotsByTier);
        lines.push(`${n} egg slot${n === 1 ? '' : 's'}`);
        break;
      }
      case 'hatchSpeed':
        if (tier > 1) lines.push(`Eggs hatch ${pct(bal.buildings.nestHatchCutPerTier * (tier - 1))} sooner`);
        break;
      default:
        break;
    }
  }
  return lines;
}

// Can this building go up one tier right now?
// -> { ok, reason, tier, next, cost, missing: [{ item, have, need }], coinsShort, needsBlueprint }
// reason is player-readable (null when ok). cost is null at the top tier.
export function upgradeCheck(state, data, buildingId) {
  const def = buildingDef(data, buildingId);
  if (!def) return { ok: false, reason: 'No such building.', tier: 0, next: 0, cost: null, missing: [], coinsShort: 0, needsBlueprint: false };
  const tier = buildingTier(state, buildingId);
  const next = tier + 1;
  const cost = next <= data.balance.buildings.maxTier ? tierCost(data, buildingId, next) : null;
  const out = { ok: false, reason: null, tier, next, cost, missing: [], coinsShort: 0, needsBlueprint: false };
  if (!cost) {
    out.reason = `The ${def.name} is fully upgraded.`;
    return out;
  }
  for (const [item, need] of Object.entries(cost.items)) {
    const have = itemCount(state, item);
    if (have < need) out.missing.push({ item, have, need });
  }
  out.coinsShort = Math.max(0, cost.coins - state.coins);
  out.needsBlueprint = !!cost.blueprint && itemCount(state, cost.blueprint) < 1;
  if (tier === 0 && state.renown.rank < (def.unlock?.renown || 1)) {
    out.reason = `Opens at Renown ${def.unlock.renown}.`;
  } else if (buildingId !== 'cottage' && next > buildingTier(state, 'cottage')) {
    out.reason = `Upgrade the Cottage to tier ${next} first.`;
  } else if (out.needsBlueprint) {
    out.reason = `Needs a ${data.items.items[cost.blueprint]?.name || 'blueprint'}.`;
  } else if (out.missing.length) {
    out.reason = 'Not enough materials yet.';
  } else if (out.coinsShort > 0) {
    out.reason = `Needs ${out.coinsShort} more coins.`;
  } else {
    out.ok = true;
  }
  return out;
}

// Every building with its tier and upgrade check, in data order (for the Home tab).
export function buildingList(state, data) {
  return data.buildings.buildings.map((def) => ({
    ...def,
    tier: buildingTier(state, def.id),
    check: upgradeCheck(state, data, def.id),
  }));
}

// True when at least one building can be upgraded right now (the Home tab badge).
export function canUpgradeAny(state, data) {
  return data.buildings.buildings.some((b) => upgradeCheck(state, data, b.id).ok);
}

// ---- changes ----

export const commands = {
  'buildings/upgrade': (state, { building }, ctx) => {
    const { data } = ctx;
    const check = upgradeCheck(state, data, building);
    if (!check.ok) throw new Error(check.reason);
    const { cost, next } = check;
    for (const [item, n] of Object.entries(cost.items)) removeItem(state, item, n);
    if (cost.blueprint) removeItem(state, cost.blueprint, 1);
    state.coins -= cost.coins;
    state.buildings[building].tier = next;
    const renownXp = data.balance.buildings.renownXpPerTier * next;
    state.renown.xp += renownXp;
    ctx.emit?.({ type: 'buildingUpgraded', building, tier: next, renownXp });
  },
};
