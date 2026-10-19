# PetCraft — Claude Code Handoff

## How to start

Six setup steps for Rob, then one prompt per build phase. You never edit code; you test on your phone and report what you see.

1. **Make the repo.** On GitHub, create a public repo named `petcraft`. In Settings → Pages, deploy from the `main` branch, root folder.
2. **Get the art.** On a computer, open the [Ninja Adventure page](https://pixel-boy.itch.io/ninja-adventure-asset-pack), click Download Now, then "No thanks, just take me to the downloads," and download the asset pack zip.
3. **Set up the folder.** Clone the repo to your computer. Unzip the pack into `petcraft/assets-source/ninja-adventure/`.
4. **Add the docs.** Export each tab of this doc as Markdown: open the tab, click the doc's name → Export → Markdown (it exports the open tab only). Save the Game Design tab as `petcraft/docs/design.md` and this tab as `petcraft/docs/handoff.md`. Re-export whenever you edit the doc.
5. **Open Claude Code** in the `petcraft` folder, choose Opus 5.5, and paste the kickoff prompt below.
6. **Each phase after that:** paste the phase prompt, wait for the phone test checklist, test on your GitHub Pages link, and report back in plain words.

**Kickoff prompt**

```text
You are the lead developer for PetCraft, a mobile-first browser idle game.
Read docs/design.md (the game design) and docs/handoff.md (this build plan) in full.
Then:
1. Create CLAUDE.md from the "CLAUDE.md contents" section of docs/handoff.md.
2. Do Phase 0 exactly as written in the Build phases table.
3. Stop and tell me in plain language what you built and how to test it on my phone.
Follow the delegation plan: you own architecture, integration and review; hand bounded tasks to Sonnet or Haiku subagents where the plan says so.
Ask me before changing any locked decision.
```

**Phase prompt** (reuse for every phase; change the number)

```text
Do Phase N from docs/handoff.md. Delegate per the plan and review every subagent's work.
When done: run the phase's acceptance checks, push to main, update the Status section of CLAUDE.md,
and give me a short phone test checklist in plain language.
```

## Architecture

A plain static site: vanilla JavaScript modules, HTML and CSS menus, and one PixiJS canvas for scenes. Every rule and number lives in data files, and one simulation core runs live play, offline catch-up and the balance simulator.

**Stack**

- Vanilla JavaScript ES modules loaded natively by the browser. No framework, no bundler, no build step, no CDN, no npm packages at runtime.
- PixiJS (current major version) saved as a local file in `lib/`, used only for the Home scene and zone scenes. Rendering pauses when those tabs are hidden.
- All menus are HTML and CSS, styled with the pack's UI pieces and pixel font.
- Local preview needs a small web server (for example `python3 -m http.server`), because the game loads JSON data files.

**Folder layout**

```text
petcraft/
  index.html
  manifest.webmanifest
  sw.js                  service worker (offline play, updates)
  CLAUDE.md
  CREDITS.md
  css/
  lib/pixi.mjs           vendored PixiJS
  js/
    main.js
    core/                state, tick, offline catch-up, save, rng
    systems/             harvest, craft, pets, taming, treasure, homestead, economy, renown, endgame
    render/              home scene, zone scenes, sprite manager, recolor filter, effects
    ui/                  one module per tab, shared components
  data/                  every rule and number (see table)
  assets/                packed sprite atlas, audio actually used
  assets-source/         raw art pack (never shipped; listed in .gitignore)
  tools/                 art catalog, atlas packer, balance simulator (dev only)
  docs/                  design.md, handoff.md
```

**Data files**

| File | Holds |
| --- | --- |
| `balance.json` | every tunable number: XP curve, durations, odds, energy, prices, caps |
| `skills.json` | the ten skills and their tier levels |
| `zones.json` | zones, unlocks, materials per skill, wild archetypes, dig sites |
| `items.json` | every item: category, tier, sell price, food value, quality flag |
| `recipes.json` | recipes: station, inputs, output, skill level, craft time |
| `tools.json` | tool tiers and metals |
| `pets.json` | archetypes, forms, callings, catalysts, affinities, favorite foods |
| `talents.json` | hatchling, branch and gift talent pools |
| `buildings.json` | buildings, tier costs, effects, blueprints |
| `commissions.json` | commission templates and reward ranges |
| `achievements.json` | achievements and rewards |
| `renown.json` | ranks, titles, unlocks |
| `grandProjects.json` | projects, stages, deliveries, rewards |
| `sprites.json` | art casting: which sprite plays which role, animations, recolors |

**Simulation rules**

- Each system exposes a pure function that advances the game state by a span of time. Live play, offline catch-up and the balance simulator all call the same functions.
- A seeded random number generator lives in the save, so results are reproducible in tests.
- Offline catch-up advances in chunks (for example 60-second steps), not action by action. Target: 16 hours simulated in under 300 ms on a mid-range phone.
- The UI only reads state and sends commands; it never changes state directly.

## Save, offline and PWA rules

An idle game lives or dies by its save, so saves are versioned, backed up, exportable, and protected from iPhone storage clearing.

**Saves**

- Stored in localStorage under `petcraft.save` as JSON with a `version` number.
- Each version bump ships a migration. An existing save must never break.
- Before overwriting, validate the new save and keep the previous good one as `petcraft.save.bak`. On a corrupt load, fall back to the backup.
- Autosave every 30 seconds, when the page is hidden, and when it closes.
- Export and import in Journal → Settings: a copyable save code and a paste field.
- Ask the browser for persistent storage on first launch.

**Time**

- Elapsed time = now minus the last save time, capped at the offline cap.
- A negative elapsed time (the phone's clock moved back) counts as zero.

**Installable app (PWA)**

- Web manifest: name PetCraft, portrait, standalone display, icons made from pack sprites.
- Service worker caches every game file so it plays offline. Caches are version-stamped; a new version shows a "New version, tap to reload" bar.
- **iPhone storage:** Safari can clear site data for sites not visited in about a week, while home-screen apps are exempt. On iPhone Safari, show a one-time "Add to Home Screen" guide and suggest exporting a save code.

**Audio:** browsers block sound until the first tap; start audio on the first touch.

## CLAUDE.md contents

Claude Code creates `CLAUDE.md` from this block in Phase 0 and keeps its Status section current after every phase.

```markdown
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

## Status
Phase: 0 (not started)
Next: Phase 0
Known issues: none
```

## Model delegation plan

Opus 5.5 leads and owns anything where a mistake spreads; Sonnet and Haiku take bounded, spec-driven work that Opus reviews.

| Work | Model | Why |
| --- | --- | --- |
| Architecture, state schema, tick engine, offline catch-up | Opus 5.5 | everything else depends on it |
| Save system, migrations, export and import | Opus 5.5 | a bug here loses players' progress |
| Integration and review of every subagent's changes | Opus 5.5 | keeps the codebase consistent |
| Data files built from this spec (items, recipes, zones, talents, buildings) | Sonnet | large but rule-driven |
| DOM screens for each tab | Sonnet | bounded, follows shared components |
| Art catalog page and atlas packer | Sonnet | self-contained dev tools |
| PixiJS scenes against interfaces Opus defines | Sonnet | visual work inside fixed boundaries |
| Running the balance simulator and reporting results | Sonnet | repetitive runs, Opus decides changes |
| Flavor text: item descriptions, commission notes, journal entries, species names | Haiku | high volume, low risk |
| CREDITS.md and simple data consistency checks | Haiku | mechanical |

**Rules for every subagent task:** one task, the exact files it may touch, and the acceptance checks it must pass. Subagents never change the state schema or the structure of `balance.json`. Parallel subagents only on files that don't overlap.

## Build phases

Eleven phases, each ending in a playable build on GitHub Pages. Phases 0–4 make the core loop playable; 5–7 build the world; 8–9 add depth and the ending; 10 tunes and ships.

| Phase | Builds | Acceptance checks | Rob's part |
| --- | --- | --- | --- |
| 0. Foundation | Folder layout, CLAUDE.md, page shell with the 5 bottom tabs, manifest and service worker, vendored PixiJS, save skeleton with export and import, art catalog page | The Pages link loads on a phone; it installs to the home screen; tabs switch; the catalog shows every pack sprite with its file name | Test on phone |
| 1. Art casting | `sprites.json` from Rob's picks, atlas packer, a test scene | The atlas loads; the test scene shows the player and four starter pets animating at crisp scale | Pick sprites in the catalog (Claude Code serves it on your computer) |
| 2. Core simulation | State, tick engine, offline catch-up, Meadowfold with all 5 harvesting skills for the player, bag, skill XP, "While you were away" | Harvest 5 minutes, close, reopen an hour later: offline gains are correct and capped; the save survives a reload | Test offline gains |
| 3. Pets | Egg choice, hatch and name, 2 active slots, energy, rest, auto-feed, pet XP, Bond and daily pat, pets harvesting | A pet works about 3 hours on a full bar, rests, eats from the pantry; the pat gives Bond once a day | Name your first pet |
| 4. Crafting | 4 stations, queues, Focus tap, quality, tool tiers 1–2, meals and buffs; balance simulator v1 | The copper axe chain works end to end; queues finish offline; the simulator runs 30 days and reports | Try the Focus tap |
| 5. Homestead | Home scene, building plots and tiers, bonuses, Cottage cap, polish layer v1 (day/night, particles, hops, shadows) | Every building shows a new look per tier; bonuses apply; 30+ frames per second on a mid-range phone | Feedback on look and feel |
| 6. Village and progression | Mossbrook market, coins, commissions, achievements, Renown ranks, zones 2–5 with scenes, tool tiers 3–6 | Each zone opens at its rank; commissions reset at local midnight; every coin source has a sink | Play a few days |
| 7. Taming and treasure | Tracking, traps, bait, lures, Stable capacity, maps, dig sites, Nest and eggs | A full catch works offline; catch-chance math matches the spec; eggs hatch | Tame a second pet |
| 8. Evolution | Callings, branch choice, catalysts, talents, gifts, station assists, Bestiary | A pet evolves through both stages; assists apply to the right station | Choose a branch |
| 9. Endgame | Grand Projects, story journal and scenes, ending, Heartgrove, mythics, Starmetal, Elder Grove, heir eggs, Mastery stars | A save can be pushed through all 5 projects in a test mode; retiring a pet gives its bonus and heir egg | Read the story beats |
| 10. Tune and ship | Simulator tuning to the pacing targets, audio, save stress tests, performance pass, credits, iPhone install guide | Pacing within 25% of targets; no save loss across version updates; offline catch-up under 300 ms | Final playtest |

- **Test mode:** from Phase 2 on, a hidden developer panel (opened from Settings) can grant items, skip time and jump to a phase's content, so each phase can be checked quickly. It is removed from the shipped build in Phase 10.
- **Content pass:** full recipe lists, talents, achievements and commission templates are written by subagents in the phase that first needs them, following the rules in the design tab.

## Balance simulator

A dev-only tool that plays the real game systems at high speed with scripted players, so pacing is tuned by evidence rather than guesswork. First version in Phase 4; full tuning in Phase 10.

- **Where:** `tools/sim/`, run with Node. It imports the same system modules the game uses; no copied logic.
- **Players:** "regular" checks in 4 times a day (8:00, 12:30, 18:00, 22:00); "light" checks in twice (8:00, 20:00). Each check-in spends about 3 minutes of decisions.
- **Policy:** always refill queues, upgrade the cheapest useful building, keep pets fed, take every commission it can finish, tame when a Stable slot is free, evolve as soon as allowed, push Grand Projects once open.
- **Run:** 90 simulated days in under a minute, with a fixed seed so runs are comparable.
- **Output:** a CSV plus an HTML report charting skill levels, Renown, coins and stockpiles by day, with the day each pacing milestone was hit.
- **Flags:** any milestone more than 25% off its target; any item that piles up with no use; any skill or building the policy never touches; coin balance trending only up.
- **Tuning loop:** change only `data/balance.json`, rerun, compare to the previous run. Opus decides each change; a Sonnet subagent runs and reports.
