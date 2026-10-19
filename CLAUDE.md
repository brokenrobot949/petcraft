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
Phase: 1 done (2026-10-19)
Next: Phase 2 (core simulation).
Art casting: data/sprites.json maps roles (player, pet.<archetype>.<form>, mythic.<archetype>) to pack
  sprites; js/render/sprites.js loads the atlas and builds actors. The current picks are Claude's
  suggestions; Rob recasts in the catalog (http://localhost:8080/tools/catalog/ -> Casting -> Save),
  which writes sprites.json and runs tools/atlas/pack.ps1 via tools/serve.ps1. Then commit + bump version.
Known issues:
- Node is not installed. The atlas packer is PowerShell (tools/atlas/pack.ps1); the balance simulator
  (Phase 4) needs Node or a browser-page runner. Decide before Phase 4.
- Item icons and homestead pieces are cast in the phases that add items (2) and buildings (5).
- The player's tool overlays (Actor/CharacterAnimated/Weapon/*) are not packed yet; Phase 2 adds them.
- Tab icons and app icon are still placeholder pack sprites.
