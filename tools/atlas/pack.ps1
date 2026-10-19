# PetCraft sprite atlas packer (dev-only). Windows PowerShell 5.1 + System.Drawing, no Node/Python.
# Reads data/sprites.json, cuts the cast frames out of the Ninja Adventure pack, packs them into
# assets/atlas/atlas.png + atlas.json (PixiJS v8 spritesheet format). Output is deterministic.
# Usage (repo root): powershell -NoProfile -ExecutionPolicy Bypass -File tools/atlas/pack.ps1
param(
  [string]$SpritesPath = '',
  [string]$OutDir = '',
  [string]$PackRoot = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $SpritesPath) { $SpritesPath = Join-Path $repo 'data\sprites.json' }
if (-not $OutDir) { $OutDir = Join-Path $repo 'assets\atlas' }
if (-not $PackRoot) { $PackRoot = Join-Path $repo 'assets-source\ninja-adventure\Ninja Adventure - Asset Pack' }

$PAD = 2; $MAXW = 1024; $MAXH = 2048

function Fail([string]$msg) {
  [Console]::Error.WriteLine("PACK FAILED: $msg")
  exit 1
}
function JStr([string]$s) { '"' + ($s.Replace('\', '\\').Replace('"', '\"')) + '"' }

# ---- image cache: file -> @{ W; H; Px (byte[] BGRA, stride W*4) } ----
$imgCache = @{}
function Get-Img([string]$rel, [string]$what) {
  $full = [IO.Path]::GetFullPath((Join-Path $PackRoot ($rel -replace '/', '\')))
  if ($imgCache.ContainsKey($full)) { return $imgCache[$full] }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Fail "$what : image file not found: $rel" }
  $bmp = $null
  try {
    $src = New-Object System.Drawing.Bitmap($full)
    $bmp = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose(); $src.Dispose()
  } catch { Fail "$what : cannot read image $rel ($($_.Exception.Message))" }
  $w = $bmp.Width; $h = $bmp.Height
  $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $w, $h)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $px = New-Object byte[] ($w * $h * 4)
  for ($y = 0; $y -lt $h; $y++) {
    [Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $px, $y * $w * 4, $w * 4)
  }
  $bmp.UnlockBits($data); $bmp.Dispose()
  $o = @{ W = $w; H = $h; Px = $px; Key = $full }
  $imgCache[$full] = $o
  return $o
}

# ---- load data ----
if (-not (Test-Path -LiteralPath $SpritesPath)) { Fail "sprites file not found: $SpritesPath" }
try { $spr = [IO.File]::ReadAllText($SpritesPath) | ConvertFrom-Json } catch { Fail "sprites.json is not valid JSON: $($_.Exception.Message)" }
$dirs = @($spr.directions)
$version = $spr.version

# regions: key -> @{ Img; X; Y; W; H }   frames: ordered list of @{ Name; Region }   anims: ordered list of @{ Key; Frames }
$regions = @{}
$frames = New-Object System.Collections.ArrayList
$anims = New-Object System.Collections.ArrayList
$frameNames = @{}
$packed = 0; $skipped = New-Object System.Collections.ArrayList

function Add-Region($img, [int]$x, [int]$y, [int]$w, [int]$h, [string]$what) {
  if ($x -lt 0 -or $y -lt 0 -or $x + $w -gt $img.W -or $y + $h -gt $img.H) {
    Fail "$what : frame rectangle x=$x y=$y w=$w h=$h is outside the image ($($img.W)x$($img.H))"
  }
  $k = "$($img.Key)|$x|$y|$w|$h"
  if (-not $regions.ContainsKey($k)) {
    # transparency check
    $any = $false
    for ($yy = $y; $yy -lt $y + $h -and -not $any; $yy++) {
      $o = ($yy * $img.W + $x) * 4 + 3
      for ($xx = 0; $xx -lt $w; $xx++) { if ($img.Px[$o + $xx * 4] -ne 0) { $any = $true; break } }
    }
    if (-not $any) { Write-Host "WARN: $what : frame at x=$x y=$y is fully transparent" }
    $regions[$k] = @{ Img = $img; SX = $x; SY = $y; W = $w; H = $h; X = 0; Y = 0; Key = $k }
  }
  return $regions[$k]
}
function Add-Frame([string]$name, $region) {
  if ($frameNames.ContainsKey($name)) { Fail "duplicate frame name $name" }
  $frameNames[$name] = $true
  [void]$frames.Add(@{ Name = $name; Region = $region })
}

foreach ($rp in $spr.roles.PSObject.Properties) {
  $id = $rp.Name; $role = $rp.Value
  if (-not $role.src) { [void]$skipped.Add($id); Write-Host "note: $id not cast yet, skipped"; continue }
  $layout = $spr.layouts.PSObject.Properties[$role.layout]
  if (-not $layout) { Fail "role $id : unknown layout '$($role.layout)'" }
  $layout = $layout.Value
  $fw = [int]$layout.frameWidth; $fh = [int]$layout.frameHeight
  if ($role.PSObject.Properties['frameWidth'] -and $role.frameWidth) { $fw = [int]$role.frameWidth }
  if ($role.PSObject.Properties['frameHeight'] -and $role.frameHeight) { $fh = [int]$role.frameHeight }
  if ($fw -le 0 -or $fh -le 0) { Fail "role $id : bad frame size ${fw}x${fh}" }
  $srcDir = ''
  if ($role.src.Contains('/')) { $srcDir = $role.src.Substring(0, $role.src.LastIndexOf('/') + 1) }

  foreach ($ap in $layout.anims.PSObject.Properties) {
    $an = $ap.Name; $a = $ap.Value
    $what = "role $id anim $an"
    $file = $role.src
    if ($a.PSObject.Properties['file'] -and $a.file) { $file = $srcDir + $a.file }
    $img = Get-Img $file $what
    $sx = [int]$a.start[0]; $sy = [int]$a.start[1]; $n = [int]$a.frames
    $isDirs = [bool]$a.dirs
    $axis = 'row'
    if ($a.PSObject.Properties['axis'] -and $a.axis) { $axis = $a.axis }
    if ($isDirs) {
      if ($n -eq 0) {
        if ($img.H % $fh -ne 0) { Fail "$what : frame height $fh does not divide image height $($img.H) ($file)" }
        $n = [int][Math]::Floor($img.H / $fh) - $sy
      }
      for ($d = 0; $d -lt $dirs.Count; $d++) {
        $key = "$id/${an}_$($dirs[$d])"
        $list = New-Object System.Collections.ArrayList
        for ($i = 0; $i -lt $n; $i++) {
          $reg = Add-Region $img (($sx + $d) * $fw) (($sy + $i) * $fh) $fw $fh "$what dir $($dirs[$d]) frame $i"
          Add-Frame "$key/$i" $reg; [void]$list.Add("$key/$i")
        }
        [void]$anims.Add(@{ Key = $key; Frames = $list })
      }
    } else {
      if ($n -eq 0) {
        if ($axis -eq 'col') {
          if ($img.H % $fh -ne 0) { Fail "$what : frame height $fh does not divide image height $($img.H) ($file)" }
          $n = [int][Math]::Floor($img.H / $fh) - $sy
        } else {
          if ($img.W % $fw -ne 0) { Fail "$what : frame width $fw does not divide image width $($img.W) ($file)" }
          $n = [int][Math]::Floor($img.W / $fw) - $sx
        }
      }
      if ($n -le 0) { Fail "$what : no frames fit from start [$sx,$sy] in $file" }
      $key = "$id/$an"
      $list = New-Object System.Collections.ArrayList
      for ($i = 0; $i -lt $n; $i++) {
        if ($axis -eq 'col') { $px0 = $sx * $fw; $py0 = ($sy + $i) * $fh } else { $px0 = ($sx + $i) * $fw; $py0 = $sy * $fh }
        $reg = Add-Region $img $px0 $py0 $fw $fh "$what frame $i"
        Add-Frame "$key/$i" $reg; [void]$list.Add("$key/$i")
      }
      [void]$anims.Add(@{ Key = $key; Frames = $list })
    }
  }

  if ($role.PSObject.Properties['face'] -and $role.face) {
    $fimg = Get-Img $role.face "role $id face"
    $reg = Add-Region $fimg 0 0 $fimg.W $fimg.H "role $id face"
    Add-Frame "$id/face" $reg
  }
  $packed++
}

# ---- pack: shelf packer, sorted by height desc, width desc, key ----
$sorted = @($regions.Values | Sort-Object @{ Expression = { $_.H }; Descending = $true }, @{ Expression = { $_.W }; Descending = $true }, @{ Expression = { $_.Key } })
$cx = 0; $cy = 0; $shelfH = 0; $usedW = 0
foreach ($r in $sorted) {
  $cw = $r.W + $PAD; $ch = $r.H + $PAD
  if ($r.W -gt $MAXW) { Fail "a region of $($r.W)px is wider than the atlas limit $MAXW" }
  if ($cx + $r.W -gt $MAXW) { $cy += $shelfH; $cx = 0; $shelfH = 0 }
  $r.X = $cx; $r.Y = $cy
  $cx += $cw
  if ($ch -gt $shelfH) { $shelfH = $ch }
  if ($r.X + $r.W -gt $usedW) { $usedW = $r.X + $r.W }
}
$atlasW = $usedW; $atlasH = $cy + $shelfH - $(if ($sorted.Count) { $PAD } else { 0 })
if ($atlasH -lt 1) { $atlasH = 1 }; if ($atlasW -lt 1) { $atlasW = 1 }
if ($atlasH -gt $MAXH) { Fail "atlas would be ${atlasW}x${atlasH}, taller than the limit $MAXH" }

# ---- compose pixels ----
$out = New-Object byte[] ($atlasW * $atlasH * 4)
foreach ($r in $sorted) {
  $img = $r.Img
  for ($y = 0; $y -lt $r.H; $y++) {
    [Array]::Copy($img.Px, (($r.SY + $y) * $img.W + $r.SX) * 4, $out, (($r.Y + $y) * $atlasW + $r.X) * 4, $r.W * 4)
  }
}
$bmp = New-Object System.Drawing.Bitmap($atlasW, $atlasH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $atlasW, $atlasH)), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for ($y = 0; $y -lt $atlasH; $y++) {
  [Runtime.InteropServices.Marshal]::Copy($out, $y * $atlasW * 4, [IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $atlasW * 4)
}
$bmp.UnlockBits($data)
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$pngPath = Join-Path $OutDir 'atlas.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ---- JSON ----
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("{`n  `"frames`": {`n")
for ($i = 0; $i -lt $frames.Count; $i++) {
  $f = $frames[$i]; $r = $f.Region
  [void]$sb.Append("    $(JStr $f.Name): {`"frame`":{`"x`":$($r.X),`"y`":$($r.Y),`"w`":$($r.W),`"h`":$($r.H)},`"rotated`":false,`"trimmed`":false,`"spriteSourceSize`":{`"x`":0,`"y`":0,`"w`":$($r.W),`"h`":$($r.H)},`"sourceSize`":{`"w`":$($r.W),`"h`":$($r.H)}}")
  if ($i -lt $frames.Count - 1) { [void]$sb.Append(',') }
  [void]$sb.Append("`n")
}
[void]$sb.Append("  },`n  `"animations`": {`n")
for ($i = 0; $i -lt $anims.Count; $i++) {
  $names = ($anims[$i].Frames | ForEach-Object { JStr $_ }) -join ','
  [void]$sb.Append("    $(JStr $anims[$i].Key): [$names]")
  if ($i -lt $anims.Count - 1) { [void]$sb.Append(',') }
  [void]$sb.Append("`n")
}
[void]$sb.Append("  },`n  `"meta`": {`"image`":`"atlas.png`",`"format`":`"RGBA8888`",`"size`":{`"w`":$atlasW,`"h`":$atlasH},`"scale`":1,`"spritesVersion`":$version}`n}`n")
$jsonPath = Join-Path $OutDir 'atlas.json'
[IO.File]::WriteAllText($jsonPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host "Atlas packed: $packed roles packed, $($skipped.Count) skipped (uncast)"
Write-Host "  frames: $($frames.Count)   animations: $($anims.Count)   unique regions: $($sorted.Count)"
Write-Host "  atlas size: ${atlasW}x${atlasH}"
Write-Host "  atlas.png: $((Get-Item $pngPath).Length) bytes   atlas.json: $((Get-Item $jsonPath).Length) bytes"
exit 0
