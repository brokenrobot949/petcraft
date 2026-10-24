# PetCraft — project rules for Claude Code

## What this is
A cozy, mobile-first browser idle game: raise evolving monster pets, harvest, craft,
grow a homestead, restore the Old Sanctuary. No combat.
Spec: docs/design.md (game) and docs/handoff.md (build plan). The spec wins over guesses.
Ask Rob before changing anything listed under "Locked decisions" in docs/design.md.

## Who you're working with
Rob is the game designer and has no coding experience.
- Explain what you built in plain language; no jargon without a one-line explanation.
- End every phase with a short phone test checklist.
- Never ask Rob to edit code or run terminal commands beyond what the handoff lists.

## Hard constraints
- Static site on GitHub Pages. No build step, no bundler, no CDN, no npm runtime dependencies.
- Vanilla JS ES modules. PixiJS vendored in lib/. Node is allowed for dev-only tools in tools/.
- Mobile portrait first: 375x812 baseline, touch targets >= 44px, safe-area insets, nothing hover-only.
- Installable PWA that plays offline.
- Every tunable number in data/balance.json; every piece of content in data/*.json. No magic numbers in code.
- Saves: versioned schema, a migration for every version bump, backup slot, export/import. Never break an existing save.
- Art and audio: only the Ninja Adventure pack (CC0) from assets-source/, or small pieces drawn in its palette.
  No other third-party assets without asking Rob. assets-source/ is never shipped; only packed atlases in assets/.

## Architecture
- js/core: state, tick, offline catch-up, save, seeded rng
- js/systems: one module per system; each exposes a pure advance(state, ms) plus command handlers
- js/render: PixiJS scenes (home, zones), sprite manager, recolor filter, effects; paused when hidden
- js/ui: DOM screens, one module per tab; UI reads state and sends commands, never mutates state
- tools/: art catalog, atlas packer, balance simulator (dev only, not shipped)
Live play, offline catch-up and the balance simulator must call the same system functions.

## Working rules
- Build phase by phase from docs/handoff.md. Finish a phase's acceptance checks before starting the next.
- The game must be playable at the end of every phase. Push to main so Rob can test on GitHub Pages.
- Test at 375x812 and on a narrow 360px width before saying a phase is done.
- Update the Status section below at the end of each phase.

## Delegation
- Opus (lead): architecture, state schema, tick and offline math, save and migrations, integration,
  review of every subagent diff before it is committed.
- Sonnet subagents: data files from the spec, DOM screens, art catalog, atlas packer, Pixi scene work
  against interfaces Opus defines, running and reporting the balance simulator.
- Haiku subagents: flavor text (item descriptions, commission notes, journal entries, species names),
  CREDITS.md, simple data consistency checks.
- Give each subagent one task, the exact files it may touch, and its acceptance checks.
- Subagents never change the state schema or the structure of balance.json.
- Run subagents in parallel only when their files do not overlap.

## Conventions (set in Phase 0)
- System code is deterministic: no Date.now(), no Math.random() (use js/core/rng.js), no DOM. Time comes in as
  arguments; numbers and content come from ctx.data. Register systems in js/systems/index.js.
- UI changes state only via game.dispatch(type, payload). Per-device prefs (last tab, guides seen) live in
  js/ui/device.js under petcraft.device, not in the save.
- Release: bump version.js (the single version stamp) whenever a shipped file changes. Every shipped file
  must be listed in sw.js FILES; check with `powershell -ExecutionPolicy Bypass -File tools/check-precache.ps1`.
  New data files also go in DATA_FILES in js/core/data.js.
- Local preview: `powershell -ExecutionPolicy Bypass -File tools/serve.ps1` (or the "petcraft" entry in
  .claude/launch.json). No Python or Node on Rob's machine; on localhost the service worker is network-first.
- Only one tab may own the save: a tab that sees another tab save pauses itself (main.js).

## Status
Phase: 9 done (2026-10-24)
Next: Phase 10 (tune and ship: simulator tuning to pacing targets, audio, save stress tests, performance,
  credits, iPhone install guide, remove test mode from the shipped build).
Phase 9: save schema v8 (migration 7->8: sanctuary, story, elders, taming.mythicMs, pet heirloom/parent).
  Contract in docs/architecture.md "Phase 9: endgame". Grand Projects (js/systems/sanctuary.js, data/projects.json):
  5 projects x 3 stages from Renown 12, delivered bit by bit (sanctuary/deliver), 300 Renown XP per stage,
  permanent rewards via sanctuaryBonus (craft speed, pet rest, meal strength, Garden, Foraging speed, tracking).
  The Heart Shrine is the ending: opens the Heartgrove (tier 6, 5 skills, mythics: true). Story journal
  (js/systems/story.js, data/story.json: 18 entries on achievement-style conditions, 5 project scenes played on
  Home with the Sanctuary restoring: prop.sanctuary.1-5). Mastery stars past level 60 (skills.js; +0.5% speed
  each, max 50; harvesting, crafting, tracking). Starmetal tier-7 prestige tools (+15% speed, tools.json
  prestige). Mythics: Heartgrove reveals, one per 24 h of game time, need a Starmetal Trap + Mythic Bait;
  single-form, stage 3, own talent pool. Elder Grove (js/systems/elders.js): opens when a pet reaches 30;
  retire an adult/mythic at 30 with heart 5; legacy bonus as speed effects per branch (pets.json `legacy`,
  stack 2/1.5/1/0.5%; mythic elders +1% all); heir egg (same archetype, parent's quality 1 in 4, else at least
  one band lower) placed with nest/placeHeir, hatches with an Heirloom talent. Home: Sanctuary button, Elder
  Grove decor at the top (elders stand beside it), one-row Home buttons. Test mode: Grand Projects (needs,
  finish stage, finish all), Ready to retire, Mastery stars, Mythic encounter, Endgame kit. Core checks: 242.
  Simulator v5 (90 days ~1.5 min): regular player opens projects day 9, ending day 42.5 (target 56-70, early
  like all pacing), first Starmetal tool day 43, first mythic day 50; light player ending day 58.5.
  Lead calls Rob may want to know: legacy skills per branch (Boulder -> Mining, Current -> Fishing,
  Scout -> Hunting, not their odd callings); Terraced Gardens crop counts halved (the Garden is slow); heir
  quality is capped at the parent's; the starlit_fortune mythic talent cut to +2 rare points.
Phase 8: save schema v7 (migration 6->7: per-pet stream, talent offer, favorite dish; crafting.assists;
  bestiary). Contract in docs/architecture.md "Phase 8: evolution". Evolution (pets/evolve): level 10 + 150
  actions of a path's calling skill -> juvenile (player picks the path, permanent); level 20 + Bond heart 3 +
  the path's catalyst (8 new Alchemy Lab recipes, tier 3-4 inputs) -> adult. One effect system
  (petstats.js petEffects): path strengths (adults x2), talents and gift talents all use 15 effect kinds.
  data/talents.json: 47 talents (8 hatchling, 4 per path, 7 gift); picks at levels 5/10/15/20/25/30 from two
  choices. Gift talents by quality (Rare/Epic 1, Legendary 2) for every new pet; old Rare+ pets get theirs on
  load. Personal favorite dish (+40 Bond, revealed on first feed; any meal up to tier 3). Heart 4+ pets bring
  gifts (a treasure-loot roll, 10% per Bond point from work). Station assist: a stabled adult posted at its
  path's station keeps it running without using the player's slot (+speed; Gem: better quality); making it
  active ends the post. Scout pets dig (treasure/dig with worker). Bloom pets raise Garden yield, Scouts help
  tracking. Bestiary in the Journal (24 entries x 5 stars). Pets tab badge for "ready to evolve" / "talent to
  choose". Home scene: assistants stand and hop beside their station. Test mode: Ready to evolve, Fill
  callings, All catalysts. Core checks: 208. Simulator v4 evolves, picks talents, makes catalysts, posts
  assistants, sends Scouts digging: regular player first juvenile day 1.0 (target 2, flagged early), first
  adult day 8.2 (target 8-10); light player adult day 14.
  Lead calls Rob may want to know: renamed the adult Timber species "Oakthorn" to "Thornwood" (reads "a
  Thornwood"); Boulder's calling is Chopping and Scout's is Foraging, exactly as the design table says, though
  it reads oddly (Rob may want Mining / Hunting).
Phase 7: save schema v6 (migration 5->6: taming, treasure, nest; workers.player.resume). Contract in
  docs/architecture.md "Phase 7: taming and treasure". Tracking is a player task (js/systems/taming.js):
  each try gives Taming XP and may reveal one wild hatchling per zone (hint "Looks ordinary" / "Something
  special"; exact quality at Taming 30); then the player goes back to the harvest task they left. Traps
  (pine/oak/cedar/willow/ashwood, tiers 1-5: frame at the Workbench + spring at the Forge, assembled at the
  Workbench) and bait (Kitchen; Mossbrook sells bait and a Pine Trap) run 30 min of game time, offline too.
  Catch chance exactly as the spec (35% + 10%/trap tier above zone + 20% matching bait + 0.5%/Taming level,
  cap 95%). A set trap holds a pet space. Escaped: trap kept 50%, the monster stays 6 h. Lures (Alchemy,
  merchant): quality one band up while they run; time stacks. Maps are bag items, one per zone, dropped by
  any harvest (js/systems/harvest.js); digging (js/systems/treasure.js) is a player task, 20 min per map
  (faster with better shovels), digs maps one after another then resumes harvesting; rewards: coins,
  loot from data/treasure.json, Sanctuary Relics, 5% a Treasure Egg. Nest (js/systems/nest.js): place an
  egg, it warms 4 h (less per Nest tier), then the player hatches and names it. pets/release gives
  materials. Badges: World (a trap finished), Pets (an egg is ready). 8 new achievements. Test mode adds
  encounters and "finish traps, eggs and dig". Core checks: 161. Simulator v3 tracks, traps (releasing
  its worst stabled pet for a "special" find when full), digs at every check-in, builds the Nest, hatches.
  Lead balance calls (Rob may want to know): map chance cut to 1/20 of the spec (fishing 0.1%, other
  0.025%) and pet Luck multiplies it, because pets make tens of thousands of actions a day (the spec's
  2% / 0.5% gave ~350 maps a day in the simulator; now ~17); dig coins halved. A caught pet is named
  after its species (rename on its page).
Phase 6: save schema v5 (migration 4->5: crafting.working/known, village, garden, achievements; the first
  busy station keeps working; renown.xp is now progress into the rank and old totals settle into ranks).
  Renown ranks 1-30 (js/systems/renown.js, addRenownXp is the only way in; titles in data/renown.json).
  Working-station limit (Rob, 2026-10-23): workSlotsByCottageTier [1,1,2,2,2]; a free slot picks the first
  queued station; an emptied queue hands its leftover time to the next waiting one; 'crafting/work' switches.
  Mossbrook (js/systems/village.js, js/ui/mossbrook.js; Home signpost or Mossbrook button): market (sell
  anything with a sell price, x quality; buy seeds and blueprints; recipe scrolls teach 6 "scroll" recipes),
  Commission Board (3 a day, reset at local midnight via 'village/newDay' from main.js every minute, 1 free
  reroll then 25 coins), weekly Great Commission (Monday weeks), traveling merchant (3 offers, restocked
  daily at midnight: Rob, 2026-10-23). The Mossbrook sheet shows the player's coins in its header.
  Coins through js/systems/coins.js (stats.coinsEarned/Spent). Garden (js/systems/garden.js): plots by tier,
  seeds from items.json "seed", auto-replant. 56 achievements (afterCommand hook in game.dispatch), wearable
  titles. Zones 2-5 with nodes, rares and scenes (per-zone ground colors); iron/steel/mythril/emberite tools
  for all 6 kinds; 88 new recipes; building tiers 3-5 use later-zone materials. New games start with the
  Forge (Renown 2) and Alchemy Lab (Renown 5) as empty plots; Phase 5 saves keep theirs. Core checks: 113.
  Simulator v2 plays all of it (commissions, selling, blueprints, garden, station switching, tools to tier 6).
Phase 5: no schema bump (buildings.init fills one { tier } per building in data/buildings.json). 8 buildings
  (Cottage, Stable, Workbench, Kitchen, Forge, Alchemy Lab, Garden, Nest), 5 tiers each, instant upgrades
  (js/systems/buildings.js): materials, coins from tier 3, blueprints for tiers 3-5; nothing passes the
  Cottage's tier; +30 x tier Renown XP. Effects: Cottage away cap, Stable spaces (createPet refuses when
  full) and rest speed, station queue slots and speed. New parts: pine frame, shingles, copper nails.
  Home scene: 3x3 village grid (plots in buildings.json, roads in balance.render.home), tap a building
  or use the Buildings button for its sheet; upgrade arrow; pop + sparkles on a new tier; idle pets wander
  near the Stable. Polish layer v1 (js/render/polish.js, both scenes): shadows, day/night tint on the real
  clock, rain by the hour, leaves, pollen, fireflies. Home tab badge when an upgrade is ready.
  Art: 40 building looks composed from pack pieces (packer supports "parts"; see tools/atlas/README.md).
  Test mode adds: set any building tier, blueprints + coins, Renown rank, time of day and rain.
  Contract in docs/architecture.md "Phase 5: homestead". Core checks: 72. Simulator tracks building milestones.
Phase 4: save schema v4 (station queues, player buffs, craft counts; migration 3->4). Four stations
  (data/recipes.json, 24 recipes) with queues that run offline, Focus tap (Good x1.5 / Perfect x2.5),
  Normal/Fine/Masterwork quality, copper tools for all 6 kinds (tier 2; a better tool equips itself),
  5 meals + 3 potions/tonics: pets eat meals (+Bond for their archetype's favorite dish), the player
  eats them for a 1 h speed buff. Bag keys carry quality ("copper_axe:fine"). The tick splits time where
  a buff ends or a tool finishes, so live = offline. Craft tab badge when a queue runs empty.
  Contract in docs/architecture.md "Phase 4: crafting". Core checks: 57 (tools/tests/core.html).
  Balance simulator v1: tools/sim/ is a browser page (no Node), open http://localhost:8080/tools/sim/;
  30 days for both player types in ~1 s; milestones, flags, charts, CSV. See tools/sim/README.md.
Phase 3: save schema v3 (pets, pantry, a random stream per worker; migration 2->3). Egg choice,
  hatch and name, 2 active slots (+ Stable swap), energy (~3 h per bar), rest, auto-feed from the
  pantry (per-item toggles), hand-feeding, pet XP (stage caps 10/20/30, extra XP banks), Bond with
  hearts, daily pat (local midnight), pets harvesting with the player on the World tab, pets in the
  zone and home scenes, pet lines in "While you were away", Pets tab badge. Contract in
  docs/architecture.md "Phase 3: pets". Pets never give the player skill XP.
  Test mode (Journal -> tap the version line 5 times) can grant items (with quality), set levels,
  add pets, set energy/level/Bond, re-allow the pat, pretend you were away.
Phase 2: save schema v2 (skills, bag, tools, workers, stats; migration 1->2). Harvesting in
  Meadowfold for all 5 skills, skill XP, bag, "While you were away", zone scene with held tools and
  pops, item icons (js/ui/icons.js reads the atlas).
Art casting: data/sprites.json maps roles (player, pet.<archetype>.<form>, mythic.<archetype>) to pack
  sprites; js/render/sprites.js loads the atlas and builds actors. Rob picked the player (Hunter,
  a 16x16 "character" sheet: 4-frame walk, 1 swing pose). The other picks are Claude's
  suggestions; Rob recasts in the catalog (http://localhost:8080/tools/catalog/ -> Casting -> Save),
  which writes sprites.json and runs tools/atlas/pack.ps1 via tools/serve.ps1. Then commit + bump version.
Known issues:
- Pacing (simulator v3, 30 days, regular player): Renown zones arrive early (Whisperwood 5 h, Stonecrag
  day 1.4, Mistfen day 7.6, Renown 12 day 10.6, Emberfall day 22 vs target 32); treasure coins speed it up. Harvest skills hit 60 by day 14-20; willow logs and other stockpiles reach the
  hundreds of thousands. Light player is roughly on target to Renown 12 (day 18). All tuned in Phase 10 in
  balance.json (renown.xpCurve, village.daily.renown, XP curve, harvest yields).
- Pets rest under 1% of the time even with the one-station rule (simulator 0.3%): meals are cheap and fast.
  Making meals cost more is a Phase 10 lever. Auto-feed uses cooked meals and tonics only (Rob, 2026-10-19).
- Some commissions ask for meals made with Garden crops; a player without a Garden yet can reroll them.
- A brand-new player gets a Great Commission only once their skills meet one template's needs (the board
  keeps trying every minute).
- Player outfits at Renown 5/10/15/20/25 are not built (needs Rob's casting of outfit looks).
- Decor (market sink) and fertilizer are not built. Relics still pile up (simulator: ~460 held at day 90; the
  projects need 25).
- Pets retire far too early (simulator: first elder day 17 vs week 6-8; 20+ elders by day 90) because pet XP
  is a placeholder; tune balance.pets.xpCurve in Phase 10. Many elders stack a large legacy bonus.
- The simulated player can't keep project meals from auto-feed except by toggling the pantry (it does now);
  real players must switch those meals off in the Pantry themselves. Rob may want projects to reserve them.
- Phase 9 weak art: starmetal tools and heads reuse the generic tool pictures; elderwood log/plank match oak;
  heir egg is an orb on a pedestal; mythic bait is a nut; tier-6 meals reuse sushi/onigiri/yakitori; the
  restored Sanctuary hall (stages 3-5) is a flat cream block with sunflower terraces; the pheasant glade has no bird.
- Wild visitors in the ending scene and pets gathering for a project scene walk straight lines through buildings.
- Treasure (simulator v3, after the cuts): about 17 maps a day; dig coins are still over half of all coins
  earned and coins pile up (Phase 10: balance.treasure.byTier.coins, mapChance). Regular player tames ~23-30
  pets in 30 days; second pet tamed day 0.4 (target day 1-2). New players see many escapes at 35% without bait.
- Weak Phase 7 icons (pack has no eggs, traps or springs): eggs are orbs, all trap springs share a hook,
  willow/ashwood frames reuse plank icons, traps are crates/baskets/chest/cauldron, lures reuse potion
  bottles, two map scrolls match blueprint icons, the scene trap is one basket for every tier, the dig site
  is a twig piece.
- Phase 8 icons reuse other items' pictures: catalysts are potion bottles, honey (Heartwood Resin), a gourd
  (Hunter's Musk), a milk pot (Abyssal Pearl: the pack has no pearl). Unseen Bestiary entries show as dark boxes.
- Assistants use no energy and earn no XP or Bond while posted. The simulator's player keeps its best pets
  active, so it posts only ~2 assistants and its Scouts rarely dig (Phase 10 policy question).
- Heart 4 gifts (simulator: ~260 in 30 days) add to the coin and loot pile-up; tune heartGifts in Phase 10.
- Pet XP is a placeholder: a pet reaches the hatchling cap (level 10) in about a day of work.
- Simulator: the scripted player acts only at check-ins, so "first building upgrade" shows 10 h (it must
  build the Forge first now); an active player needs about 5-10 minutes. The policy reads zone rares and
  reachability straight from data (no selector for "where does this item come from").
- Catch-up: 16 h in about 80 ms on desktop; not yet measured on a phone. 30 fps likewise desktop-only.
- Weak icon matches: pine frame (a shelf), copper nails. Several buildings reuse the same house pictures
  at different tiers; Rob may want to recast (the catalog can't edit composed "parts" roles yet).
- Weak item icon matches Rob may want to recast: bow (sideways), pine log (a stump), pine seed,
  berries, rabbit hide, sinew, river shell, four-leaf clover (3 leaves), lucky rabbit foot; Phase 4:
  hazelnut, pine plank (a crate), tool handle, both strings (same icon), copper fittings (an anvil),
  pickaxe/shovel heads, berry compote, roasted hazelnuts. Copper sickle, rod and shovel reuse the
  stone tools' icons (the pack has no second version). Phase 6: the pack has few distinct pictures, so
  the new meats share 3 pictures, all rods and sickles share one, axes/pickaxes/shovels/bows cycle 2-3
  pictures across tiers, handles and fittings repeat, the 8 new potions reuse 6 bottles; poor fits: ram
  horn (fortune cookie), boar tusk (caltrop), coal (teal rock), potato (tan block), shingles (roof tiles).
  Zone props: lava pool is a dark pit with an orange square (no lava tile in the pack), Mistfen's pool
  reuses Meadowfold's pond, the deer trail is a leaf pile, the coal rock is grey.
- Held tools use the full item pictures (SpriteInHand files are head-only fragments) with a
  code-made wind-up and bounce, drawn behind the body; the rod and bow are small and may need tuning in balance.render.zone.
- Tab icons and app icon are still placeholder pack sprites.
