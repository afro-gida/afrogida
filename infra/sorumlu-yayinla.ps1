# Sorumlu uygulamasini derleyip sorumlu.afrogida.com.tr'ye kurar / gunceller.
#   powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\sorumlu-yayinla.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $env:TEMP 'afro-sorumlu-web'
Push-Location (Join-Path $root 'sorumlu')
try {
    # Yerel gelistirme .env'si (localhost API adresi) yayin derlemesine karismasin
    $env:EXPO_NO_DOTENV = '1'
    $env:EXPO_PUBLIC_API_URL = '/api'
    npx expo export -p web --clear --output-dir $out | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Derleme basarisiz' }
} finally { Pop-Location }
$tgz = Join-Path $env:TEMP 'sorumlu-web.tgz'
tar -czf $tgz -C $out .
scp -o IdentitiesOnly=yes $tgz afrogida-vps:/tmp/sorumlu-web.tgz
scp -o IdentitiesOnly=yes (Join-Path $PSScriptRoot 'sorumlu-nginx.conf') afrogida-vps:/tmp/sorumlu-nginx.conf
$sh = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sorumlu-kur.sh')).Replace("`r`n", "`n")
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
