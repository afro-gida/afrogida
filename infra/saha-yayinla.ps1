# Tedarikci + Kurye (saha) uygulamasini derleyip saha.afrogida.com.tr'ye kurar / gunceller.
#   powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\saha-yayinla.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $env:TEMP 'afro-saha-web'
Push-Location (Join-Path $root 'saha')
try {
    $env:EXPO_PUBLIC_API_URL = '/api'
    npx expo export -p web --output-dir $out | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Derleme basarisiz' }
} finally { Pop-Location }
$tgz = Join-Path $env:TEMP 'saha-web.tgz'
tar -czf $tgz -C $out .
scp -o IdentitiesOnly=yes $tgz afrogida-vps:/tmp/saha-web.tgz
scp -o IdentitiesOnly=yes (Join-Path $PSScriptRoot 'saha-nginx.conf') afrogida-vps:/tmp/saha-nginx.conf
$sh = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'saha-kur.sh')).Replace("`r`n", "`n")
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
