# Atlas packer

Dev-only tool. Cuts the sprites you cast in the art catalog out of the Ninja Adventure pack and
packs them into one image the game loads.

## Run

    powershell -NoProfile -ExecutionPolicy Bypass -File tools/atlas/pack.ps1

Options: `-SpritesPath <file>` (default `data/sprites.json`), `-OutDir <folder>` (default `assets/atlas`).
The art catalog's "Save casting" button (served by `tools/serve.ps1`) writes `data/sprites.json` and
runs this automatically, so you normally never run it by hand.

## Outputs

- `assets/atlas/atlas.png` - all frames, 2px transparent gaps, max 1024 wide.
- `assets/atlas/atlas.json` - PixiJS v8 spritesheet data: `frames`, `animations`, `meta`.

Same input always gives byte-identical output. Identical source cells (e.g. monster idle and walk)
share one region in the image.

## Input: data/sprites.json

- `directions`: `["down","up","left","right"]` - in sheets, column number = direction number.
- `layouts.<name>`: frame size, anchor, and `anims`. Each anim has `dirs`, `start [col,row]`, `frames`,
  `fps`, `loop`, optional `file` (a separate image in the same folder as the role's `src`) and `axis`.
- `roles.<id>`: `layout`, `src` (null = not cast yet, skipped), optional `face` image, optional
  `frameWidth`/`frameHeight` overriding the layout.
  Optional `x`/`y` give a pixel origin inside `src`, so a piece can be cut from a big tileset (frames then
  start at that pixel, not at a multiple of the frame size). Optional `anchor` [ax, ay] overrides the layout's
  anchor (used for the grip point of held tools; js/render/sprites.js reads it).
- Layout flags: `single: true` marks whole-picture layouts (`icon`, `held`, `prop`: one frame `idle`, frame
  name `<role>/idle/0`). `pad: true` (the `icon` layout) centres a smaller picture (frame size from the role,
  e.g. 15x15 or 10x13) inside the layout's 16x16 cell, so every item icon atlas frame is exactly 16x16.

Frames: `dirs: true` reads column `start+direction`, going down rows, as `<role>/<anim>_<dir>`.
`dirs: false` goes across a row (or down a column with `axis: "col"`), as `<role>/<anim>`.
`frames: 0` means as many as fit. Frame names are `<animKey>/<i>`; a face is `<role>/face`.

## Composite roles (`parts`)

A role on a single-picture layout (`prop`) may list `parts` instead of cutting one rectangle:

    "building.cottage.2": { "layout": "prop", "src": "<first part's src>", "frameWidth": 54, "frameHeight": 48,
      "parts": [ { "src": "Backgrounds/Tilesets/TilesetHouse.png", "x": 304, "y": 304, "w": 48, "h": 48, "dx": 0, "dy": 0 },
                 { "src": "Backgrounds/Tilesets/tileset_camp.png",  "x": 64,  "y": 80,  "w": 16, "h": 16, "dx": 38, "dy": 32 } ] }

The packer makes a transparent `frameWidth` x `frameHeight` canvas and pastes each part (cut from its
own `src` at `x,y,w,h`) at `dx,dy`, in list order (later parts on top). The result is one frame
`<role>/idle/0`, exactly like a prop. Keep `src` set to a real pack file (the first part's) so the art
catalog's checks still pass; `x`/`y` on the role itself are ignored when `parts` is present. Edge-aligned
parts: the bottom row of the canvas is the ground line, so crop tight at the bottom. Part pixels with
partial alpha are blended over what is already there; fully opaque pixels replace it.
Errors: a part outside its image, a part outside the canvas, an empty `parts` list, or `parts` on a
layout that is not single-picture.

## Errors

Exit code 1 with a message naming the role if an image is missing, a frame lies outside its image,
a frame size doesn't divide a strip, a layout is unknown, a composite part lies outside its image or the canvas, or the atlas would exceed 1024x2048.
A fully transparent frame only prints a warning.
