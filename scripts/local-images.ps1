<#
.SYNOPSIS
  Équivalent LOCAL (Docker Desktop) du pipeline `ci-cd.yml` : build + enregistrement + deploy
  de l'image prod-like pour les 4 environnements (development/staging/preprod/production).

.DESCRIPTION
  - build    : builde le SPA en NATIF (ng build) puis l'image `app_sdgps` (Dockerfile.local),
               et la tague par env (image agnostique → 1 build, N tags, comme CI) + sha + latest.
  - register : (store Docker Desktop) réapplique les tags par env et les liste. Pas de push externe.
  - deploy   : lance chaque env via docker-compose.prod-local.yml (app + Postgres pour les serveurs),
               app+API sur UN seul port (dev 8085 / staging 8086 / preprod 8087 / prod 8088).
  - all      : build → register → deploy.
  - down     : arrête/supprime les conteneurs d'un ou tous les env (-Volumes pour purger les bases).

.EXAMPLE
  .\scripts\local-images.ps1 -Action all
  .\scripts\local-images.ps1 -Action deploy -Environment staging
  .\scripts\local-images.ps1 -Action down -Environment all -Volumes
#>
[CmdletBinding()]
param(
    [ValidateSet('build', 'register', 'deploy', 'all', 'down')]
    [string]$Action = 'all',

    [ValidateSet('all', 'development', 'staging', 'preprod', 'production')]
    [string]$Environment = 'all',

    # Pour -Action down : supprime aussi les volumes (bases Postgres).
    [switch]$Volumes
)

$ErrorActionPreference = 'Stop'

# --- Constantes / chemins ---
$Image      = 'app_sdgps'
$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Compose    = Join-Path $RepoRoot 'docker-compose.prod-local.yml'
$AllEnvs    = @('development', 'staging', 'preprod', 'production')
$Envs       = if ($Environment -eq 'all') { $AllEnvs } else { @($Environment) }
# Port hôte par env (miroir de BACKEND_PORT dans backend/.env.<env>, pour l'affichage des URLs).
$PortByEnv  = @{ development = 8085; staging = 8086; preprod = 8087; production = 8088 }

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string[]]$Args)
    & $Exe @Args
    if ($LASTEXITCODE -ne 0) { throw "Échec: $Exe $($Args -join ' ') (code $LASTEXITCODE)" }
}

function Get-ShortSha {
    try {
        $sha = (& git -C $RepoRoot rev-parse --short HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $sha) { return $sha.Trim() }
    } catch {}
    return $null
}

function Do-Build {
    Write-Step "BUILD 1/2 — SPA Angular en NATIF (ng build --configuration production)"
    Push-Location (Join-Path $RepoRoot 'frontend')
    try { Invoke-Checked npx @('ng', 'build', '--configuration', 'production') }
    finally { Pop-Location }
    $dist = Join-Path $RepoRoot 'frontend/dist/frontend/index.html'
    if (-not (Test-Path $dist)) { throw "SPA introuvable après build: $dist" }

    Write-Step "BUILD 2/2 — Image Docker prod-like (Dockerfile.local)"
    Invoke-Checked docker @('build', '-f', (Join-Path $RepoRoot 'Dockerfile.local'), '-t', "${Image}:build", $RepoRoot)

    Do-Register  # tags par env dès le build (image agnostique)
}

function Do-Register {
    Write-Step "REGISTER — tags par environnement (store Docker Desktop)"
    $sha = Get-ShortSha
    foreach ($e in $AllEnvs) {
        Invoke-Checked docker @('tag', "${Image}:build", "${Image}:$e")
        Write-Host "  ${Image}:$e"
    }
    Invoke-Checked docker @('tag', "${Image}:build", "${Image}:latest")
    if ($sha) { Invoke-Checked docker @('tag', "${Image}:build", "${Image}:sha-$sha"); Write-Host "  ${Image}:sha-$sha" }
    Write-Host ""
    & docker image ls $Image
}

function Compose-Args([string]$e) {
    # Projet compose DÉDIÉ (sdgps-prod-<env>) : isole ce pipeline du dev-split, qui utilise
    # le projet sdgps-<env> (via COMPOSE_PROJECT_NAME du .env). `-p` prime sur cette variable.
    $args = @('-p', "sdgps-prod-$e", '-f', $Compose, '--env-file', (Join-Path $RepoRoot "backend/.env.$e"))
    if ($e -ne 'development') { $args += @('--profile', 'postgres') }  # Postgres pour les env serveur
    return $args
}

function Do-Deploy {
    foreach ($e in $Envs) {
        Write-Step "DEPLOY — $e"
        $ca = Compose-Args $e
        Invoke-Checked docker (@('compose') + $ca + @('up', '-d'))
        $port = $PortByEnv[$e]
        Write-Host "  → http://localhost:$port  (app + API, même origine)" -ForegroundColor Green
    }
}

function Do-Down {
    foreach ($e in $Envs) {
        Write-Step "DOWN — $e"
        $ca = Compose-Args $e
        $down = @('compose') + $ca + @('down', '--remove-orphans')
        if ($Volumes) { $down += '-v' }
        & docker @down
    }
}

switch ($Action) {
    'build'    { Do-Build }
    'register' { Do-Register }
    'deploy'   { Do-Deploy }
    'all'      { Do-Build; Do-Deploy }
    'down'     { Do-Down }
}

Write-Host "`n✅ Terminé ($Action / $Environment)." -ForegroundColor Green
