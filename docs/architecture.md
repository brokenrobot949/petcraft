# PetCraft architecture notes (lead-owned)

The contract between the simulation core and everything else. Only the lead changes the state
schema, the system interfaces or the structure of `data/balance.json`. Subagents build against
this file.

## Save state (schema version 5; Phase 6 additions in "Phase 6: village and progression")

```js
{
  version: 5,
  meta: { createdAt, lastSavedAt, launches },     // ms timestamps
  rng: 123456789,                                  // seeded RNG state (js/core/rng.js)
  settings: { music: true, sound: true },
  coins: 0,
  renown: { rank: 1, xp: 0 },
  buildings: { cottage: { tier: 1 } },
  skills: { chopping: { level: 1, xp: 0 }, ... },  // xp = progress into the current level
  bag: { pine_log: 12, ... },                      // item id -> count; no caps
  tools: { axe: { item: 'stone_axe', quality: 'normal' }, ... },  // equipped tool per tool kind
  workers: {
    player: { task: null | { zone, skill, node }, progressMs: 0, rng },  // rng: the worker's own random stream (v3)
    pet1: { ... },                                 // one entry per ACTIVE pet, keyed by pet id (v3)
  },
  stats: { actions: { chopping: 0, ... }, crafts: { recipeId: n } }, // lifetime harvest actions per skill; crafts per recipe (v4)
  pets: {                                          // v3
    nextId: 2, starter: 'sprout' | null,           // starter = archetype of the first egg chosen
    active: ['pet1', null],                       // balance.pets.activeSlots slots; others live in the Stable
    list: { pet1: Pet },
  },
  pantry: { meadow_herb: false },                  // v3: food (bag keys) auto-feed may NOT use (missing = allowed)
  crafting: { stations: { workbench: Station } },  // v4
  buffs: { berry_compote: { skills: ["foraging"], speed: 0.1, msLeft } },  // v4: keyed by base item id
}
// Pet: { id, name, archetype, quality, form: 'hatchling'|'juvenile'|'adult', branch: null|id,
//   level, xp, energy, resting, autoFeed, bond, workMs (toward the next work Bond point),
//   lastPatDay: null|localDay, bornAt, actions: { skill: n }, gifts: [], talents: [] }
// Station: { queue: [Batch], progressMs (into the front item), notice (queue ran empty, unseen), rng }
// Batch: { recipe, qty, done, focus: null|'good'|'perfect', inputs: { itemId: perItem }, made: { key: n } }
```

- Missing entries in `skills`, `tools` and `stats.actions` are filled from data by each system's
  `init` (run on every load), so adding a skill or tool kind later needs no migration.
- Bag keys are plain item ids for Normal copies; items with quality (tools, meals) use `id:fine` and
  `id:masterwork` for the better copies (`itemKey`, `parseKey`, `itemDef`, `itemLabel` in js/systems/bag.js).

## Systems (js/systems)

Each module exports `id`, and optionally:

- `init(state, ctx)`: idempotent; fills defaults from data. Runs after load/migration.
- `advance(state, ms, ctx)`: moves game time forward. Deterministic: no Date.now, no Math.random,
  no DOM.
- `commands`: `{ 'system/verb': (state, payload, ctx) => void }`. Throw an Error with a
  player-readable message to refuse.
- Read-only helpers ("selectors") the UI may import and call with `(state, data, ...)`.

`ctx = { data, emit }`. `data` is every `data/*.json` file by name (`ctx.data.items`).
`emit(event)` reports something that happened; it may be absent (the balance simulator).

### Events

```js
{ type: 'harvest', worker: 'player', zone, skill, node, items: { pine_log: 1 }, xp: 2.4, rare: false }
{ type: 'levelUp', skill: 'chopping', level: 5 }
```

During live play `game.onEvents(fn)` receives each tick's events (used for "+1 Pine Log" pops).
During catch-up the same events are folded into a summary (js/core/report.js):

```js
{ ms, workers: { player: { actions, items: { id: n }, xp: { skill: n } } }, levelUps: { skill: level } }
```

## Game object (js/core/game.js)

- `game.data`, `game.getState()`, `game.subscribe(fn)` (called after every change)
- `game.dispatch(type, payload)`: throws on refusal; UI catches and shows `err.message` in a toast
- `game.advance(ms)`, `game.catchUp(ms) -> summary`, `game.onEvents(fn) -> unsubscribe`

## App object (js/main.js, passed to every tab's mount)

- `app.game`, `app.saveNow()`, `app.importSave(state)`, `app.pwa`
- `app.simulateAway(ms)`: test mode. Runs offline catch-up for `min(ms, cap)` exactly as a real
  return would and shows the "While you were away" sheet.
- `app.resetGame()`: test mode. Starts a fresh save (old one kept as the backup).

## Selectors the UI uses (Phase 2)

From `js/systems/skills.js`:
- `skillLevel(state, skillId)`, `xpToNext(level, balance)`, `skillProgress(state, data, skillId) -> { level, xp, next, max }`

From `js/systems/bag.js`:
- `itemCount(state, itemId)`, `bagList(state, data) -> [{ id, count, item, category }]` sorted by category order then name

From `js/systems/harvest.js`:
- `zoneUnlocked(state, data, zoneId)`
- `nodeCheck(state, data, zoneId, skillId, nodeId) -> { ok, reason }` (reason is player-readable)
- `actionMs(state, data, workerId, task)`: duration of one action for that worker
- `workerTask(state, workerId)`: current task or null
- `toolFor(state, data, skillId) -> { kind, item, tier, quality }`

Commands: `harvest/assign { worker, zone, skill, node }`, `harvest/stop { worker }`,
`dev/grant { item, qty }`, `dev/setLevel { skill, level }`, `dev/addCoins { amount }`.

## Data files (Phase 2)

### data/skills.json

```json
{
  "tierLevels": [1, 10, 20, 30, 40, 50],
  "skills": [
    { "id": "chopping", "name": "Chopping", "type": "harvest", "tool": "axe", "verb": "Chop" }
  ]
}
```
`type` is `harvest`, `craft` or `special`. Harvest skills name their tool kind; craft skills name
their `station` instead (`workbench`, `forge`, `kitchen`, `alchemyLab`).

### data/tools.json

```json
{
  "kinds": [ { "id": "axe", "name": "Axe", "skill": "chopping", "starter": "stone_axe" } ],
  "tiers": [ { "tier": 1, "metal": "stone", "name": "Stone", "opens": "meadowfold" } ],
  "qualities": [ { "id": "normal", "name": "Normal" }, { "id": "fine", "name": "Fine" }, { "id": "masterwork", "name": "Masterwork" } ]
}
```
The shovel kind has `"skill": null`.

### data/items.json

```json
{
  "categories": [ { "id": "wood", "name": "Wood" } ],
  "items": {
    "pine_log": { "name": "Pine Log", "category": "wood", "tier": 1, "sell": 2, "desc": "..." },
    "minnow":   { "name": "Minnow", "category": "fish", "tier": 1, "sell": 3, "food": 12, "desc": "..." },
    "stone_axe": { "name": "Stone Axe", "category": "tool", "tier": 1, "sell": 0, "tool": "axe", "quality": true, "desc": "..." }
  }
}
```
`food` (optional) = energy restored when a pet eats it raw. `quality: true` marks items that roll quality.

### data/zones.json

```json
{
  "zones": [
    {
      "id": "meadowfold", "name": "Meadowfold", "tier": 1, "unlock": { "renown": 1 },
      "archetypes": ["sprout", "wild"], "blurb": "...",
      "harvest": {
        "chopping": [
          { "id": "pine", "name": "Pine Tree", "level": 1,
            "drops": [ { "item": "pine_log", "qty": [1, 1], "chance": 1 },
                       { "item": "pine_sap", "qty": [1, 1], "chance": 0.08 } ] }
        ]
      },
      "rare": { "chopping": [ { "item": "...", "weight": 1 } ] }
    }
  ]
}
```
A zone with an empty `harvest` is listed on the map but has nothing to do yet.
A zone's optional `scene` lays out its World-tab scene (js/render/zoneScene.js): `idle [x, y]`,
`spots.<skill> { prop, x, y, stand: [x, y], face }` and `decor [{ prop, x, y }]`, all in fractions
of the scene size. Scene timing and sizes live in `balance.render.zone`.

### balance.json additions (Phase 2)

- `skills.maxLevel`, `skills.xpCurve { a, exp, b }`: XP to next level = a × L^exp + b
- `harvest.actionSeconds { skill: s }`, `harvest.tierDurationMult [..]` (index = tier − 1)
- `harvest.xpPerActionSecond`, `harvest.xpPerNodeLevel`
- `harvest.rareFindBase`, `harvest.playerRareMult`
- `harvest.toolQualitySpeed { quality: bonus }`, `harvest.toolQualityRare { quality: points }`
- `offline.summaryMinSeconds`: shorter absences show no summary sheet

## Art roles (data/sprites.json)

- `player`, `pet.<archetype>.<form>`, `mythic.<archetype>` (Phase 1)
- `item.<itemId>`: one 16×16 icon per item (Phase 2)
- `held.<toolKind>`: the tool drawn in the player's hand while harvesting (Phase 2)
- `prop.<name>`: zone scene scenery (Phase 2: Meadowfold harvest spots)

## Phase 3: pets

### Time, clock and determinism

- `createGame(data, state, { clock })`: commands get `ctx.now` (ms) and `ctx.day` (local calendar day
  number, `localDay()` in js/core/time.js). `advance()` never reads the clock.
- Each worker rolls from its own stream (`workers[id].rng`), and pets step event by event, so
  live ticks and offline catch-up give identical results (tools/tests/core.html checks this).
  The one exception: two pets eating from the same pantry when it runs out.

### How pets work (js/systems/pets.js, helpers in js/systems/petstats.js)

- Active pets are harvest workers. `harvest/assign { worker: petId, ... }` and `harvest/stop` work
  for pets; a pet can work any node the player can (`nodeCheck`). The harvest system advances
  only the player; the pets system advances pets and calls `harvest.completeAction()`.
- Working drains energy; at or below `autoFeedBelowFrac` of max, an auto-feeding pet eats one
  pantry item (smallest `food` first; only `balance.pets.energy.autoFeedCategories`: meals and tonics, never raw food); at 0 it rests until full. An active pet with no task
  recovers at the rest rate; stabled pets rest `stabledRestMult` times faster and earn no XP.
- Pet actions give pet XP (`xpPerSkillXp` x the action's skill XP), never player skill XP. Levels
  stop at the stage cap (10 / 20 / 30); extra XP banks.
- Bond: +1 per `workMinutesPerPoint` of work, +`pat` once per local day.

### Events (Phase 3)

```js
{ type: 'harvest', worker: 'pet1', ..., xp: 0, petXp: 2.5 }   // pets: xp is 0, petXp is the pet's XP
{ type: 'petTime', pet, workMs, restMs }      // every advance in which the pet worked or rested
{ type: 'petAte', pet, item, energy, auto }   // auto: false when hand-fed
{ type: 'petRest', pet }  { type: 'petWoke', pet }
{ type: 'petLevelUp', pet, level }  { type: 'petHeart', pet, hearts }
{ type: 'petPat', pet, bond }  { type: 'petHatched', pet }
```
Summary additions: `workers[petId].petXp`, and `pets: { petId: { workMs, restMs, ate: { item: n }, level, hearts } }`
(`level` / `hearts` are null unless a new one was reached while away).

### Commands (Phase 3)

`pets/hatchStarter { archetype, name }`, `pets/rename { pet, name }`, `pets/pat { pet }`,
`pets/feed { pet, item }`, `pets/setAutoFeed { pet, on }`, `pets/setPantry { item, on }`,
`pets/setActive { pet, slot }`, `pets/stable { pet }`.
Test mode: `dev/addPet { archetype, quality }`, `dev/petEnergy { pet, energy }`,
`dev/petLevel { pet, level }`, `dev/petBond { pet, bond }`, `dev/clearPat { pet }`.

### Selectors (Phase 3)

From `js/systems/pets.js`: `petList(state)` (oldest first), `getPet`, `isActive`, `needsStarter(state)`,
`canPatToday(state, petId, day)`, `petStatus(state, petId) -> 'working'|'resting'|'idle'|'stabled'`,
`isFood(data, itemId)`, `pantryAllows`, `pantryList(state, data) -> [{ id, item, count, on }]`,
`nextPantryFood`, `workHoursLeft(data, pet)`, `cleanName(name, data)`.
Since Phase 4 `pantryList` holds only food auto-feed can use (`canAutoFeed(data, key)`); `foodList(state, data)`
holds all food (hand-feeding), entries `{ id, item, label, food, count, auto, on }`.

From `js/systems/petstats.js`: `archetypeOf(data, id)`, `isPet(state, workerId)`, `petStage`,
`petLevelCap`, `petProgress(data, pet) -> { level, xp, next, capped, cap }`,
`petHearts(data, pet) -> { hearts, max, bond, from, to }`, `petMaxEnergy`, `petDrainPerHour`,
`petRestPerHour(state, data, pet, { stabled })`, `petFeedThreshold`, `hasAffinity(data, pet, skill)`,
`petSpeed(data, pet, skill)`, `petRareBonus`, `petRole(pet)` (sprite role of its current form).

The UI gets today's day number from `localDay(Date.now())` (js/core/time.js).
`js/ui/icons.js`: `faceIcon(roleId, px)` draws a pet portrait; `frameIcon(frameName, px)` any atlas frame.

### data/pets.json

```json
{
  "archetypes": [ { "id": "sprout", "name": "Sprout", "species": "Sporelet", "affinity": ["foraging", "chopping"],
                    "favoriteFood": "...", "blurb": "...",
                    "egg": { "name": "Mossy Egg", "desc": "...", "colors": ["#base", "#dark", "#light"] },
                    "branches": [ { "id": "bloom", "name": "Bloom", "calling": "foraging" } ] } ],
  "forms": [ { "id": "hatchling", "stage": 1, "name": "Hatchling" } ],
  "qualities": [ { "id": "common", "name": "Common", "stars": 1 } ],
  "suggestedNames": ["Pip"],
  "lines": { "hatch": "...", "patted": ["{name} ..."], "resting": ["{name} ..."], "ate": ["{name} ... {food}"] }
}
```
Egg pictures are drawn in code from `egg.colors` (no egg sprite in the pack).

### balance.json additions (Phase 3)

`pets.activeSlots`, `maxLevel`, `stageLevelCaps`, `callingActions` (branch unlock, Phase 8; shown as progress now), `xpCurve { a, exp, b }`, `xpPerSkillXp`, `starterQuality`,
`nameMaxLength`, `energy { max, drainPerHour, restPerHour, stableRestBonusPerTier, stabledRestMult,
autoFeedBelowFrac }`, `speed { base, perLevel, affinityBonus, bondPerHeart }`,
`stamina { maxPerLevel, drainCutPerLevel }`, `luck { rarePerLevel }`, `bond { hearts, pat, workMinutesPerPoint }`,
`qualities.<id> { growth, gifts, odds }`. Level growth terms are `(level - 1) x quality growth`.

## Phase 4: crafting

### Rules (js/systems/crafting.js, tools.js, buffs.js)

- Four stations from `data/recipes.json`. Every station is open and tier 1 until buildings arrive
  (Phase 5: `state.buildings[stationId].tier`). Queue slots = `balance.crafting.queueSlotsByTier`.
- `crafting/start` takes the materials for the whole batch out of the bag at once; the front batch
  makes items one at a time; leftover time carries into the next batch; an empty station banks no
  time and sets `notice` (the Craft tab badge) until `crafting/seen`.
- Item time = `seconds / (1 + stationSpeedPerTier x (tier - 1) + buff)`. XP per item =
  `seconds x xpPerCraftSecond x (1 + level x xpPerRecipeLevel)`.
- Quality (outputs with `quality: true`): Fine = min(fineCap, fineBase + finePerLevel x levels above
  the recipe), Masterwork likewise; Focus multiplies both (`focus.mult`), then `fineFocusCap` /
  `masterworkFocusCap` apply. One roll per item from the station's own stream.
- A finished tool better than the equipped one (higher tier, then better quality) is equipped at once;
  the old tool goes to the bag. `tools/equip` swaps by hand.
- Meals: pets eat them like raw food (`food` x `mealQuality`), +`pets.bond.favoriteDish` Bond when the
  dish matches the archetype's `dish`. The player eating one (`buffs/use`) gets its `buff`
  (x `mealQuality` for quality items); the strongest active buff per skill applies to the player's
  harvesting and to crafting in that skill. Buffs count down in game time.
- `nextBoundaryMs(state, ctx)`: the tick splits time where a buff ends or a tool finishes, so live play
  and offline catch-up agree. Remaining exception: crafted food reaching the pantry inside a chunk.

### Events (Phase 4)

```js
{ type: 'craft', station, recipe, item: key, qty, quality, xp, skill }
{ type: 'batchDone', station, recipe, made: { key: n } }   { type: 'stationIdle', station }
{ type: 'toolEquipped', kind, item: key }
{ type: 'buffStarted', item: key, skills, speed, ms }      { type: 'buffEnded', item: itemId }
{ type: 'petAte', ..., favorite: true|false }
```
Summary additions: `stations: { stationId: { items: { key: n }, xp, skill } }`, `equipped: [key]`, `buffsEnded: [itemId]`.

### Commands (Phase 4)

`crafting/start { recipe, qty, focus }` (focus: 'perfect' | 'good' | 'miss' | null for Skip),
`crafting/cancel { station, index }`, `crafting/seen`, `tools/equip { item: key }`, `buffs/use { item: key }`.
Test mode: `dev/grant { item, qty, quality }`.

### Selectors (Phase 4)

From `js/systems/crafting.js`: `stationList(state, data) -> [{ id, name, skill, blurb, tier, slots, queue, progressMs, notice }]`,
`recipesFor(data, stationId)`, `recipeDef`, `stationDef`, `recipeCheck(state, data, recipeId, qty) -> { ok, reason, max }`,
`itemMs(state, data, recipe)`, `itemXp(data, recipe)`, `makesQuality(data, recipe)`,
`qualityOdds(state, data, recipe, focus) -> { fine, masterwork }`, `stationTimeLeft(state, data, stationId) -> { total, item }`,
`craftNotice(state)`, `queueSlots`, `stationTier`.
From `js/systems/tools.js`: `isUpgrade(state, data, key)`.
From `js/systems/buffs.js`: `buffOf(data, key) -> { skills, speed, ms } | null`, `buffSpeed(state, skill)`,
`activeBuffs(state, data) -> [{ id, item, skills, speed, msLeft }]`.
From `js/systems/pets.js`: `foodValue(data, key)`, `isFavoriteDish(data, pet, key)`; `pantryList` entries gain `label` and `food`.

### data/recipes.json

```json
{
  "stations": [ { "id": "workbench", "name": "Workbench", "skill": "carpentry", "blurb": "..." } ],
  "recipes": [ { "id": "copper_axe", "station": "forge", "level": 10, "seconds": 12,
                 "inputs": { "copper_axe_head": 1, "tool_handle": 1 }, "output": "copper_axe", "qty": 1,
                 "needs": { "carpentry": 10 } } ]
}
```
`level` is in the station's skill; `needs` lists other skills' levels. Item additions: `dish`
(fruit | nut | fish | meat), `buff { skills, speed, minutes }`; archetypes gain `dish`.

### balance.json additions (Phase 4)

`crafting { queueSlotsByTier, stationSpeedPerTier, xpPerCraftSecond, xpPerRecipeLevel, maxBatch,
quality { fineBase, finePerLevel, fineCap, fineFocusCap, masterworkBase, masterworkPerLevel, masterworkCap, masterworkFocusCap },
focus { mult { good, perfect }, sweepMs, goodWidth, perfectWidth }, mealQuality }`, `pets.bond.favoriteDish`, `pets.energy.autoFeedCategories`.
Focus bar: the marker sweeps 0..1 and back every `sweepMs`; Perfect = within `perfectWidth / 2` of
the centre, Good = within `goodWidth / 2`.

## Phase 5: homestead

No schema bump: `state.buildings` was already a map. `buildings.init` fills one `{ tier }` entry per
building in `data/buildings.json` (`startTier`; 0 = empty plot), so Phase 4 saves keep tier 1 stations.

### Rules (js/systems/buildings.js)

- `buildings/upgrade { building }` is instant. It needs the next tier's `costs[tier]` (items, coins and,
  for tiers 3-5, one blueprint item), the Cottage at that tier or higher (the Cottage itself is exempt),
  and for tier 0 -> 1 `state.renown.rank >= unlock.renown`. It adds `balance.buildings.renownXpPerTier x
  new tier` to `state.renown.xp` (ranks arrive in Phase 6).
- Effects are read where they apply: Cottage -> offline cap (core/time.js); stations -> queue slots and
  speed (crafting.js `stationTier`); Stable -> rest speed (petstats.js) and pet spaces: `createPet`
  refuses when pets >= `petCapacity` (active slots + `stableSpacesByTier`). Garden plots, Nest egg
  slots and hatch speed are shown now and used in Phases 6-7.
- Phase 5 content limits: renown rank stays 1, so the Garden (Renown 2) and Nest (Renown 8) stay
  locked; the Forge and Alchemy Lab start built (tier 1). Tiers 3-5 need blueprints from the Mossbrook
  market (Phase 6) and coins; test mode can grant both. Tier 3-5 costs use tier 1 materials until
  Whisperwood and later zones exist (Phase 6 swaps them, data only).

### Events (Phase 5)

```js
{ type: 'buildingUpgraded', building, tier, renownXp }
```

### Commands (Phase 5)

`buildings/upgrade { building }`. Test mode: `dev/setBuilding { building, tier }` (any tier 0-5, no cost,
ignores the Cottage cap), `dev/setRenown { rank }`.

### Selectors (Phase 5)

From `js/systems/buildings.js`: `buildingDef(data, id)`, `buildingTier(state, id)`, `tierCost(data, id, tier)
-> { coins, items, blueprint } | null`, `petCapacity(state, data)`, `lookName(data, id, tier)`,
`effectLines(state, data, id, tier) -> [string]`, `upgradeCheck(state, data, id) -> { ok, reason, tier,
next, cost, missing: [{ item, have, need }], coinsShort, needsBlueprint }`, `buildingList(state, data)`
(each def plus `tier` and `check`), `canUpgradeAny(state, data)` (Home tab badge).

### data/buildings.json

```json
{
  "buildings": [
    { "id": "cottage", "name": "Cottage", "blurb": "...", "startTier": 1, "unlock": { "renown": 1 },
      "effects": ["offlineCap", "tierCap"],
      "looks": ["Tent", "Cabin", "Cottage", "Farmhouse", "Manor"],
      "plot": [0.3, 0.3],
      "costs": {
        "2": { "coins": 0, "items": { "pine_plank": 10, "stone": 20 } },
        "3": { "coins": 150, "items": { "...": 1 }, "blueprint": "blueprint_sturdy" }
      } }
  ],
  "decor": [ { "prop": "sanctuary_ruins", "plot": [0.76, 0.22], "label": "Old Sanctuary" } ]
}
```
`effects` kinds: offlineCap, tierCap, petSpaces, restSpeed, queueSlots, craftSpeed, gardenPlots,
eggSlots, hatchSpeed. `looks[t-1]` names tier t's look. `plot` is the building's base centre in
fractions of the Home scene. `costs` has a key for every tier the building can be raised to
("1" only for buildings that start at 0). Station buildings share their id with `recipes.json` stations.
Items gain the `blueprint` category (`blueprint_sturdy` t3, `blueprint_fine` t4, `blueprint_grand` t5)
and building parts (`pine_frame`, `pine_shingles`, `copper_nails`).

### balance.json additions (Phase 5)

`buildings { maxTier, stableSpacesByTier, gardenPlotsByTier, nestEggSlotsByTier, nestHatchCutPerTier, renownXpPerTier }`.

### Art roles (Phase 5)

- `building.<id>.<tier>` (tier 1-5): one composed picture per building tier, layout `prop`
  (anchored at its bottom centre). A role may list `parts: [{ src, x, y, w, h, dx, dy }]`: the atlas
  packer pastes each piece at (dx, dy) inside the role's frameWidth x frameHeight canvas.
- `prop.plot_empty` (an unbuilt plot), `prop.sanctuary_ruins`, `prop.signpost` (the road to Mossbrook).
- `fx.leaf`, `fx.rain`, `fx.sparkle`: short animated strips for the polish layer.

## Phase 6: village and progression

### Save schema v5 (migration 4 -> 5)

```js
renown: { rank, xp },                  // xp is now progress INTO the current rank (renown.init settles old totals)
crafting: { stations, working: [stationId], known: { recipeId: true } },  // stations the player works; recipes learned from scrolls
village: { day, board: [Commission], rerolls, seen, week, great: Commission|null, merchant: [{ item, price, left }], rng },
garden: { plots: [{ seed: itemId|null, ms, auto, rng }], rng },
achievements: { done: { id: true }, title: null|achievementId },
stats: + coinsEarned, coinsSpent, sold, commissions, greats, garden, found: { itemId: true }, quality: { fine, masterwork }
// Commission: { template, items: { itemId: n }, coins, renown, bonus: { itemId: n }|null, done }
```
Migration: the first station (data order) with a queue keeps working; the others pause with their queues.
Stats fields are filled by each system's init.

### Rules

- **Renown** (js/systems/renown.js): `addRenownXp(state, ctx, amount, source)` is the only way to add Renown XP;
  ranks follow `balance.renown.xpCurve` (a x R^exp + b to the next rank), up to `maxRank`. Sources: commissions
  (rolled in `balance.village.daily.renown`), the Great Commission (`great.renown`), achievements (their `renown`),
  building upgrades (30 x tier), the first craft of each recipe (`renown.firstCraft`). Zones and buildings open
  from their own `unlock.renown`. Titles by band from data/renown.json.
- **Working stations** (js/systems/crafting.js): the player works `workSlots` stations at once
  (`balance.crafting.workSlotsByCottageTier`); only those advance. A free slot picks up the first station
  (data order) with a queue; when a worked queue empties, the leftover time goes to the next waiting station.
  `crafting/work { station }` switches by hand (the station worked longest pauses). Stations with building tier 0
  (Forge before Renown 2, Alchemy Lab before 5, for new saves) can't queue. Phase 8 adds assistants.
- **Coins** (js/systems/coins.js): `earnCoins`, `spendCoins` keep `stats.coinsEarned/Spent`. Sources: selling,
  commissions (Phase 7: treasure). Sinks: building tiers 2-5 coins, blueprints, seeds, scrolls, merchant, paid rerolls.
- **Mossbrook** (js/systems/village.js): `village/newDay` (sent by the UI on load, on return to the page and
  every minute; by the simulator at each check-in) fills a new board when `ctx.day` changed (local midnight) and a
  new Great Commission when the Monday-based week changed. The merchant restocks with the board every day
  (Rob, 2026-10-23). Templates are eligible when
  their `tier` <= `reachableTier` (highest open zone tier the player has a harvest tool for) and within
  `tierSpread` of it, and their `needs` skill levels are met. Coins = max(minCoins, sell value x coinMult).
  Deliveries take any quality, Normal first. 1 free reroll a day, then `rerollCost` coins.
  Selling pays `sell x sellQualityMult[quality]`; items with sell 0 can't be sold.
- **Garden** (js/systems/garden.js): plots from `gardenPlotsByTier` (0 while unbuilt). A seed item's
  `seed { crop, minutes, yield }` (items.json) grows, the crop goes to the bag, and with `auto` on another
  seed of that kind is planted from the bag with the leftover time carried.
- **Achievements** (js/systems/achievements.js): conditions (`when.kind`, see `conditionProgress`) are
  checked after every command (new system hook `afterCommand(state, ctx)`, called by game.dispatch) and at the
  end of every advance. A save gets what it already earned on load, quietly.

### Events (Phase 6)

```js
{ type: 'renownXp', amount, source }   { type: 'rankUp', rank }   { type: 'achievement', id, renown }
{ type: 'newBoard', day }   { type: 'commissionDone', slot, template, coins, renown, bonus }
{ type: 'sold', item: key, qty, coins }   { type: 'bought', item, qty, coins, merchant? }   { type: 'learned', recipe, coins }
{ type: 'gardenHarvest', plot, seed, item, qty }
```
Summary additions: `renown: { xp, rank|null }`, `achievements: [id]`, `garden: { itemId: n }`.

### Commands (Phase 6)

`village/newDay`, `village/seen`, `village/deliver { slot }` (slot 0..2 or 'great'), `village/reroll { slot }`,
`market/sell { item: key, qty }`, `market/buy { item, qty }`, `market/learn { recipe }`, `market/buyMerchant { index }`,
`crafting/work { station }`, `garden/plant { plot, seed }`, `garden/clear { plot }`, `garden/auto { plot, on }`,
`achievements/setTitle { id|null }`. Test mode: `dev/addRenownXp { amount }`, `dev/newDay` (fresh board, merchant and Great
Commission), `dev/setRenown` now also clears the rank's XP.

### Selectors (Phase 6)

- renown.js: `xpToNextRank(rank, balance)`, `rankTitle(data, rank)`, `unlocksAt(data, rank) -> [string]`,
  `rankInfo(state, data) -> { rank, title, xp, next, max, nextRank, nextUnlocks, nextUnlockRank }`.
- village.js: `boardList(state, data) -> [{ slot, template, giver, note, items: [{ item, need, have }], coins, renown,
  bonus, done, canDeliver }]`, `greatCommission(state, data)` (same shape, slot 'great', or null),
  `rerollInfo -> { free, cost }`, `villageNotice(state, data)` (badge), `sellPrice(data, key)`,
  `sellList -> [{ key, item, count, price }]`, `shopList -> [{ item, def, price, locked, have }]`,
  `scrollList -> [{ recipe, def, output, price, known, locked }]`, `merchantList -> [{ index, item, def, price, left, normal }]`,
  `reachableTier`, `weekOf(data, day)`. `locked` is a player-readable reason or null.
- crafting.js: `workSlots(state, data)`, `isWorking(state, id)`; `stationList` entries gain `working` and
  `status` ('unbuilt' | 'working' | 'paused' | 'idle'). `recipeCheck` reasons for an unbuilt station and an unlearned
  scroll recipe start with "Needs".
- garden.js: `plotCount`, `plotList -> [{ index, seed, crop, ms, growMs, left, auto }]`, `seedList -> [{ id, item, count, crop, minutes, yield }]`, `seedDef`, `growMs`.
- achievements.js: `achievementList -> [{ ...def, done, progress: { have, need } }]`, `wornTitle(state, data)`, `conditionProgress`.

### Data files (Phase 6)

- data/renown.json: `titles [{ from, name }]`, `ranks [{ rank, unlocks: [string] }]` (extras beyond zones/buildings).
- data/commissions.json: `daily`, `great`: `[{ id, giver, note, tier, items: [{ item, qty: [min, max] }], needs: { skill: level } }]`,
  `bonus: [{ item, qty, tier, weight }]`.
- data/market.json: `shop [{ item, price, renown }]`, `scrolls [{ recipe, price, renown }]`, `merchant [{ item, price, qty, renown, weight }]`.
- data/achievements.json: `achievements [{ id, name, desc, group, renown, title|null, when: { kind, ... } }]`.
- items.json: `seed { crop, minutes, yield }` on seed items; recipes.json: `scroll: true` on recipes learned from scrolls.
- zones.json `scene` may set `ground` and `speck` colors ("0xrrggbb") for its zone scene.

### balance.json additions (Phase 6)

`crafting.workSlotsByCottageTier`, `renown { maxRank, xpCurve, firstCraft }`, `village { boardSize, freeRerolls,
rerollCost, tierSpread, weekStartOffset, sellQualityMult, daily { renown, coinMult, minCoins, bonusChance },
great { renown, coinMult, minCoins }, merchant { slots }, dayCheckSeconds }`, `garden { growSpeed }`. New water props join
`render.polish.shadow.skipProps`. Zone scenes now follow their host size with a ResizeObserver (like Home).

## Phase 7: taming and treasure

### Save schema v6 (migration 5 -> 6)

```js
taming: {
  encounters: { zoneId: { archetype, quality, msLeft: null | ms } },  // one per zone; msLeft null = waits until trapped or let go
  traps: { zoneId: { trap: itemKey, bait: itemKey | null, chance, msLeft, rng } },  // one per zone, on that zone's encounter
  lure: null | { item, msLeft, bands },
  results: [TrapResult],     // newest last, at most balance.taming.maxResults
  seen: true,                // false = a trap finished since the player last looked (World tab badge)
  rng,
},
treasure: { progress: { zoneId: ms }, rng },     // dig progress per zone (kept when the player switches task)
nest: { slots: [NestEgg | null], rng },           // incubating eggs; length follows the Nest tier
stats: + tamed, digs, hatched, maps, released
// TrapResult: { zone, archetype, quality, caught, pet: petId | null, trap: itemKey, trapKept }
// NestEgg: { item, archetype, quality, msLeft }   (quality hidden in the UI until hatched)
workers.player.task: { zone, skill: 'taming', node: 'track' }   // tracking
                     { zone, skill: 'treasure', node: 'dig' }   // digging (progress in treasure.progress[zone])
workers.player.resume: null | harvest task                      // taken up again when digging runs out of maps
                                                                // or tracking finds an encounter
```

### Rules

- **Tracking** (js/systems/taming.js): a player task. Each action takes `taming.trackSeconds x
  harvest.tierDurationMult[zone tier - 1]` (faster with a 'taming' buff), gives Taming XP
  (`xpPerTrackSecond` per base second), and while the zone has no encounter reveals one with chance
  `revealBase + revealPerLevel x Taming level`: a hatchling of one of the zone's `archetypes`, quality
  from `rollQuality` (odds `balance.pets.qualities.*.odds`; Taming luck multiplies every band above
  the first by `1 + qualityLuckPerLevel x level`; a running lure moves the result `bands` higher).
  On a reveal the player takes up `resume` if set, else keeps tracking (XP only).
- **Hint:** below Taming `qualityRevealLevel` the UI shows only "Looks ordinary" (quality below
  `specialFrom`) or "Something special"; at or above it, the quality name.
- **Traps:** `taming/setTrap` needs the zone's encounter, no trap there yet, a trap item of tier >= zone
  tier, and a free pet space (pets + traps set < `petCapacity`). Trap and bait leave the bag. Chance =
  `catchChance` (below), fixed when set. `trapMinutes` later (game time, offline too): caught -> a new
  pet (first free active slot, else the Stable; named after its species), the trap comes back with
  chance `trapKeptOnCatch`, `catchXp x zone tier` Taming XP; escaped -> the trap comes back with chance
  `trapKeptOnEscape` and the encounter stays `escapeStayHours` (then wanders off). Bait is always used up.
- **Catch chance:** `min(cap, base + perTrapTier x (trap tier - zone tier) + (bait dish == archetype dish ?
  bait : 0) + perLevel x Taming level)`. Spec: 35% + 10%/tier + 20% + 0.5%/level, cap 95%.
- **Lures:** `taming/useLure` adds the lure's `minutes` to the running lure (bands = the larger).
  Lure time runs in game time.
- **Maps** (harvest.completeAction): every harvest action rolls `treasure.mapChance[skill]`
  (else `.other`); for pets x `(1 + petLuckMapMult x petRareBonus / harvest.rareFindBase)`; a hit adds the zone's map item
  (items.json `map.zone`) to the action's `items`. Maps are bag items.
- **Digging** (js/systems/treasure.js): `treasure/dig { zone }` needs a map for that zone. The dig
  takes `digMinutes / (1 + shovelSpeedPerTier x (shovel tier - 1) + harvest.toolQualitySpeed[quality])`.
  When it finishes the map is used up and the reward rolled: coins in `byTier.coins[tier-1]`,
  `byTier.rolls[tier-1]` weighted picks from `data/treasure.json` `loot[tier]`, a relic with chance
  `byTier.relic[tier-1]`, an egg item (`treasure.json eggItem`) with chance `eggChance`.
  More maps for the zone: the next dig starts with the leftover time; none: the player takes up
  `resume` (or stops).
- **Nest** (js/systems/nest.js): egg slots = `nestEggSlotsByTier[tier - 1]` (0 while unbuilt).
  `nest/place { item, slot }` takes an egg item from the bag and rolls its archetype (any of the four)
  and quality (`rollQuality` with the egg's `egg.bands`, at least `egg.min`). It hatches after
  `nest.hatchHours x (1 - nestHatchCutPerTier x (tier - 1))`; then `nest/hatch { slot, name }` makes
  the pet (needs a free pet space). Eggs wait in the bag until there is a slot; ready eggs wait in the Nest.
- **Release:** `pets/release { pet }` (not the last pet) gives the archetype's `release` items.
- **Boundaries:** taming and treasure export `nextBoundaryMs` (a trap finishing, an escaped encounter
  leaving, the current dig finishing) so a caught pet or a resumed harvest starts at the same moment
  live and offline.

### Events (Phase 7)

```js
{ type: 'tracked', zone, xp }                       // one tracking action (folded into workers.player)
{ type: 'encounter', zone, archetype, quality }     { type: 'encounterGone', zone }
{ type: 'trapSet', zone, chance }                   { type: 'trapDone', ...TrapResult }
{ type: 'lureStarted', item, msLeft }               { type: 'lureEnded' }
{ type: 'dig', zone, coins, items: { key: n } }     // items include any relic or egg
{ type: 'eggPlaced', slot, archetype }              { type: 'eggReady', slot }
{ type: 'petReleased', pet, name, items }
```
Summary additions: `taming: { found: [{ zone, archetype }], results: [TrapResult], lureEnded }`,
`treasure: { digs, coins, items: { key: n } }`, `nest: { ready: n }`. Tracking actions count in
`workers.player` (`actions`, `xp.taming`).

### Commands (Phase 7)

`taming/track { zone }`, `taming/setTrap { zone, trap: key, bait: key | null }`, `taming/letGo { zone }`
(drops an encounter with no trap), `taming/useLure { item }`, `taming/seen`, `treasure/dig { zone }`,
`nest/place { item, slot }`, `nest/hatch { slot, name }`, `pets/release { pet }`.
`harvest/stop { worker: 'player' }` also stops tracking or digging. Test mode: `dev/encounter { zone,
archetype?, quality? }`, `dev/finishTimers` (every trap, egg and the current dig finish on the next tick).

### Selectors (Phase 7)

- taming.js: `isHarvestTask(data, task)`, `trackMs(state, data, zone)`, `revealChance(state, data)`,
  `catchChance(state, data, zone, trapKey, baitKey) -> { chance, base, trap, bait, level, capped }`,
  `encounterInfo(state, data, zone) -> null | { archetype, species, quality | null, hint, special, msLeft, trap: null | { item, bait, chance, msLeft } }`,
  `trapOptions(state, data, zone) -> [{ key, item, tier, count, ok, reason }]`,
  `baitOptions(state, data, zone) -> [{ key, item, count, match }]`,
  `trapCheck(state, data, zone) -> { ok, reason }`, `freePetSpaces(state, data)`,
  `lureInfo(state, data) -> null | { item, def, msLeft, bands }`, `lureList(state, data)`, `tamingNotice(state)`,
  `rollQuality(stream, data, { bands, luck, min })`.
- treasure.js: `mapItemFor(data, zone)`, `mapCount(state, data, zone)`, `digMs(state, data)`,
  `digInfo(state, data, zone) -> { maps, ms, total, digging }`, `mapList(state, data) -> [{ zone, item, count }]`.
- nest.js: `eggSlots(state, data)`, `hatchMs(state, data)`,
  `nestList(state, data) -> [{ slot, egg | null, archetype, msLeft, total, ready }]`,
  `eggList(state, data) -> [{ key, item, count }]`, `nestNotice(state)` (an egg is ready).

### Data (Phase 7)

- items.json categories `trap`, `bait`, `lure`, `egg`, `map`, `relic`. Item fields: `trap { tier }`,
  `bait { dish }` (fruit | nut | fish | meat), `lure { minutes, bands }`, `egg { bands, min? }`,
  `map { zone }`. Items: trap frames (Workbench), trap springs (Forge), traps tiers 1-5 assembled at the
  Workbench (pine / oak / cedar / willow / ashwood frames with copper / iron / steel / mythril / emberite
  springs), four baits (Kitchen), the wild lure (Alchemy), the strong lure and rare egg (merchant),
  `treasure_egg`, `sanctuary_relic`, one map per zone with harvesting.
- data/treasure.json: `{ "eggItem": "treasure_egg", "relicItem": "sanctuary_relic",
  "loot": { "1": [{ "item", "qty": [min, max], "weight" }], ... "5": [...] } }`.
- pets.json archetypes gain `release: { itemId: n }`.
- achievements.json `when.kind` gains `tamed { n }`, `digs { n }`, `hatched { n }`.

### balance.json additions (Phase 7)

`taming { trackSeconds, xpPerTrackSecond, revealBase, revealPerLevel, qualityRevealLevel, specialFrom,
qualityLuckPerLevel, trapMinutes, catch { base, perTrapTier, bait, perLevel, cap }, trapKeptOnCatch,
trapKeptOnEscape, escapeStayHours, catchXp, maxResults }`, `treasure { mapChance { fishing, other },
petLuckMapMult, digMinutes, shovelSpeedPerTier, eggChance, byTier { coins, rolls, relic } }`,
`nest { hatchHours }`.

## Phase 8: evolution

### Save schema v7 (migration 6 -> 7)

```js
pet: + rng,                         // the pet's own stream (petSeed in core/state.js): talent offers, gift talents, favorite dish
       offer: null | [talentId],    // the choices for its next talent pick
       favorite: itemId | null,     // personal favorite dish (a meal up to bond.personalDishMaxTier), rolled at birth
       favoriteKnown: false,        // revealed the first time it eats that dish
       gifts: [talentId], talents: [talentId]   // (fields existed since v3, now used)
crafting: + assists: { stationId: petId }      // one adult assistant per station
bestiary: { entryId: { qualityId: true } }      // stars collected (js/systems/bestiary.js)
stats: + evolved { juvenile, adult }, talentPicks, petGifts
workers[petId]: + resume (a Scout pet's harvest task while it digs); task may be { zone, skill: 'treasure', node: 'dig' }
```
Migration gives every pet a stream, an empty offer and an unknown dish; `pets.init` rolls missing gift
talents (a Rare+ pet from before Phase 8 gets them on load) and the dish, and offers any pick already due.

### Rules

- **Evolution** (`pets/evolve`): a hatchling at `stageLevelCaps[0]` chooses a branch whose calling skill it
  has done `callingActions` times (`pet.actions`). A juvenile at `stageLevelCaps[1]` with Bond heart
  `evolve.adultHearts` uses one of its branch's `catalyst` (Alchemy Lab) and becomes an adult. Banked XP then
  counts toward the new stage. Permanent.
- **Effects** (js/systems/petstats.js `petEffects`, `effectValue`): branch `strength` (x1 juvenile, x
  `evolve.adultStrengthMult` adult) + gift talents + chosen talents. Kinds (`EFFECT_KINDS`; value meaning):
  `speed` (+fraction work speed, optional `skills`), `rare` (+absolute rare chance, skills), `extraItem` (chance of +1
  main drop, skills), `byproduct` (drops with chance < 1 x (1+v), skills), `maps` (map chance x (1+v)), `drain` (-fraction),
  `stamina` (+fraction max energy), `rest`, `meal` (+fraction energy from food), `bond` (+fraction Bond from every source),
  `xp` (+fraction pet XP), `track` (+absolute reveal chance; the best active pet), `garden` (+fraction Garden yield; the best of
  all pets; the fraction is a chance of one more), `gift` (Heart gift chance x (1+v)), `dig` (Scout: can dig; dig speed +v).
- **Talents** (data/talents.json): picks at `talents.pickLevels`; each pick offers `talents.choices` from the hatchling pool
  (pick levels up to `stageLevelCaps[0]`) or the branch's pool (later), never one the pet holds; a short pool is topped up from
  the hatchling pool. Offers are rolled when a pick comes due (level up, evolve, previous pick) and wait until chosen.
  Gift talents: `qualities.<q>.gifts` from the gift pool, at birth.
- **Favorite dish:** eating `pet.favorite` (hand or auto) gives `bond.personalDish` Bond (plus the archetype dish Bond if it also
  matches) and reveals it.
- **Heart gifts:** at heart `heartGifts.minHearts`+, each Bond point from work rolls `chancePerBondPoint x (1 + gift)` for one pick
  from data/treasure.json `loot[zone tier]` (worker stream).
- **Station assist** (`pets/assist`): an adult, stabled pet whose branch `assist.station` matches; the station must be built. The
  station then runs on its own (not in `crafting.working`, no player slot) with `assist.speed` added to its speed and its
  quality odds x (1 + `assist.quality`) before the Focus caps. Making the pet active or releasing it ends the post; `crafting.init`
  drops invalid posts. One assistant per station (posting a second replaces the first).
- **Scout digging:** `treasure/dig { zone, worker: petId }` for an active pet with a `dig` effect. The pets system advances it
  like work (energy drain, rest, feeding, Bond); a dig takes `digMs / (1 + dig)` (the player's Shovel), uses the map, rolls the
  reward from the pet's worker stream, gives `treasure.petDigXp` pet XP. No maps left: back to its `resume` harvest task, or idle.
  `pets.nextBoundaryMs` stops the tick where a pet's dig would finish.
- **Bestiary** (js/systems/bestiary.js): 4 hatchlings + 8 juveniles + 8 adults + 4 mythics (pets.json `mythics`, Phase 9) =
  24 entries x 5 qualities. A star is recorded when a pet of that form and quality is created or evolves; `init` records every
  current pet.

### Events (Phase 8)

```js
{ type: 'petEvolved', pet, form, branch, species }   { type: 'talentReady', pet }   { type: 'talentPicked', pet, talent }
{ type: 'petGift', pet, item, qty }   { type: 'favoriteFound', pet, item }   { type: 'assistSet', pet, station }
{ type: 'bestiary', entry, quality }  { type: 'petAte', ..., personal }  { type: 'dig', ..., worker }
```
Summary additions: `pets[id].gifts { item: n }`, `.digs`, `.talentReady`, `.favorite`; `bestiary: [{ entry, quality }]`.

### Commands (Phase 8)

`pets/evolve { pet, branch? }` (branch only for the first evolution), `pets/pickTalent { pet, talent }`,
`pets/assist { pet, station | null }`, `treasure/dig { zone, worker? }`.
Test mode: `dev/petCalling { pet }`, `dev/petReadyToEvolve { pet }` (level cap, callings, heart 3, its catalyst), `dev/catalysts`.

### Selectors (Phase 8)

- petstats.js: `branchDef(data, archetype, branch)`, `petSpecies(data, pet)`, `talentDef(data, id)`, `petEffects`, `effectValue(data,
  pet, kind, skill?)`, `bestEffect(data, pets, kind)`, `effectText(data, effect) -> string`, `canDig(data, pet)`, `EFFECT_KINDS`,
  `petRareBonus(data, pet, skill?)`.
- pets.js: `evolveInfo(state, data, petId) -> { stage, form, next: 'juvenile'|'adult'|null, levelNeed, level, ready, reason,
  branches: [{ ...branchDef, have, need, unlocked }], hearts, heartsNeed, catalyst: { item, have } | null }`,
  `talentInfo(state, data, petId) -> { gifts: [id], picks: [{ level, talent|null }], due, offer: [id] | null }`,
  `assistInfo(state, data, petId) -> { station, posted, can, reason, bonus: { station, speed?, quality? } | null }`,
  `assistValid`, `petNotice(state, data)` (Pets tab badge: evolve ready or a talent to pick), `talentPicksDue(data, pet)`,
  `petDigMs(state, data, pet)`.
- crafting.js: `assistantOf(state, stationId)`, `assistBonus(state, data, stationId) -> { speed, quality }`; `stationList`
  entries gain `assistant` and status `'assisted'`.
- garden.js: `gardenBonus(state, data)`.
- bestiary.js: `entryIdOf(pet)`, `bestiaryList(state, data) -> [{ id, archetype, branch, form, species, desc, role, stars: { q: bool },
  count, seen }]`, `bestiaryStars(state, data) -> { have, max, seen, entries }`.

### Data (Phase 8)

- pets.json archetype `bestiary` (hatchling text); branch `catalyst`, `strength: [Effect]`, `assist: { station, speed?, quality? } | null`,
  `juvenile` / `adult: { species, desc }`; `mythics: [{ archetype, species, desc }]`; lines `evolved` ({name} {species}),
  `gift` ({name} {item}), `favorite` ({name} {food}).
- data/talents.json: `{ pools: { hatchling, <branchId> x8, gift: [id] }, talents: { id: { name, desc, effects: [Effect] } } }`.
  Effect: `{ kind, value, skills? }`.
- items.json category `catalyst` (8 items, Alchemy Lab recipes). achievements `when.kind` gains `evolved { form, n }`,
  `bestiary { n }` (stars), `talentPicks { n }`, `petGifts { n }`.

### balance.json additions (Phase 8)

`pets.bond.personalDish`, `pets.bond.personalDishMaxTier`, `pets.evolve { adultHearts, adultStrengthMult }`,
`pets.talents { pickLevels, choices }`, `pets.heartGifts { minHearts, chancePerBondPoint }`, `treasure.petDigXp`.

## Phase 9: endgame

### Save schema v8 (migration 7 -> 8)

```js
sanctuary: {
  project: 0,                  // index into data/projects.json of the project being built (= projects.length when all are done)
  stage: 0,                    // stage of that project (0..stages-1)
  delivered: { itemId: n },    // delivered toward the current stage (any quality counts; stored by base item id)
  coins: 0,                    // coins delivered toward the current stage
  done: [projectId],           // finished projects, in order
  scenes: [projectId],         // finished projects whose scene the player hasn't watched yet (Home plays them)
},
story: { got: { entryId: true }, seen: { entryId: true } },   // data/story.json entries unlocked / read
elders: {
  open: false,                 // the Elder Grove appears once any pet reaches balance.elders.openLevel
  list: [Elder],               // retired pets, oldest first
  eggs: [HeirEgg],             // heir eggs waiting to go in the Nest
  rng,
},
taming: + mythicMs: 0          // game time until another mythic encounter may appear (cooldown)
pet: + heirloom: null | talentId,   // an extra talent inherited from its elder parent (counts as a talent effect)
       parent: null | elderId       // the elder it hatched from
     form may be 'mythic' (single-form mythic pets; branch null)
nest slot: + heir: null | { elder, heirloom }   // an heir egg (item 'heir_egg'); archetype and quality fixed at retirement
stats: + retired          (mythics ever had are counted from the Bestiary)
// Elder: { id (the pet's id), name, archetype, form, branch, quality, species, level, bornAt, retiredAt,
//          days, actions (lifetime harvest actions), talents, gifts, heirloom }
// HeirEgg: { elder, archetype, quality, heirloom }
```
Migration: empty sanctuary at project 0, empty story/elders, `mythicMs: 0`, `heirloom: null` and `parent: null` on every pet.
`elders.init` opens the Grove for a save that already has a level-30 pet; `story.init` unlocks what a save already earned (unread).

### Rules

- **Grand Projects** (js/systems/sanctuary.js): open at Renown `balance.sanctuary.openRenown`, done in data order, 3 stages
  each. `sanctuary/deliver { item?, qty? }` moves items (Normal first, then better qualities) or coins (`item: 'coins'`)
  from the bag toward the current stage, never more than still needed; no `item` = everything the player can give. When
  every need of the stage is met the stage completes at once: `balance.sanctuary.renownPerStage` Renown XP, next stage;
  after the last stage the project is done (pushed to `done` and `scenes`) and its `reward` applies forever.
- **Rewards** (`sanctuaryBonus(state, data, kind, skill?)`, sum over finished projects): `craftSpeed` (added to every
  station's speed), `petRest` (added to the rest-rate multiplier), `mealStrength` (meals: x(1+v) energy for pets and
  speed for the player's meal buffs), `garden` (added to gardenBonus), `speed { skills }` (added to harvest speed for
  every worker), `reveal` (+ tracking reveal chance), `heartgrove` (no value; zones with `unlock.grandProject: n` open
  when `done.length >= n`).
- **Story** (js/systems/story.js): data/story.json entries unlock when their `when` condition holds (any achievement
  condition kind, see below). Checked after every command and every advance. `story/seen { entry? }`.
- **Mastery** (js/systems/skills.js): XP past `skills.maxLevel` keeps adding to the skill's `xp`. Star k (1..maxStars)
  costs `xpToNext(maxLevel + k - 1)`; `masteryStars(state, data, skill)`. Each star: `skills.mastery.speedPerStar` player
  speed in that skill (harvest actions, crafting at its station, tracking for Taming), up to `maxStars`.
- **Starmetal**: tools.json tier 7 has `prestige: true`; a tool of a prestige tier adds `harvest.prestigeSpeed` to harvest
  speed (like tool quality, for every worker). Shovels go faster through `shovelSpeedPerTier` as before.
- **Mythics** (taming.js): a zone with `mythics: true` (Heartgrove) reveals a mythic encounter instead of a normal one
  with chance `taming.mythic.revealShare` while `taming.mythicMs` is 0; it then waits `mythic.cooldownHours` of game time.
  The archetype is one whose mythic the player has never had (Bestiary), else any. The encounter has `mythic: true`. It
  needs a trap with `trap.mythic` and bait with `bait.mythic` (both required); chance = `min(mythic.cap, mythic.catchBase +
  mythic.catchPerLevel x Taming level)`. Caught: a pet with `form: 'mythic'` (stage 3, level cap 30, no evolution); its
  effects add pets.json `mythics[].strength`; talent picks after level 10 come from talents.json pool `mythic`.
- **Elder Grove** (js/systems/elders.js): opens when any pet reaches `elders.openLevel`. `elders/retire { pet, heirloom }`:
  an adult or mythic pet at `retireLevel` with Bond heart `retireHearts`, not the last pet. It leaves the roster (posts and
  worker removed) and becomes an Elder. Heir egg: same archetype; quality = the parent's with chance `heir.matchChance`, else
  rolled with a floor `heir.bandsBelow` bands below the parent, capped at the parent's (elders stream). `heirloom` must be one
  of the parent's talents, gifts or heirloom (null only when it has none). `nest/placeHeir { egg, slot? }` puts it in the
  Nest as `{ item: 'heir_egg', archetype, quality, msLeft, heir: { elder, heirloom } }`; hatching sets `pet.heirloom`, `pet.parent`.
- **Legacy bonus** (`legacyEffects(state, data) -> [Effect]`, `legacyValue(state, data, kind, skill)`): each branch's
  `legacy.skills` (pets.json) get `elders.branchBonus x elders.stack[i]` for its i-th elder (the last value repeats); each
  mythic elder gives `elders.mythicBonus` to every harvest skill. Effects are kind `speed`; they multiply every pet's
  harvest speed.

### Events (Phase 9)

```js
{ type: 'delivered', items: { id: n }, coins }     { type: 'projectStage', project, stage }   // stage just finished (0-based)
{ type: 'projectDone', project }                     { type: 'story', entry }
{ type: 'masteryStar', skill, stars }                { type: 'retired', pet, name, egg: HeirEgg }
{ type: 'groveOpened' }                              { type: 'encounter', ..., mythic: true }
```
Summary additions: `mastery: { skill: stars }`, `story: [entryId]`.

### Commands (Phase 9)

`sanctuary/deliver { item?, qty? }`, `sanctuary/sceneSeen { project }`, `story/seen { entry? }`,
`elders/retire { pet, heirloom }`, `nest/placeHeir { egg, slot? }`.
Test mode: `dev/stageNeeds` (grant what the current stage still needs), `dev/finishStage` (complete it for free; Renown is
raised to the opening rank if needed), `dev/readyToRetire { pet }` (level 30 and Bond heart 5; a younger pet first becomes an
adult of its first branch), `dev/masteryStars { skill, stars }`, `dev/encounter { ..., mythic: true }`, `dev/endgameKit`
(a Starmetal trap and mythic bait).

### Selectors (Phase 9)

- sanctuary.js: `projectList(state, data) -> [{ ...def, index, status: 'done'|'current'|'locked' }]`,
  `currentStage(state, data) -> null | { project, index, stage, stages, needs: [{ item, need, have, bag }], ready }` (item
  'coins' for the coin need; have = delivered, bag = what the player could still give), `sanctuaryOpen(state, data)`,
  `sanctuaryBonus`, `projectsDone(state)`, `ended(state, data)`, `rewardText(data, reward) -> string`,
  `sanctuaryNotice(state, data)` (Home badge: something can be delivered, or a scene waits), `pendingScene(state)`.
- story.js: `storyList(state, data) -> [{ ...entry, seen }]` (unlocked entries, data order), `storyNotice(state)` (unread).
- elders.js: `groveOpen(state)`, `elderList(state, data) -> [{ ...elder, role, bonus: [string] }]`,
  `retireInfo(state, data, petId) -> { can, reason, heirlooms: [talentId], match, floor }`, `legacyEffects`, `legacyValue`,
  `legacyLines(state, data) -> [string]`, `heirEggList(state, data) -> [{ index, archetype, quality, heirloom, elder }]`.
- skills.js: `masteryStars(state, data, skill)`, `masteryProgress(state, data, skill) -> { stars, max, xp, next, speed }`,
  `masterySpeed(state, data, skill)`.
- taming.js: `encounterInfo` gains `mythic`; `trapOptions`/`baitOptions`/`catchChance` follow the mythic rules.
- petstats.js: `petRole` and `petSpecies` know mythics; `mythicDef(data, archetype)`.
- nest.js: `nestList` entries gain `heir: null | { elder, heirloom, name }` (name = the elder parent's name).
- pets.js: `createPet(state, ctx, { archetype, quality, name, mythic?, heirloom?, parent? })`.

### Data (Phase 9)

- data/projects.json: `{ projects: [{ id, name, blurb, leans: [skillId], reward: [{ kind, value, skills? }], rewardText,
  stages: [{ name, items: { itemId: n }, coins }] }] }` (relics are items: `sanctuary_relic`).
- data/story.json: `{ entries: [{ id, title, text: [paragraph], when: Condition }], scenes: { projectId: { title, lines: [string] } } }`.
- achievements.json (and story) condition kinds gain `start`, `projects { n }`, `project { project }`, `retired { n }`,
  `mastery { n }` (stars in all skills), `mythics { n }`, `perfectPet` (Legendary, 2 gifts, 6 talents), `story { n }`.
- pets.json: forms + `{ id: 'mythic', stage: 3, name: 'Mythic' }`; `mythics[]` gain `strength: [Effect]`; branches gain
  `legacy: { skills: [skillId] }`. talents.json pool `mythic`.
- zones.json heartgrove: tier 6 harvest, rares, `mythics: true`, scene. tools.json tier 7 `prestige: true`.
  items.json: Heartgrove materials, the elderwood and starmetal chains, `elderwood_trap` (tier 6), `starmetal_trap`
  (`trap { tier: 7, mythic: true }`), `mythic_bait` (`bait { dish: null, mythic: true }`), `heir_egg`, `heartgrove_map`.

### balance.json additions (Phase 9)

`skills.mastery { speedPerStar, maxStars }`, `harvest.prestigeSpeed`, `sanctuary { openRenown, renownPerStage }`,
`elders { openLevel, retireLevel, retireHearts, branchBonus, stack, mythicBonus, heir { matchChance, bandsBelow } }`,
`taming.mythic { revealShare, cooldownHours, catchBase, catchPerLevel, cap }`, `treasure.byTier.*` gain a tier 6 entry,
`render.mythicScale`.

## Phase 10: tune and ship

No save schema change (still version 8). Contract changes:

### Audio (js/ui/audio.js, data/audio.json)

- `createAudio(game)` (main.js, exposed as `app.audio`): `setScene(name)` picks the music (a key of audio.json `music`:
  `home`, `mossbrook` or a zone id; an unknown scene keeps the current track), `getScene()`, `debug()`.
  Shell: the Home tab sets `home`; world.js sets the open zone; mossbrook.js sets `mossbrook` and restores the previous scene.
- Nothing plays before the first tap (`pointerdown`/`touchend`/`keydown` creates the AudioContext; the two music
  `<audio>` elements are unlocked with a silent clip inside that tap for iPhone Safari). Music: fetched as a Blob, played
  by an `<audio>` element through a GainNode (crossfade `balance.audio.musicFadeMs`); never decoded whole. SFX: decoded
  once into buffers. Throttles: `sfxMinGapMs` per sound, `sfxMaxPerSecond` overall. Ogg not playable: music stays off.
- Sound effects come from live events only (`game.onEvents`; catch-up never plays sounds): audio.json `events`
  (event type -> sfx id) and `harvestBySkill` (the player's harvests, only while the World tab shows that zone);
  a quiet `uiTap` on button presses. Toggles: `state.settings.music` / `.sound` (in the save).
- Offline: SFX are precached (sw.js FILES). Music (~9 MB) is in sw.js `MUSIC`, cached on first play in the
  unversioned `petcraft-music` cache (kept across updates); check-precache.ps1 checks both lists.
- balance.json `audio { musicVolume, sfxVolume, musicFadeMs, sfxMinGapMs, sfxMaxPerSecond }`.

### Test mode is not shipped

- The test mode panel and its commands moved to `tools/dev/devpanel.js` and `tools/dev/dev.js` (not in sw.js, not in
  SYSTEMS). `registerCommands(commands)` in js/core/game.js adds them; the Journal imports the panel only when the page
  is served from localhost/127.0.0.1 (tap the version line 5 times). tools/tests/core.html registers them itself.

### Performance

- `harvest.actionProfile(state, data, workerId, prev)`: one worker's per-action values (duration, XP, drop modifiers,
  rare and map chances), reused while the task object, the pet's level and hearts (or the player's Mastery stars in that
  skill) stay the same. harvest.advance and pets.advancePet pass it to `completeAction(state, ctx, workerId, profile)`.
  Results are identical to computing everything per action (checked against the Phase 9 code on a 60-day save).
- Lookups by id (zones, skills, harvest nodes, archetypes) use cached Maps; Mastery stars use cached thresholds;
  `petEffects` checks its cache without building a string. 16 h catch-up on a 60-day save: ~70 ms cold, ~55 ms warm on
  a desktop (was ~240 / ~195). main.js records the last launch catch-up per device (`petcraft.device.lastCatchUp`);
  Journal -> App shows it, so it can be read on a phone.

### Saves

- `createInitialState(now, seed?)`: an optional seed makes every random stream reproducible (the simulator passes it).
- tools/tests/saves.html: makes real saves with every old version's own code (tools/tests/extract-old.ps1 extracts
  them into the gitignored tools/tests/old/), upgrades and plays them with today's code and checks nothing is lost;
  plus damaged saves, the backup slot, storage full, export/import, the clock rules and catch-up speed.

### Other

- iPhone install guide (pwa.js): explains that the Home Screen app keeps its own save, and copies the game across with
  a save code first.
- Journal -> Your save -> Start a new game (after a confirmation sheet): `app.startNewGame()` stops saving, then
  `startFresh(state, now)` (save.js) writes a new game and deletes the backup and damaged copy (nothing is deleted if the
  write fails); the page reloads into the egg choice. The device prefs tab, worldZone and lastCatchUp are cleared.
