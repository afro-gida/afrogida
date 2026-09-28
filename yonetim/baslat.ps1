# Afro Gida Yonetim'i Windows'ta acar. Ilk calistirmada (veya -Yenile ile)
# uygulamayi derler, sonra yerel baslaticiyi calistirip tarayicida acar.
#   powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\yonetim\baslat.ps1 [-Yenile]
param([switch]$Yenile)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if ($Yenile -or -not (Test-Path "$PSScriptRoot\dist\index.html")) {
    Write-Host 'Uygulama derleniyor...'
    npx expo export -p web --output-dir dist | Out-Null
}
$py = Join-Path (Split-Path $PSScriptRoot -Parent) '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }
& $py "$PSScriptRoot\baslat.py"
