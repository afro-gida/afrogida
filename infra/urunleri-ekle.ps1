# Test sitesindeki (afrogida_staging) urunleri canli siteye ekler.
# Once canli veritabaninin yedegini alir; siparislere / kullanicilara dokunmaz.
$sh = [IO.File]::ReadAllText('C:\Users\xxzar\AppData\Local\Temp\claude\C--Users-xxzar-projem\cf894d47-a418-4e2e-8793-ab9e1028971a\scratchpad\urun-kopyala.sh').Replace("`r`n", "`n")
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
