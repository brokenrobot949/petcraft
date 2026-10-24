# PetCraft balance simulator (v4, dev only, never shipped)

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

## What the policy does (v2, Phase 6 systems)

Each check-in, in this order (the policy only sends commands and reads selectors; it never re-implements a rule):

1. `village/newDay` (the sim clock drives the day), hatch the Sprout "Sim" on day 1, pat every pet once a day.
2. **Sell surplus** (`market/sell`) when coins are under the next building steps' coin cost: only items with no
   remaining use, above a reserve (50 of anything used by a recipe, building or commission; all pet food, tools,
   seeds and blueprints are kept; the market's highest-priced items go first).
3. **Buildings**: every upgrade or empty plot (Forge, Garden, Alchemy Lab as their Renown opens; the Nest is skipped,
   it does nothing yet) held back only by materials, a blueprint or coins, cheapest first. A missing blueprint is
   bought (`market/buy`, or the merchant if it offers one cheaper) once the materials are in the bag and coins cover
   blueprint + tier coins.
4. **Commissions**: deliver every board commission and the Great Commission it can (`village/deliver`); the free
   reroll goes to a board commission whose items it cannot reach soon (locked zone, tool tier too low, a skill more
   than 8 levels away, unlearned scroll, items only the merchant sells).
5. **Garden**: keep every plot planted (buys the cheapest unlocked seeds when out; auto-replant stays on).
6. **Scrolls** (`market/learn`) when coins cover them on top of the building steps' coins.
7. **Wants**: the cheapest building waiting on materials, the next tool tier for each kind (tiers 2-6), and the
   cheapest reachable open commission. Wants the player cannot reach yet (a locked zone, a far-off skill) are
   skipped. The recipe chain is followed backwards to the raw materials still short; those decide where the player
   and pets harvest. Craft skills below the level the wants need get spare raw input to turn into XP.
8. **Stations**: free queue slots get the wants' parts (a full queue holding only XP filler gives one batch up),
   then meals when food is short, then XP crafts. Then the player works the queued station that matters most
   (`crafting/work`): tools, then food when the pets' food in the bag is low, then buildings and commissions,
   then XP. With 2 work slots the best two are worked.
9. Eat a buff meal for the skill being harvested (order in the code: the Nest, pet slots and map selling run before step 7, taming last).
10. **Taming, treasure, Nest (Phase 7)**, in this order inside the run (all through commands and the exported selectors):
    - `nest/hatch` ready eggs (a generated name from `pets.json suggestedNames`; if the Stable is full, the lowest-ranked
      pet that holds no active slot is released first via `pets/release`), then `nest/place` every egg in the bag while a
      slot is free. The Nest is built like any other building (it is no longer skipped).
    - Pets: the best quality (then level) hold the 2 active slots (`pets/setActive`); new pets go to work through the
      normal harvest assignment.
    - Maps: keep what a 10 h overnight dig can use (`floor(10 h / digMs)`, best zones first) and sell the rest
      (`market/sell`; counted and flagged as "maps pile up").
    - At the END of the run (after harvest and stations are set): for every open wild zone with an encounter and no trap and
      a free space (`freePetSpaces`), `taming/setTrap` with the best usable trap in the bag (`trapOptions`) and the matching
      bait (`baitOptions`, else a Mossbrook `market/buy` of the matching bait when coins cover it plus 50). If a Pine Trap is
      not in the bag the policy buys one in Mossbrook the same way (150 coins) when it has the coins; otherwise the wants
      (step 7) include 2 traps of the target zone's tier and 2 matching baits per archetype of that zone, so the stations
      make them (frame at the Workbench, spring at the Forge, bait at the Kitchen).
    - With a free pet space, no encounter in the target zone (the highest open wild zone whose trap is in the bag or
      reachable) and a usable trap: use a lure if one is owned (`taming/useLure`), then `taming/track` there. The player
      tracks until an encounter shows up and the game then returns it to the harvest task by itself. Tracking is issued at the
      end of the run, so the 3 minutes of live play are harvesting; the second run of the check-in sees whatever the tracking
      found and sets the trap. The trap then works while the player is away (30 min of game time).
    - Full Stable: the policy keeps tracking while a stabled pet below Epic exists. When an encounter is found with no free
      space, it releases the worst stabled pet (`pets/release`) only if the encounter is likely better ("Something special" at
      Taming under 30, or at Taming 30+ a quality above that pet's); otherwise it lets the encounter go (`taming/letGo`) so
      tracking can look for another.
    - Digging: every check-in sends the player to `treasure/dig` in the open zone it holds the most maps for (the next
      check-in's harvest assignment ends the dig). `DIG_FROM_HOUR` in policy.js can restrict digging to late check-ins
      (20 = overnight only). With the old map rates this stalled every harvest skill; with pet Luck multiplying the map
      chance (about 17 maps a day) it does not. Keeps `floor(10 h / digMs)` maps and sells the rest.

11. **Evolution, talents, assistants, Scouts (Phase 8, v4)**, all through commands and the exported selectors:
    - Before the stations are planned: every pet whose evolveInfo says eady evolves (pets/evolve). A hatchling picks
      an unlocked branch whose calling matches the skill it is working, else one in its archetype's affinity, else the
      first unlocked. A juvenile becomes an adult. Hatchlings within 2 levels of the cap with no unlocked branch are sent
      to the best node of a calling skill (affinity first) at the end of the run.
    - Catalysts: a juvenile within 3 levels of the adult cap adds its branch's catalyst (recipe id = item id) to the
      wants, so the stations make it (with its parts); an adult blocked only by its catalyst gets the recipe queued
      directly at the Alchemy Lab when ecipeCheck allows.
    - Talents: when pet.offer is set, pick the first of speed, extraItem, drain by effect kind, else the first offered
      (pets/pickTalent).
    - Assistants: a stabled adult whose ssistInfo(...).can is true is posted (pets/assist) to its station if that
      station has no assistant; stations with the most queued work first. The player's work slots skip assisted stations.
      The scripted player keeps its best pets active, so an adult only helps once a better pet takes its slot.
    - Scouts: an active pet with canDig and no dig in hand digs (	reasure/dig with worker) when the player is not
      digging and a map is held; harvest assignment leaves a digging pet alone (the game sends it back to its harvest task).

## What the page shows

Milestones (now incl. "Second pet tamed", first dig, "First egg hatched", Nest built) with the design-doc target (middle of a range, in days since the start) and a status
(on time within 25%, early, late, not reached yet), including Renown ranks 2-15, zone openings, Grand
Projects (Renown 12), Forge and Garden built, first commission, and the first tool of tiers 3-6. Design-doc
milestones that cannot happen yet. Flags: items piling up with no use, items with a use that still pile up,
skills that never or no longer gain XP, "coins only go up" (never spent anything), coins piling up, pacing
milestones more than 25% off, pet rest share. Coin flow (earned by selling/commissions, spent on buildings,
blueprints, seeds, scrolls). Charts: skill levels, Renown rank (with coins/100), Renown XP per day, stockpiles.
New series per day (daily table, a chart and the CSV): Taming level, pets owned, tamed total, digs, maps found/held, eggs found/held, hatched, relics held, coins from treasure; flags for maps/eggs piling up. Daily table, refused commands, final state (buildings, tools, pets) and a CSV download (skill levels, XP, coins,
Renown rank and XP, every bag item, one row per day).
v4 adds per day (daily table, a chart and the CSV): juveniles, adults, talent picks, posted assistants, pet gifts, pet digs; milestones "First stage-2 evolution" (target day 2) and "First stage-3 evolution" (target day 9); an info flag with the evolution totals and flags when no pet reaches adult.

## What the simulator cannot measure yet

Grand Projects themselves (only the Renown 12 mark), Phase 8+ zone content (mythics), and the Focus mini-game (the policy always assumes a 'good' result). Pet feeding is whatever auto-feed
does. Milestones during time away are accurate to 30 minutes. The policy checks in only at its check-in times, so
the "first building upgrade in 10 minutes" target cannot be met by a 4-check-in player (it lands at the first
check-in after enough materials exist).
