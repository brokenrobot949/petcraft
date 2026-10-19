$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packRoot = Join-Path $repoRoot 'assets-source/ninja-adventure/Ninja Adventure - Asset Pack'
if (-not (Test-Path -LiteralPath $packRoot)) { throw "Pack folder not found: $packRoot" }
$packRoot = (Resolve-Path -LiteralPath $packRoot).Path.TrimEnd('\')

$files = Get-ChildItem -LiteralPath $packRoot -Recurse -File |
    Where-Object { $_.Extension -match '^\.(png|gif)$' } |
    Sort-Object FullName

$entries = New-Object System.Collections.Generic.List[object]
foreach ($f in $files) {
    $rel = $f.FullName.Substring($packRoot.Length + 1).Replace('\', '/')
    $parts = $rel.Split('/')
    $cat = if ($parts.Length -gt 1) { $parts[0] } else { '(top level)' }
    $sub = if ($parts.Length -gt 2) { $parts[1] } else { '' }
    $w = 0; $h = 0
    try {
        $img = [System.Drawing.Image]::FromFile($f.FullName)
        try { $w = $img.Width; $h = $img.Height } finally { $img.Dispose() }
    } catch { Write-Warning "Could not read size: $rel" }
    $entries.Add([ordered]@{ path = $rel; category = $cat; subcategory = $sub; width = $w; height = $h })
}

$json = ConvertTo-Json -InputObject $entries.ToArray() -Depth 3
$out = Join-Path $PSScriptRoot 'files.json'
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $($entries.Count) entries to $out"
