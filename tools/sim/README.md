# PetCraft balance simulator (v2, dev only, never shipped)

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
9. Eat a buff meal for the skill being harvested.

## What the page shows

Milestones with the design-doc target (middle of a range, in days since the start) and a status
(on time within 25%, early, late, not reached yet), including Renown ranks 2-15, zone openings, Grand
Projects (Renown 12), Forge and Garden built, first commission, and the first tool of tiers 3-6. Design-doc
milestones that cannot happen yet. Flags: items piling up with no use, items with a use that still pile up,
skills that never or no longer gain XP, "coins only go up" (never spent anything), coins piling up, pacing
milestones more than 25% off, pet rest share. Coin flow (earned by selling/commissions, spent on buildings,
blueprints, seeds, scrolls). Charts: skill levels, Renown rank (with coins/100), Renown XP per day, stockpiles.
Daily table, refused commands, final state (buildings, tools, pets) and a CSV download (skill levels, XP, coins,
Renown rank and XP, every bag item, one row per day).

## What the simulator cannot measure yet

Taming and more pets, evolution, Grand Projects themselves (only the Renown 12 mark), the Nest, Phase 7+ zones
content, and the Focus mini-game (the policy always assumes a 'good' result). Pet feeding is whatever auto-feed
does. Milestones during time away are accurate to 30 minutes. The policy checks in only at its check-in times, so
the "first building upgrade in 10 minutes" target cannot be met by a 4-check-in player (it lands at the first
check-in after enough materials exist).
