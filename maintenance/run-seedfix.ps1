# Afro Gida - security audit finding #1
# Delete the fixed-password seeded admin accounts, deploy the patched server.py, restart.
# Run:  ! powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\maintenance\run-seedfix.ps1
$ErrorActionPreference = "Stop"
$KEY   = "C:\Users\xxzar\AppData\Local\Temp\claude\C--Users-xxzar-projem\606c080d-eda8-4be6-a9bd-f885b7755574\scratchpad\projem_key"
$RHOST = "ubuntu@54.38.26.227"
$RB    = "/root/afro-proje-yedek/afro-proje/backend"
$PY    = "$RB/venv/bin/python3"
$SSH   = @("-i", $KEY, "-o", "IdentitiesOnly=yes", $RHOST)

function Step($n) { Write-Host "`n=== $n ===" -ForegroundColor Cyan }

Step "1/4  Remote checksum (must match the pre-patch value)"
ssh @SSH "sha256sum $RB/server.py"
Write-Host "expected (PRE-patch): e3f62b87ab39e1613e098d9e30906b17a2dc6a0009adcab135bb4664be5f9bf7"

Step "2/4  Back up + delete the seeded admin accounts"
scp -i $KEY -o IdentitiesOnly=yes "C:\Users\xxzar\projem\maintenance\2026-09-10-remove-seeded-admin.py" "${RHOST}:/tmp/rm_seed.py"
ssh @SSH "sudo $PY /tmp/rm_seed.py; rm -f /tmp/rm_seed.py"

Step "3/4  Back up server.py + deploy patched copy + restart"
ssh @SSH "sudo cp -a $RB/server.py $RB/server.py.bak-seedfix-`$(date +%Y%m%d-%H%M%S)"
scp -i $KEY -o IdentitiesOnly=yes "C:\Users\xxzar\projem\backend\server.py" "${RHOST}:/tmp/server.py.new"
ssh @SSH "sudo $PY -c 'import ast; ast.parse(open(\`"/tmp/server.py.new\`").read()); print(\`"remote syntax OK\`")' && sudo install -m 644 -o root -g root /tmp/server.py.new $RB/server.py && rm -f /tmp/server.py.new && sudo systemctl restart afro-backend"

Step "4/4  Verify"
Start-Sleep -Seconds 4
ssh @SSH "systemctl is-active afro-backend; curl -s -o /dev/null -w 'api HTTP: %{http_code}\n' https://afrogida.com.tr/api/; echo '--- recent logs ---'; sudo tail -n 12 $RB/backend.log"
Write-Host "`nDone. Test the admin login (05380557577) from your phone." -ForegroundColor Green
