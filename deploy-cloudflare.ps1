$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDir = Join-Path $root 'backend-worker'
$frontendDir = Join-Path $root 'frontend'

function Write-Step($text) {
  Write-Host "`n=== $text ==="
}

Write-Step 'Create or confirm D1 database'
$d1 = wrangler d1 create betting-simulator-db 2>$null
Write-Host $d1

Write-Step 'Apply local D1 migration'
Push-Location $workerDir
npm run migrate:local
Pop-Location

Write-Step 'Deploy Worker'
Push-Location $workerDir
$workerDeploy = wrangler deploy
Write-Host $workerDeploy
Pop-Location

if ($workerDeploy -match 'https://([^\s]+\.workers\.dev)') {
  $workerUrl = $Matches[1]
} elseif ($workerDeploy -match '(https://[^\s]+\.workers\.dev)') {
  $workerUrl = $Matches[1]
} else {
  throw 'Could not parse Worker URL from wrangler output.'
}

Write-Host "Worker URL: https://$workerUrl/api"

Write-Step 'Build frontend for Pages'
Push-Location $frontendDir
$env:VITE_API_BASE_URL = "https://$workerUrl/api"
npm run build
Pop-Location

Write-Step 'Deploy frontend to Cloudflare Pages'
Push-Location $frontendDir
wrangler pages deploy dist --project-name betting-simulator-web
Pop-Location

Write-Step 'Done'
Write-Host "Frontend deployed to Cloudflare Pages project: betting-simulator-web"
Write-Host "Backend deployed to Cloudflare Workers: $workerUrl"
