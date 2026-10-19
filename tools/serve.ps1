# Dev-only static file server for local preview (no Python or Node needed).
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File tools/serve.ps1 [-Port 8080]
# Game:     http://localhost:8080/
# Catalog:  http://localhost:8080/tools/catalog/
param([int]$Port = 8080)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json'
  '.png' = 'image/png'; '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.ttf' = 'font/ttf'; '.woff2' = 'font/woff2'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.md' = 'text/plain; charset=utf-8'
}

# Dev-only: the art catalog POSTs the whole casting here. It is written to data/sprites.json and
# the atlas is rebuilt (tools/atlas/pack.ps1). Only accepted from pages this server served.
function Save-Casting($ctx) {
  $req = $ctx.Request
  $res = $ctx.Response
  $result = @{ ok = $false; log = '' }
  if ($req.HttpMethod -ne 'POST' -or $req.Headers['Origin'] -ne "http://localhost:$Port") {
    $res.StatusCode = 403
    $result.log = 'Only the catalog served by this server may save.'
  } else {
    $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
    try {
      $null = $body | ConvertFrom-Json
      $utf8 = New-Object Text.UTF8Encoding($false)
      [IO.File]::WriteAllText((Join-Path $root 'data/sprites.json'), $body, $utf8)
      $log = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools/atlas/pack.ps1') 2>&1 | Out-String
      $result.ok = ($LASTEXITCODE -eq 0)
      $result.log = $log.Trim()
    } catch {
      $res.StatusCode = 400
      $result.log = "Not saved: $($_.Exception.Message)"
    }
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json))
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      if ($ctx.Request.Url.AbsolutePath -eq '/__dev/cast') { Save-Casting $ctx; continue }
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root)) { $res.StatusCode = 403; continue }
      if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
      if (Test-Path $path -PathType Leaf) {
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $bytes = [IO.File]::ReadAllBytes($path)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
