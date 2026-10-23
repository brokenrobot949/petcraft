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
Phase: 5 done (2026-10-19)
Next: Phase 6 (Mossbrook market, coins, commissions, achievements, Renown ranks, zones 2-5, tool tiers 3-6),
  plus the working-station limit Rob approved on 2026-10-23 (docs/design.md "Crafting", locked decision
  changed): the player works 1 station at a time, 2 from Cottage tier 3; other queues pause; one-tap switch
  on the Craft tab; works offline. Needs a schema bump + migration (which stations the player works at;
  existing saves keep their queues, the first busy station stays working). Phase 8 changes station assist
  from +10% speed to "an adult assistant keeps that station running" (no player slot used). Re-run the
  simulator: watch pet rest time, since the Kitchen now competes with the Workbench and Forge.
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
- Pacing is far too fast (simulator, regular player): all six copper tools by day 2, every skill
  around level 52 by day 30, stockpiles in the hundreds of thousands. Tuned in Phase 10 by changing
  balance.json only; the XP curve and harvest yields are the main levers.
- Auto-feed uses cooked meals and tonics only (Rob, 2026-10-19; balance.pets.energy.autoFeedCategories), so
  pets no longer live on the raw food they gather. With the Kitchen kept busy pets still rest under 1%
  of the time (simulator), because meals take 4-6 s each; making meals cost more is a Phase 10 lever.
- Copper tools only open Whisperwood, which arrives in Phase 6; until then they add nothing but a
  new look in the bag (tier gates materials, quality gives speed).
- No use yet for stone, rabbit hide, pine seed and the rare gems/curios (selling: Phase 6).
- A pet's personal favorite dish (+40 Bond, revealed on first feed) is not built yet (Phase 8 with gifts).
- Pet XP is a placeholder: a pet reaches the hatchling cap (level 10) in about a day of work.
- Renown ranks don't rise yet (Phase 6), so the Garden (Renown 2) and Nest (Renown 8) stay locked and
  the Forge (Renown 2) and Alchemy Lab (Renown 5) start built. Garden crops (Phase 6) and Nest eggs
  (Phase 7) do nothing yet. Tiers 3-5 need blueprints from the Mossbrook market (Phase 6).
- Building costs for tiers 3-5 use Meadowfold materials until later zones exist; Phase 6 swaps them.
- Simulator: first building upgrade lands at the first check-in after 8:00 (about 4.5 h for the regular
  player), because the policy only acts at check-ins; an active player needs about 5-10 minutes.
- 30 fps was measured only in the desktop preview (about 65-130 fps); not yet on a real phone.
- Weak icon matches: pine frame (a shelf), copper nails. Several buildings reuse the same house pictures
  at different tiers; Rob may want to recast (the catalog can't edit composed "parts" roles yet).
- Weak item icon matches Rob may want to recast: bow (sideways), pine log (a stump), pine seed,
  berries, rabbit hide, sinew, river shell, four-leaf clover (3 leaves), lucky rabbit foot; Phase 4:
  hazelnut, pine plank (a crate), tool handle, both strings (same icon), copper fittings (an anvil),
  pickaxe/shovel heads, berry compote, roasted hazelnuts. Copper sickle, rod and shovel reuse the
  stone tools' icons (the pack has no second version).
- Held tools use the full item pictures (SpriteInHand files are head-only fragments) with a
  code-made wind-up and bounce, drawn behind the body; the rod and bow are small and may need tuning in balance.render.zone.
- Tab icons and app icon are still placeholder pack sprites.
