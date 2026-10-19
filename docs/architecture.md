# PetCraft architecture notes (lead-owned)

The contract between the simulation core and everything else. Only the lead changes the state
schema, the system interfaces or the structure of `data/balance.json`. Subagents build against
this file.

## Save state (schema version 4)

```js
{
  version: 4,
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
