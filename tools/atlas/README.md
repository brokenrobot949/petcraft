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

## Errors

Exit code 1 with a message naming the role if an image is missing, a frame lies outside its image,
a frame size doesn't divide a strip, a layout is unknown, or the atlas would exceed 1024x2048.
A fully transparent frame only prints a warning.
