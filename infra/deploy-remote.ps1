# Push the repo and deploy it on the VPS, in one shot, from this Windows machine.
#   ! powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\deploy-remote.ps1
#   ...  -Frontend         also sync frontend/ into the web root
#   ...  -Force            deploy even if origin/main == server HEAD
#   ...  -AllowApiChange   skip the OpenAPI contract guard (intended change)
#   ...  -NoPush           deploy only, don't push first
param([switch]$Frontend, [switch]$Force, [switch]$AllowApiChange, [switch]$NoPush)

$repo = "C:\Users\xxzar\projem"

if (-not $NoPush) {
    Write-Host "== git push ==" -ForegroundColor Cyan
    git -C $repo push
    if ($LASTEXITCODE -ne 0) { Write-Host "push failed, aborting" -ForegroundColor Red; exit 1 }
}

$remoteArgs = @()
if ($Force)          { $remoteArgs += "--force" }
if ($Frontend)       { $remoteArgs += "--frontend" }
if ($AllowApiChange) { $remoteArgs += "--allow-api-change" }

Write-Host "== afrogida-deploy $($remoteArgs -join ' ') ==" -ForegroundColor Cyan
ssh -o IdentitiesOnly=yes afrogida-vps "afrogida-deploy $($remoteArgs -join ' ')"
exit $LASTEXITCODE
