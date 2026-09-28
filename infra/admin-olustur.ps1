# Afro Gida - TEK yonetici hesabini olusturur (admin hesabi disaridan / API'den
# olusturulamaz; sadece bu betikle, sunucuda elle).
#
# ONEMLI: Bu betigi Claude'a "!" ile DEGIL, kendi PowerShell pencerenizde
# calistirin - sifre ekrana/sohbete yazilmaz, sunucuya sadece bcrypt ozeti gider.
#   powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\admin-olustur.ps1
$ErrorActionPreference = 'Stop'
$py = Join-Path (Split-Path $PSScriptRoot -Parent) '.venv\Scripts\python.exe'

$username = (Read-Host 'Yonetici kullanici adi (kucuk harf, bosluksuz)').Trim().ToLower()
if ($username -notmatch '^[a-z0-9._-]{4,32}$') { throw 'Kullanici adi 4-32 karakter; harf, rakam, nokta, tire.' }
$name = (Read-Host 'Gorunen ad (or: Ahmet)').Trim()
$name = $name -replace '["''\\`$]', ''
if (-not $name) { $name = 'Yonetici' }

$p1 = Read-Host 'Sifre (en az 12 karakter)' -AsSecureString
$p2 = Read-Host 'Sifre (tekrar)' -AsSecureString
$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
if ($plain1 -ne $plain2) { throw 'Sifreler ayni degil.' }
if ($plain1.Length -lt 12) { throw 'Sifre en az 12 karakter olmali.' }

# bcrypt ozeti yerelde hesaplanir; sifre komut satirina degil ortam degiskenine konur
$env:AFRO_PW = $plain1
$hash = & $py -c "import bcrypt,os;print(bcrypt.hashpw(os.environ['AFRO_PW'].encode(),bcrypt.gensalt(12)).decode())"
Remove-Item Env:\AFRO_PW
$plain1 = $null; $plain2 = $null
if ($hash -notmatch '^\$2[aby]\$') { throw 'Sifre ozeti uretilemedi.' }

$sh = @"
mongosh --quiet test_database --eval '
if (db.users.countDocuments({role: {`$in: ["admin", "yonetici"]}}) > 0) { print("HATA: sistemde zaten bir yonetici var. Tek yonetici kurali."); quit(1); }
db.users.insertOne({user_id: "admin_" + new ObjectId().toString().slice(-10), username: "$username", name: "$name",
  role: "admin", auth_type: "username", email: null, phone: null, password_hash: "$hash", created_at: new Date()});
print("YONETICI OLUSTURULDU: $username");'
"@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh.Replace("`r`n", "`n")))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
Write-Host ''
Write-Host 'Ilk giriste kod SMS ile kayitli yonetici numarasina gelir; ardindan uygulama'
Write-Host 'authenticator kurulumunu zorunlu olarak ister.'
