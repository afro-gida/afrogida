# Uc pazara minimum sepet ve ucretsiz teslimat tutarlarini girer
# (eski genel ayarlar: Gel-Al 200, Eve Servis 500, ucretsiz teslimat 1000 TL).
# Teslimat ucreti 50 TL. Once pazarlarin yedegini alir.
$sh = @'
set -e
TS=$(date +%Y%m%d-%H%M%S)
mongoexport --quiet --db test_database --collection markets --out /root/afro-proje-yedek/markets-yedek-$TS.json
echo "yedek: /root/afro-proje-yedek/markets-yedek-$TS.json"
mongosh --quiet test_database --eval '
const r = db.markets.updateMany({}, {$set: {gel_al_min_tutar: 200, eve_servis_min_tutar: 500, ucretsiz_teslimat_alt_limiti: 1000, teslimat_ucreti: 50}});
print("guncellenen pazar: " + r.modifiedCount);
db.markets.find({}, {_id:0, name:1, gel_al_min_tutar:1, eve_servis_min_tutar:1, ucretsiz_teslimat_alt_limiti:1, teslimat_ucreti:1}).forEach(m => printjson(m));
'
systemctl restart afro-backend
'@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh.Replace("`r`n", "`n")))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
