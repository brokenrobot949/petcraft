# Art catalog (dev only)

Browse every PNG/GIF in the Ninja Adventure pack to pick sprites.

1. From the repo root, build the index (re-run if the pack changes):
   `powershell -ExecutionPolicy Bypass -File tools/catalog/build-index.ps1`
2. Start the static server:
   `powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080`
3. Open http://localhost:8080/tools/catalog/
4. Click a tile for a big view and a "Copy path" button; the path is the sprite's ID.

`files.json` is generated output. The page must be served over HTTP (not opened as a file).

## Casting (choosing which sprite plays each game role)

Start the server with `tools/serve.ps1` (needed for saving), open the catalog and click **Casting**.

1. The panel lists every role (Player, pet forms, mythics) with an animated preview of its current sprite.
2. Click **Choose** on a role, then click a sprite tile. In the big view press **Cast as ...**
   (the layout is detected automatically; a warning appears if the picture has the wrong shape).
   While choosing, a **Monsters / Bosses / Characters** chip helps narrow the grid.
   You can also open any sprite and use **Use for...** + **Cast**.
3. Press **Save casting & build atlas**. It writes `data/sprites.json` and runs `tools/atlas/pack.ps1`;
   the log is shown in the panel. **Revert** reloads the saved file. Without the dev server, use **Copy casting JSON**.
