# PetCraft — Game Design Document

Oct 18, 2026 · @Rob

## Overview

PetCraft is a cozy, mobile-first idle game. You raise evolving monster pets who harvest the world for you while you craft, grow a homestead, and restore an ancient monster sanctuary. There is no combat.

- **Genre:** idle harvesting, managed crafting, pet raising, homestead building.
- **Platform:** browser game on GitHub Pages, installable to a phone's home screen, portrait layout.
- **Session shape:** 2–5 minute check-ins several times a day. The world keeps working while you're away.
- **References:** Melvor Idle (skill depth), Palworld (monsters doing the work), Digimon and Pokémon (evolution), Stardew Valley (a homestead you watch grow).

**Design pillars**

1. **Pets are partners.** Bond, evolution and legacy make each pet feel like yours.
2. **Everything feeds back.** Every crafted item makes harvesting better: tools open tiers, buildings add bonuses, meals fuel pets, traps find new pets.
3. **Growth you can see.** The homestead, the player and the pets visibly change.
4. **Absence is never punished.** Idle progress plateaus when you're away; nothing decays, starves or withers.

## Locked decisions

These were agreed in planning and should not change without Rob's say-so.

| Area | Decision |
| --- | --- |
| Combat | None. Zones are gated by Renown and tool tier. |
| Player progression | No overall player level. Ten skill levels are the player's progression; Renown is the account level. |
| Skills at launch | 5 harvesting (Chopping, Mining, Foraging, Fishing, Hunting), 4 crafting (Carpentry, Smithing, Cooking, Alchemy), plus Taming. |
| Building | A homestead action, not a skill. |
| Player role | Tools unlock each material tier. Best odds on rare finds. Owns crafting, taming and early treasure digging. |
| Pet role | Bulk idle harvesting at any unlocked tier. Evolved pets can assist a crafting station. |
| Active pets | 2 active; the Stable holds the rest. |
| Upkeep | One energy bar per pet. Rest refills it slowly, food quickly. Auto-rest and auto-feed. |
| Crafting | Each station runs its own queue, offline too. Optional Focus timing tap for quality. |
| Evolution | Player picks the branch. Branches unlock from what the pet has done (callings). Final stage needs Bond 3 and an Alchemy catalyst. |
| Quality | Sets stat growth and innate Gift talents. Shown with palette and aura, not new sprites. |
| Taming | Tracking finds a monster; a crafted trap and bait catch it. Replaces separate pet search and trapping. |
| Treasure | Maps drop while harvesting and are dug up on the world map. |
| Economy | Village market with coins. No storage caps. |
| Endgame | Five Grand Projects end the story and open the Heartgrove. Long tail of collection and mastery. Elder Grove legacy loop; the player never resets. |
| Art | Ninja Adventure pack (CC0), 16×16 top-down pixel art. No paid licenses. |
| Format | Multi-file static site on GitHub Pages, installable PWA. PixiJS as a local file. No CDN, no build step. |
| Build | Opus 5.5 leads in Claude Code and delegates bounded work to Sonnet and Haiku. |

## Story frame

Restoring the Old Sanctuary is the story, and finishing it is the ending. Names below are working names.

- **Setup:** You inherit an overgrown plot at the edge of the Wildwood, beside the ruins of the Old Sanctuary, where people and monsters once lived together.
- **First pet:** In the ruins you find four eggs, one per archetype. You choose one, it hatches, and you name it.
- **Neighbors:** The village of Mossbrook sits down the road. Its market and commission board are your link to the wider world, and villagers' notes carry small story hints.
- **Arc:** Five Grand Projects rebuild the Sanctuary piece by piece. Each completed project plays a short scene on the homestead and adds a journal entry.
- **Ending:** The fifth project, the Heart Shrine, reawakens the Sanctuary. Wild monsters return, and the Heartgrove opens as the post-ending zone.
- **Delivery:** Journal entries, commission notes and short scenes. No dialogue trees.

## Core loop and time model

Three workers harvest, four stations craft, and everything crafted makes the next round of harvesting better. The world runs in real time, including offline up to a cap.

&#91;embedded content: core loop · 3 workers, 4 stations, 5 kinds of output\]

Zones become materials, stations turn materials into outputs, and each output loops back to make harvesting faster, deeper or wider.

**Workers and stations**

- **Three workers:** the player plus two active pets. Each works one task in one zone until reassigned.
- **Player tasks:** harvest (any of the 5 skills), track monsters, or dig a treasure site. One at a time.
- **Stations:** each crafting station runs its own queue in parallel with the workers, offline too.
- **Actions:** every harvest action has a base duration (about 3–6 seconds at tier 1, longer at higher tiers) and yields items plus skill XP.

**Offline progress**

- On return, the game simulates the time away, up to the offline cap: 8 hours, plus 2 hours per Cottage tier above 1 (16 hours at tier 5).
- A "While you were away" summary shows what each worker and station produced.
- The player has no energy and works until the cap. Pets are limited by energy (below), which makes food worth stocking.

**Pet energy**

- Energy runs 0–100 (Stamina raises the max). Working drains about 33 per hour, so a full bar lasts about 3 hours.
- At 0 a pet auto-rests until full. Base rest rate is 100 per hour, +20% per Stable tier.
- With auto-feed on, a pet eats from the pantry when energy drops below 25%. Auto-feed uses cooked food only (meals 20–60, pet tonics); raw food (10–20) can still be hand-fed. Pets bring back far more raw food than they could ever eat, so letting them eat it on their own would mean they never rest.
- Without cooked food a pet works about 75% of the time; with meals stocked, close to 100%. Keeping the pantry stocked is a Kitchen job.

**Session loop**

1. Open the game and read the "While you were away" summary.
2. Collect finished crafts and refill station queues.
3. Build or upgrade, and deliver commissions.
4. Reassign the three workers; check traps and dig sites.
5. Pat each pet once (daily Bond).

**Long loop:** higher skills → better tools → new material tier → new recipes and buildings → new zones and pets → evolutions → Grand Projects.

## Skills and progression

The player has ten skills, each leveled 1–60, with a new material tier every 10 levels. Renown is the account-wide level.

| Skill | Type | Produces | Needs |
| --- | --- | --- | --- |
| Chopping | Harvest | logs, sap, seeds | Axe |
| Mining | Harvest | ore, stone, coal, gems | Pickaxe |
| Foraging | Harvest | herbs, berries, mushrooms, fiber | Sickle |
| Fishing | Harvest | fish, shells, treasure maps | Fishing rod |
| Hunting | Harvest | meat, hide, sinew, bone, feathers | Bow |
| Carpentry | Craft | planks, handles, bows, rods, trap frames, building parts | Workbench |
| Smithing | Craft | bars, nails, tool heads, fittings, trap springs | Forge |
| Cooking | Craft | meals, pet treats, bait | Kitchen |
| Alchemy | Craft | potions, tonics, lures, fertilizer, evolution catalysts | Alchemy Lab |
| Taming | Special | tracking monsters, setting traps | Traps (crafted) |

- **Levels:** 1–60 per skill. Material tiers open at levels 1, 10, 20, 30, 40 and 50.
- **XP curve (starting point):** XP to next level = 40 × L^1.5 + 60. The balance simulator sets the final curve.
- **Mastery:** past level 60, each further level's worth of XP earns a Mastery star: +0.5% speed in that skill, capped at +25%.
- **Pets** level separately (see Pets).
- **Renown:** ranks 1–30, earned from commissions, achievements, first-time crafts, building upgrades and Grand Projects. Ranks unlock zones, buildings and outfits (see Village and economy).

## World

Six zones, one per material tier. Every zone supports all five harvesting skills, so pets can work anywhere you've unlocked.

| Zone | Tier | Unlocks at | Wild archetypes | Chopping | Mining | Foraging | Fishing | Hunting |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Meadowfold (home) | 1 | Start | Sprout, Wild | pine log | stone, copper ore | meadow herbs, berries, fiber | minnow | rabbit |
| Whisperwood | 2 | Renown 3 | Sprout, Tide | oak log | iron ore | mushrooms, honeycomb | brook trout | deer |
| Stonecrag Hills | 3 | Renown 6 | Stone, Wild | cedar log | coal, gems | mountain sage | rock bass | boar |
| Mistfen Marsh | 4 | Renown 10 | Tide, Stone | willow log | mythril ore | bog lilies | marsh eel | marsh fowl |
| Emberfall Caldera | 5 | Renown 15 | Stone, Wild | ashwood log | emberite ore | fire blooms | lava crab | ember ram |
| Heartgrove | 6 | Grand Project 5 | all four + mythics | elderwood | starmetal ore | moonpetals | star carp | gilded pheasant |

**Rules**

- **Zone unlock:** Renown rank (Heartgrove: the ending).
- **Tier access:** harvesting a tier-N material needs the player's tier-N tool for that skill. Pets can harvest any tier the player's tools have opened.
- **Each zone's ore makes the next tier's tools** (see Player tools), so every zone pulls you toward the next.
- **Hunting** yields meat plus a by-product: hide and sinew (rabbit, deer), tusk and bone (boar), feathers (fowl, pheasant), horn (ram).
- **Rare finds:** base 1% per action, raised by tool quality, Luck and talents. Examples: gems in Stonecrag, pearls while fishing, treasure maps anywhere.
- **Each zone also has** wild monster encounters, treasure dig sites and its own scene with your workers animating.

## Player tools

A tool's tier decides which materials you and your pets can harvest; its quality decides how well you harvest them.

| Tier | Metal | Made from | Opens |
| --- | --- | --- | --- |
| 1 | Stone | given at start | Meadowfold |
| 2 | Copper | copper ore (Meadowfold) | Whisperwood |
| 3 | Iron | iron ore (Whisperwood) | Stonecrag Hills |
| 4 | Steel | iron bar + coal (Stonecrag) | Mistfen Marsh |
| 5 | Mythril | mythril ore (Mistfen) | Emberfall Caldera |
| 6 | Emberite | emberite ore (Emberfall) | Heartgrove |
| — | Starmetal | starmetal ore (Heartgrove) | no new tier; +15% speed prestige tools |

- **Five harvesting tools:** Axe, Pickaxe, Sickle, Fishing rod, Bow. Plus a **Shovel** for digging treasure (its tier only changes dig speed).
- **Recipes:** axe, pickaxe and sickle = metal head (Forge) + wooden handle (Workbench), assembled at the Forge. Rods and bows are made at the Workbench from wood, metal fittings and string (fiber or sinew).
- **Skill gate:** crafting a tier-N tool needs Smithing and Carpentry at level 10 × (N − 1).
- **Quality:** Normal / Fine / Masterwork = +0% / +10% / +20% speed and +0 / +1 / +2 points of rare-find chance.
- **Player edge over pets:** double rare-find chance, the only one who sets traps, and the only digger until Scout pets arrive.
- **Looks:** the player's outfit changes at Renown 5, 10, 15, 20 and 25 (cosmetic only). The held tool shows during harvesting.

## Pets

Pets do the bulk of the harvesting. Four archetypes, five quality bands, one energy bar and a Bond meter define each one.

**Stats**

- **Level:** 1–30, from XP earned while working. Each evolution stage caps the level (10, 20, 30); extra XP is banked.
- **Work speed:** multiplies action speed.
- **Stamina:** raises max energy and lowers drain.
- **Luck:** raises rare-find and treasure-map chance.

**Archetypes**

| Archetype | Affinity (+25% speed) | Favorite food | Found in |
| --- | --- | --- | --- |
| Sprout | Foraging, Chopping | fruit and berry dishes | Meadowfold, Whisperwood |
| Stone | Mining | roasted nut and root dishes | Stonecrag, Mistfen, Emberfall |
| Tide | Fishing | fish dishes | Whisperwood, Mistfen |
| Wild | Hunting | meat dishes | Meadowfold, Stonecrag, Emberfall |

Any pet can do any harvesting task; affinity just makes it faster. Each pet also has a personal favorite dish, revealed the first time you feed it that dish.

**Quality**

| Quality | Stat growth | Gift talents | Look | Base odds |
| --- | --- | --- | --- | --- |
| Common | ×1.00 | 0 | base palette | 60% |
| Uncommon | ×1.15 | 0 | base palette | 28% |
| Rare | ×1.30 | 1 | soft sparkle | 9% |
| Epic | ×1.50 | 1 | shifted palette + sparkle | 2.5% |
| Legendary | ×1.75 | 2 | unique palette + aura | 0.5% |

Gift talents are innate perks rolled at capture or hatch. Lures, Taming level and heir eggs shift the odds upward.

**Bond**

- **Hearts 0–5,** at 40 / 120 / 250 / 450 / 700 Bond XP.
- **Sources:** daily pat (+10, once a day), favorite-type meal (+15), personal favorite dish (+40), and +1 per 30 minutes of work.
- **Effects:** +2% work speed per heart. Heart 3 is needed for the final evolution. Heart 4: the pet sometimes brings you a gift item. Heart 5 is needed to retire to the Elder Grove.

**Roster**

- **Starter:** choose one of four eggs (one per archetype). It hatches Uncommon, and you name it.
- **Active:** 2 pets work in zones. The rest live in the Stable: 2 / 4 / 6 / 8 / 10 spaces by Stable tier.
- **Stabled pets** earn no XP but rest twice as fast. Evolved stabled pets can assist a crafting station (see Evolution).
- **Swap** active and stabled pets anytime. **Release** returns a pet to the wild for a few materials.

## Evolution and talents

Every archetype has five forms across three stages. What a pet does unlocks its branch options, the player picks one, and Bond plus a crafted catalyst unlock the final form.

&#91;embedded content: evolution tree · Sprout example, 5 forms\]

Sprout shown; Stone, Tide and Wild follow the same shape with their own branches (table below). The branch choice at level 10 is the pet's one permanent fork.

**How it works**

1. **Hatchling (stage 1).** Levels 1–10.
2. **Juvenile (stage 2), at level 10.** Choose one of the archetype's two branches. A branch is available once the pet has done 150 actions of that branch's calling skill (shown as progress bars on the pet's page). If neither is unlocked yet, XP banks until one is.
3. **Adult (stage 3), at level 20.** Needs Bond heart 3 and the branch's catalyst from the Alchemy Lab.
4. Evolution is permanent.

**Branches**

| Archetype | Branch | Calling | Strength | Catalyst | Assists at |
| --- | --- | --- | --- | --- | --- |
| Sprout | Bloom | Foraging | foraging rare finds, garden yield | Verdant Essence | Alchemy Lab |
| Sprout | Timber | Chopping | chopping speed | Heartwood Resin | Workbench |
| Stone | Gem | Mining | gems, luck | Prism Dust | Forge (quality) |
| Stone | Boulder | Chopping | mining speed, stamina | Granite Heart | Forge (speed) |
| Tide | Deep | Fishing | treasure maps, rare fish | Abyssal Pearl | Alchemy Lab |
| Tide | Current | Foraging | fishing speed | Rushing Tonic | Kitchen |
| Wild | Fang | Hunting | hunting speed, by-products | Hunter's Musk | Kitchen |
| Wild | Scout | Foraging | tracking, can dig treasure | Pathfinder Oil | none (digs instead) |

Catalysts use tier 3–4 materials, so most adults appear around Stonecrag and Mistfen.

**Station assist:** an adult pet resting in the Stable can be posted to one station for +10% craft speed (Forge quality assist: +10% Fine and Masterwork odds instead). One assistant per station. This gives stabled pets a job.

**Talents**

- **Picks at levels 5, 10, 15, 20, 25 and 30:** choose one of two talents from the pet's pool (hatchling pool, then branch pool).
- **Gift talents** come from quality and are fixed at birth.
- **Example talents:** Sure-footed (−15% energy drain), Keen nose (+3 points rare-find chance), Second wind (rest 25% faster), Packrat (10% chance of +1 item), Hearty eater (meals restore 50% more), Sunny disposition (+25% Bond gain).
- **Content size:** about 40 talents across one hatchling pool, eight branch pools and one gift pool.

## Taming and treasure

New pets come from tracking and trapping in the wild, and from eggs. Treasure maps turn every harvest into a small lottery that also feeds the Grand Projects.

**Taming flow**

1. **Track.** The player tracks in a zone (earns Taming XP). Each tracking action has an 8% chance, +0.1% per Taming level, to reveal a wild encounter: a stage-1 monster of one of the zone's archetypes. Its exact quality shows at Taming 30+; before that, only a hint ("looks ordinary" / "something special").
2. **Set a trap.** Pick a trap (tier at least the zone's tier) and optional bait. The trap runs 30 minutes of real time, offline too.
3. **Result.** Caught: the pet goes to a free active slot or the Stable (no space, no trap). Escaped: the trap survives 50% of the time, and the encounter stays for 6 hours for another try.

- **Catch chance:** 35% base, +10% per trap tier above the zone tier, +20% if the bait matches the archetype's favorite food, +0.5% per Taming level, capped at 95%.
- **Lures (Alchemy):** for one hour, encounters roll quality one band higher.
- **Traps** are crafted: frame (Workbench) + spring (Forge). **Bait** is cooked (Kitchen).
- **Mythics:** Heartgrove only. Four single-form mythic pets, one per archetype. At most one mythic encounter a day; needs Starmetal traps and mythic bait.

**Treasure**

- **Maps drop** from fishing (2% per action) and other harvesting (0.5%), raised by Luck and the Deep branch.
- **A map marks a dig site** in a zone. Digging takes 20 minutes: the player with a Shovel, or a Scout-branch pet.
- **Rewards:** coins, gems, rare components, decor, Sanctuary Relics (needed for Grand Projects) and, 5% of the time, an egg.

**Eggs**

- Hatch in the Nest building in 4 hours (faster with Nest tiers).
- Treasure eggs give a random archetype, with quality rolled one band above the zone's base odds.
- Heir eggs come from the Elder Grove (see Endgame).

## Crafting

Crafting is managed, not idle: you choose recipes, keep four station queues full, and can tap for quality. Every harvesting skill feeds at least two crafting skills, and every crafting skill feeds harvesting or pets.

**Stations and queues**

- **Four stations,** each a homestead building: Workbench (Carpentry), Forge (Smithing), Kitchen (Cooking), Alchemy Lab (Alchemy).
- **Queue slots:** 1 at tiers 1–2, 2 at tiers 3–4, 3 at tier 5. A slot holds one batch (one recipe × any quantity you have materials for).
- **Queues run offline.** Finished items go straight to the bag; the Craft tab shows a badge when a queue empties.
- **Craft time:** a few seconds per item at tier 1, rising with tier. Station tiers add +5% speed each.

**Focus tap (optional)**

- When you start a batch, a bar with a moving marker appears. Tap in the sweet spot: Perfect or Good. A Skip button is always there.
- **Quality odds per item:** Fine = 10% + 1 point per skill level above the recipe's level (cap 50%); Masterwork = 2% + 0.5 point per level above (cap 20%).
- **Focus multipliers:** Good ×1.5, Perfect ×2.5 on both odds. Skip or miss = base odds.
- **Quality applies to** tools (speed, rare finds) and meals (stronger effects). Other items have no quality.

**How skills feed each other**

| Harvest skill | Feeds |
| --- | --- |
| Chopping | Carpentry (planks, handles), Alchemy (sap, resin) |
| Mining | Smithing (bars), Alchemy (mineral dusts) |
| Foraging | Cooking (berries, herbs), Alchemy (herbs), Carpentry (fiber string) |
| Fishing | Cooking (fish), Alchemy (scales, pearls), treasure maps |
| Hunting | Cooking (meat), Carpentry (sinew string, hide), Alchemy (bone meal) |

**Example chain: a copper axe**

1. Mine copper ore → Forge: 2 copper ore = 1 copper bar.
2. Forge: 2 copper bars = copper axe head.
3. Chop pine → Workbench: 2 pine logs = 1 pine plank → 1 plank = tool handle.
4. Forge: head + handle = copper axe (tier 2), rolled for quality.

**What each craft is for**

- **Carpentry:** planks, handles, rods, bows, trap frames, building parts (frames, shingles, fences), furniture and decor.
- **Smithing:** bars, nails, tool heads, fittings, hooks, arrowheads, trap springs, shovels.
- **Cooking:** meals (pet energy + Bond; a 1-hour skill buff when the player eats one), pet treats, bait.
- **Alchemy:** potions (stronger player buffs), pet tonics (energy, XP), fertilizer (garden yield), lures, evolution catalysts.

## Homestead

The homestead is a fixed set of building plots in one portrait scene. Each building has five tiers, each tier looks different, and no building can be upgraded past the Cottage's tier.

| Building | Unlocks | Effect by tier (1 / 2 / 3 / 4 / 5) |
| --- | --- | --- |
| Cottage | start | offline cap 8 / 10 / 12 / 14 / 16 h; caps every other building's tier |
| Stable | start | 2 / 4 / 6 / 8 / 10 pet spaces; rest speed +20% per tier |
| Workbench | start | queue slots 1 / 1 / 2 / 2 / 3; +5% craft speed per tier |
| Kitchen | start | same as Workbench |
| Garden | Renown 2 | 2 / 4 / 6 / 8 / 10 plots; vegetables and fruit every 2 h |
| Forge | Renown 2 | same as Workbench |
| Alchemy Lab | Renown 5 | same as Workbench |
| Nest | Renown 8 | egg slots 1 / 1 / 2 / 2 / 3; hatch time −10% per tier |
| Elder Grove | first pet reaches level 30 | holds retired elders (not tiered) |
| Old Sanctuary | Renown 12 | Grand Project site (5 projects × 3 stages) |

- **Costs:** materials of the matching tier plus coins. Tiers 3–5 also need a blueprint bought in Mossbrook.
- **Garden:** plant seeds bought at the market; fertilizer boosts yield. Garden food supplies Cooking (and hand-feeding).
- **What the scene shows:** buildings at their current tier, resting and stabled pets wandering or sleeping, assistant pets working at their stations, elders in the Grove, and the Sanctuary visibly restoring as projects finish.
- **Workers in the field** are shown in each zone's scene on the World tab, animating at their tasks.
- **Pantry:** cooked meals and pet tonics in the bag that auto-feed is allowed to use (a toggle per item). Raw food is hand-fed only.

## Village and economy

Mossbrook turns surplus into coins and gives each day a few goals. Coins are the only currency.

**Mossbrook**

- **Market:** sell any item at a fixed price; buy seeds, basic bait, blueprints, recipe scrolls and decor.
- **Traveling merchant:** once a week, three rotating rare items (a rare egg, a strong lure, a blueprint discount).
- **Commission Board:** 3 daily commissions, reset at local midnight, 1 free reroll a day. Requests scale to the tiers you've unlocked ("Deliver 40 oak planks", "Cook 5 trout stews"). Rewards: coins, Renown XP, sometimes a lure or relic fragment.
- **Great Commission:** one per week, bigger delivery, bigger reward.

**Coins**

- **Sources:** selling, commissions, treasure.
- **Sinks:** blueprints, seeds, recipe scrolls, decor, merchant items.
- **No storage caps:** items stack without limit; the bag sorts by category.

**Achievements:** one-time milestones (skills, pets, homestead, collection, story) that give Renown XP and cosmetic titles.

**Renown**

| Renown XP source | Amount |
| --- | --- |
| Daily commission | 20–60 |
| Great Commission | 200 |
| Achievement | 25–250 |
| Building upgrade | 30 × new tier |
| First craft of a recipe | 5 |
| Grand Project stage | 300 |

| Rank | Title | Unlocks |
| --- | --- | --- |
| 1 | Newcomer | Meadowfold, Cottage, Stable, Workbench, Kitchen |
| 2 | Newcomer | Forge, Garden |
| 3 | Newcomer | Whisperwood |
| 5 | Homesteader | Alchemy Lab, outfit 1 |
| 6 | Homesteader | Stonecrag Hills |
| 8 | Homesteader | Nest |
| 10 | Keeper | Mistfen Marsh, outfit 2 |
| 12 | Keeper | Old Sanctuary (Grand Projects) |
| 15 | Warden | Emberfall Caldera, outfit 3 |
| 20 | Steward | outfit 4 |
| 25 | Sanctuary Keeper | outfit 5 |
| 30 | Sanctuary Keeper | title and Heartgrove decor set |

Titles change every 5 ranks: Newcomer (1–4), Homesteader (5–9), Keeper (10–14), Warden (15–19), Steward (20–24), Sanctuary Keeper (25–30).

## Endgame

The endgame has three layers: a finish line around week 8–10, a long tail of collection and mastery, and a legacy loop where pets carry the prestige. The player never resets.

**1. Finish line: the Grand Projects**

Five projects at the Old Sanctuary, opened at Renown 12 and done in order. Each has 3 stages; each stage needs large material deliveries (delivered bit by bit against progress bars), coins, and Sanctuary Relics from treasure.

| # | Project | Leans on | Permanent reward |
| --- | --- | --- | --- |
| 1 | The Great Gate | Carpentry, Smithing | +5% craft speed at every station |
| 2 | The Moonwell | Alchemy, Mining | +25% pet rest speed |
| 3 | The Feast Hall | Cooking, Fishing, Hunting | meals 25% stronger |
| 4 | The Terraced Gardens | Foraging, Garden | +50% garden yield, +5% foraging speed |
| 5 | The Heart Shrine | every skill + 5 Relics per stage | the ending; opens the Heartgrove, Starmetal and mythic pets |

Each finished project plays a short scene, restores part of the Sanctuary on the homestead, and adds a journal entry.

**2. Long tail**

- **Bestiary:** 20 archetype forms + 4 mythics = 24 entries, each with five quality stars to collect (120 total).
- **Perfect pets:** Legendary, with ideal gifts and all six talent picks.
- **Mastery stars:** past skill level 60, up to +25% speed per skill.
- **Starmetal:** prestige tools (+15% speed), mythic traps, decor.
- **Weekly Great Commissions** keep running.

**3. Legacy loop: the Elder Grove**

- **Who can retire:** a pet at level 30 with Bond 5 (adult or mythic).
- **What happens:** the pet moves to the Elder Grove, where it stays visible on the homestead. Its record keeps its name, form, quality, days served and lifetime actions, like a Hall of Champions.
- **Legacy bonus:** +2% to its branch's skill for all pets (a Timber elder: +2% chopping). Elders of the same branch stack with shrinking returns: 2%, 1.5%, 1%, then 0.5% each. Mythic elders give +1% to every skill.
- **Heir egg:** hatches in the Nest as the same archetype. Quality floor is one band below the parent's, with a 25% chance of matching it. It inherits one talent of your choice as an extra Heirloom talent.
- **Why it works:** retiring is a reward, not a loss. It clears Stable space, makes every future pet better, and keeps the relationship at the center.

## Screens and UI

Five bottom tabs, one-handed, portrait. Menus are HTML; the Home and zone scenes are drawn on a canvas.

| Tab | What's there |
| --- | --- |
| Home | Homestead scene. Tap a building to build or upgrade. The road sign opens Mossbrook (Market, Commission Board, merchant). |
| World | Map of the six zones. Tap a zone for its scene with your workers animating; assign the player and pets; track, trap and dig. |
| Pets | Roster cards (level, quality stars, energy, Bond hearts). Pet page: stats, talents, evolution path with calling progress, feed, pat, swap, station assist, retire. |
| Craft | Four station cards with queues, recipe picker, Focus tap overlay, and the bag. |
| Journal | Commissions, achievements, Renown, Bestiary, Elder Grove records, story journal, settings (save export and import, sound, credits). |

- **Top bar:** coins, Renown rank with progress bar, offline-cap indicator.
- **On load:** the "While you were away" summary.
- **Badges** on tabs when something needs you: an empty queue, a finished trap, a pet ready to evolve, a new commission.
- **Mobile rules:** touch targets at least 44 px, thumb-reach for primary actions, safe-area insets respected, nothing hover-only, readable at 375 px wide.
- **No push notifications.** Badges only.

## Visual and audio direction

Everything comes from one free pack, Ninja Adventure by pixel-boy and AAA (CC0, commercial use allowed, credit appreciated), so the whole game shares one artist's style. No paid licenses.

**What the pack covers:** 50+ animated characters, 30+ animated monsters, 9 bosses, 60+ items, tilesets, UI elements, visual effects, fonts, 100+ sound effects and 37 music tracks. Source: [Ninja Adventure on itch.io](https://pixel-boy.itch.io/ninja-adventure-asset-pack).

**Art casting** (Rob picks; no art tools needed)

1. Claude Code builds an art catalog page showing every sprite with its file name.
2. Rob picks the player character, 20 pet forms (4 archetypes × 5), 4 mythics (from the bosses), item icons, and homestead pieces.
3. Picks are saved to `data/sprites.json`. Re-casting later is a data change, not a code change.

**Casting guidance**

- **Evolution lines:** monsters that share a body shape become one line; size and recolors separate the stages and branches.
- **Quality:** a recolor filter in code (palette shift, sparkle, aura), not new art.
- **Player:** one fully animated character. The held tool overlays the swing animation for chopping, mining and so on. Outfits swap at Renown milestones.
- **Buildings:** each tier composed from tileset pieces (tent → cabin → house with porch).
- **Gaps:** small missing pieces (an icon, a sign) are drawn by Claude in the pack's palette. Anything bigger: another CC0 16×16 pack, checked for style match first.
- **Theme:** the pack leans toward a Japanese village in places; that is fine as light flavor.

**Rendering**

- 16×16 sprites scaled by whole numbers (3× or 4× on phones) with crisp, unsmoothed pixels.
- Only the chosen sprites ship, packed into one sprite atlas; the raw 89 MB pack never ships.
- Menus use the pack's UI pieces and pixel font.

**Polish layer** (what makes free art feel high quality; all code)

- Day/night tint on the real clock; occasional rain.
- Ambient particles: drifting leaves, pollen, fireflies at night.
- Soft shadows under every sprite.
- A squash-and-stretch hop when a pet finishes a task; floating "+3 oak log" pops.
- The pack's effects for wood chips, sparks, splashes and sparkles.

**Audio:** pack sound effects and one music track per zone. Sound starts after the first tap (a browser rule), with mute toggles for music and effects.

**Credits screen:** names pixel-boy and AAA with a link to the pack.

## Pacing targets

The balance simulator tunes the numbers until a regular player (4 check-ins a day) hits these marks within 25%. A light player (2 check-ins a day) should still reach the ending by week 14.

| Milestone | Regular player target |
| --- | --- |
| First pet hatched and named | 1 minute |
| First building upgrade | 10 minutes |
| Second pet tamed | day 1–2 |
| Whisperwood (Renown 3) | day 1 |
| First stage-2 evolution | day 2 |
| Stonecrag Hills (Renown 6) | day 4–5 |
| First stage-3 evolution | day 8–10 |
| Mistfen Marsh (Renown 10) | week 2–3 |
| Grand Projects open (Renown 12) | week 3 |
| Emberfall Caldera (Renown 15) | week 5 |
| First pet retired to the Elder Grove | week 6–8 |
| Ending (Grand Project 5) | week 8–10 |
| Bestiary complete | month 4 or later |

**The first ten minutes** must hook: pick an egg, name the pet, chop the first logs, make the first plank, upgrade the first building, and finish the first commission.

## Placeholders and tuning

The design is locked; these details are expected to move.

- **Names** of the village, zones, projects, catalysts and pet species are working names.
- **Pet casting** depends on what the art catalog shows. Archetype looks, and possibly a zone's wild archetypes, may shift to fit the sprites available.
- **Every number** in this doc is a starting point. Final values live in `data/balance.json` and are set by the balance simulator.
- **Content lists** (full recipe list, talent pools, achievements, commission templates) are written in the build from the rules here.
