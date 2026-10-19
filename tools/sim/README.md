# PetCraft balance simulator (v1, dev only, never shipped)

Plays the real game with a scripted player for N days and reports pacing. It imports the same
game modules as the app (`createGame`, the systems, `loadData`); there is no copied game logic.
The player acts only through `game.dispatch`; time passes only through `game.advance` (the 3
minutes of active play at a check-in) and `game.catchUp` (time away, cut off at the offline cap,
so time beyond the cap is lost exactly as for a real player).

## Run it

1. Start the local server: `powershell -ExecutionPolicy Bypass -File tools/serve.ps1`
2. Open http://localhost:8080/tools/sim/ (or the port your server prints).
3. Pick days (default 30), seed (default 12345) and player (regular, light or both), press Run.
   Add `?auto` to the address to run with the defaults on page load.

30 days takes 1-2 seconds per player. The same seed always gives the same result.

## Files

- `index.html`: the page (the only file that touches the DOM): controls, tables, SVG charts, CSV button.
- `sim.js`: the run loop, clock, check-ins, daily snapshots, milestones, flags, CSV text. No DOM.
- `policy.js`: the scripted player's decisions. No DOM.

`sim.js` and `policy.js` do not touch `document` or `window`, so a Node runner can be added later
(it only needs to supply `data` the way `loadData` does).

## The players

- **Regular**: checks in at 8:00, 12:30, 18:00, 22:00. **Light**: 8:00 and 20:00.
- Each check-in: run the policy, 180 seconds of live play in 1-second steps, run the policy
  again, then catch up to the next check-in (in half-hour pieces, so milestone times are
  accurate to 30 minutes while away). The clock starts 2026-10-19 08:00 local time.
- A daily snapshot is taken at 23:59.

## What the policy does

- Day 1: hatches a Sprout egg named "Sim". No other pets (taming is Phase 7).
- Pats every pet once per local day. Leaves auto-feed on.
- **Workers** (player and active pets): goal order is (1) the raw materials still short for the
  copper tools (the recipe chain is followed backwards from `data/recipes.json`, counting the
  bag and queued batches), plus spare logs/ore to level Carpentry and Smithing to the tool gate
  (level 10); (2) food: when fewer than 20 food items (raw + meals) are in the bag the pet goes
  foraging for the food it has least of; (3) otherwise level the lowest harvest skill at its
  best open node. A locked node (for example the Copper Vein at Mining 3) sends the worker to
  level that skill first. The player takes the top goal, pets take the next ones (preferring
  their affinity skill).
- **Stations**: every free queue slot is filled. Order per station: a copper tool not yet
  equipped, then parts toward it, then (Kitchen) meals when food is under 20, then the craft
  that gives the most XP among recipes it can afford without touching materials the tools
  still need (and keeping 10 of each food ingredient). Only done for skills under the gate
  level or the lowest trainable skill. Recipes that make quality items use Focus 'good'.
- **Eating**: if the player has a meal or potion that buffs the skill being harvested and no
  buff is active, it is used.
- Refused commands are caught and counted by message.

## What the page shows

Milestone table (first time each was hit), design-doc milestones that cannot happen yet, flags
(items that pile up with no use, items with a use that still pile up, skills that never or no
longer gain XP, coins, pet rest share), skill-level and stockpile charts by day, a daily table,
refused commands, and a CSV download (one row per day: skill levels, skill total XP, every bag item).

## What v1 cannot measure yet

Renown, buildings and building upgrades, coins and selling, commissions, taming and more pets,
evolution, Grand Projects, other zones (only Meadowfold has content), tier 3+ tools, and the
Focus mini-game (the policy always assumes a 'good' result). Pet feeding is whatever auto-feed
does; the policy does not hand-feed. The policy never sells or discards, so stockpiles just grow.
Milestones during time away are accurate to 30 minutes.
