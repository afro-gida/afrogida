# Trigger a deploy on the VPS from this Windows machine.
#   ! powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\deploy-remote.ps1
#   ...  -Frontend      also sync frontend/ into the web root
#   ...  -Force         deploy even if origin/main == server HEAD
param([switch]$Frontend, [switch]$Force)

$remoteArgs = @()
if ($Force)    { $remoteArgs += "--force" }
if ($Frontend) { $remoteArgs += "--frontend" }

Write-Host "== afrogida-deploy $($remoteArgs -join ' ') ==" -ForegroundColor Cyan
ssh -o IdentitiesOnly=yes afrogida-vps "afrogida-deploy $($remoteArgs -join ' ')"
exit $LASTEXITCODE
