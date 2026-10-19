# Art catalog (dev only)

Browse every PNG/GIF in the Ninja Adventure pack to pick sprites.

1. From the repo root, build the index (re-run if the pack changes):
   `powershell -ExecutionPolicy Bypass -File tools/catalog/build-index.ps1`
2. Start the static server:
   `powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080`
3. Open http://localhost:8080/tools/catalog/
4. Click a tile for a big view and a "Copy path" button; the path is the sprite's ID.

`files.json` is generated output. The page must be served over HTTP (not opened as a file).
