param(
  [ValidateSet('check', 'doctor', 'doctor:deployment', 'install', 'project:init', 'persona:apply', 'persona:reload', 'dsh:restart', 'startup', 'shutdown', 'bot:status', 'dsh:start', 'dsh:smoke', 'discord:start', 'test:discord')]
  [string]$Task = 'check'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portableNode = Join-Path $projectRoot '.tools\node-v26.13.1-win-x64'
if (Test-Path -LiteralPath (Join-Path $portableNode 'node.exe')) {
  $env:PATH = "$portableNode;$env:PATH"
}
$portableMedia = Join-Path $projectRoot '.tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin'
if (Test-Path -LiteralPath (Join-Path $portableMedia 'ffmpeg.exe')) {
  $env:PATH = "$portableMedia;$env:PATH"
}
Push-Location -LiteralPath $projectRoot
try {
  if ($Task -eq 'install') {
    & npm.cmd install --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Root dependency install failed" }
    & npm.cmd ci --prefix apps/discord --ignore-scripts --no-audit --no-fund
  } else {
    & npm.cmd run $Task
  }
  if ($LASTEXITCODE -ne 0) { throw "Task failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
