# Dev only: extracts the last released code of every old save version into tools/tests/old/v<N>/
# (gitignored), so tools/tests/saves.html can make real old saves with the old code and load them
# with the current code. Run from the repo root after adding a save version:
#   powershell -ExecutionPolicy Bypass -File tools/tests/extract-old.ps1
# Add a line to $versions for every SCHEMA_VERSION bump (the last commit that shipped that version).
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$versions = [ordered]@{
  1 = '013e1ab'  # Phase 1: art casting
  2 = '1d571a5'  # Phase 2: core simulation
  3 = '9d45e7c'  # Phase 3: pets
  4 = '2390425'  # Phases 4-5: crafting, homestead
  5 = '1d3aac3'  # Phase 6: village
  6 = '23bed00'  # Phase 7: taming and treasure
  7 = 'c732a02'  # Phase 8: evolution
  8 = '1d1fd95'  # Phases 9-10: endgame, tune and ship
  # Add the last commit of each new version here once it is replaced (v9: after the next schema bump).
}
Push-Location $root
try {
  foreach ($v in $versions.Keys) {
    $commit = $versions[[object]$v]  # by key (a bare int would index by position)
    $dest = Join-Path $root "tools/tests/old/v$v"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    New-Item -ItemType Directory -Force $dest | Out-Null
    $paths = @('js', 'data')
    if (git ls-tree -d --name-only $commit tools/sim) { $paths += 'tools/sim' }
    $tar = Join-Path $env:TEMP "petcraft-old-v$v.tar"
    git archive --format=tar -o $tar $commit @paths
    & (Join-Path $env:SystemRoot 'System32/tar.exe') -xf $tar -C $dest  # Windows tar (Git's tar misreads C: paths)
    Remove-Item $tar
    # Old loadData fetched data/ relative to the page; make it relative to the module instead.
    $dataJs = Join-Path $dest 'js/core/data.js'
    (Get-Content $dataJs -Raw).Replace('fetch(`data/${name}.json`)', 'fetch(new URL(`../../data/${name}.json`, import.meta.url))') |
      Set-Content $dataJs -Encoding utf8 -NoNewline
    # Old simulators: expose the game they played so the test can take its state.
    $simJs = Join-Path $dest 'tools/sim/sim.js'
    if (Test-Path $simJs) {
      (Get-Content $simJs -Raw).Replace('const game = createGame(data, s0, { clock: () => simNow });', 'const game = createGame(data, s0, { clock: () => simNow }); globalThis.__simGame = game;') |
        Set-Content $simJs -Encoding utf8 -NoNewline
    }
    Write-Host "v$v <- $commit"
  }
} finally {
  Pop-Location
}
