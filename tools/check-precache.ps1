# Dev check: every shipped file must be listed in sw.js FILES (or the game breaks offline),
# and every listed file must exist.
# Usage (from the repo root): powershell -ExecutionPolicy Bypass -File tools/check-precache.ps1
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sw = Get-Content (Join-Path $root 'sw.js') -Raw
$listed = [regex]::Matches(($sw -split 'const FILES = \[')[1].Split(']')[0], "'([^']+)'") | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne './' }

$shippedDirs = 'css', 'lib', 'js', 'data', 'assets'
$shipped = @('index.html', 'version.js', 'manifest.webmanifest')
foreach ($d in $shippedDirs) {
  $p = Join-Path $root $d
  if (Test-Path $p) {
    $shipped += Get-ChildItem $p -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
  }
}

# Music (assets/audio/music) is too big to precache: it must be in the MUSIC list instead, and is cached on first play.
$music = [regex]::Matches(($sw -split 'const MUSIC = \[')[1].Split(']')[0], "'([^']+)'") | ForEach-Object { $_.Groups[1].Value }
$shippedMusic = $shipped | Where-Object { $_ -like 'assets/audio/music/*' }
$shipped = $shipped | Where-Object { $_ -notlike 'assets/audio/music/*' }
$missing = $shipped | Where-Object { $listed -notcontains $_ }
$missing += $shippedMusic | Where-Object { $music -notcontains $_ } | ForEach-Object { "$_ (add to MUSIC)" }
$extraMusic = $music | Where-Object { -not (Test-Path (Join-Path $root $_)) }
$listedInFiles = $listed | Where-Object { $_ -like 'assets/audio/music/*' }
foreach ($m in $listedInFiles) { Write-Host "MUSIC FILE IN FILES (move to MUSIC): $m" }
$extra = @($listed | Where-Object { -not (Test-Path (Join-Path $root $_)) }) + $extraMusic
foreach ($m in $missing) { Write-Host "NOT IN sw.js: $m" }
foreach ($e in $extra) { Write-Host "LISTED BUT MISSING: $e" }
if ($missing -or $extra -or $listedInFiles) { exit 1 }
Write-Host "OK: $($listed.Count) files listed, all shipped files covered, $($music.Count) music tracks in MUSIC."
