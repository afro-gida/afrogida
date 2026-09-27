# Hesap sifirlamasindan artakalan, silinen hesaplara ait kayitlari temizler.
$sh = @'
mongosh --quiet test_database --eval '
for (const c of ["coupon_assignments","push_diag","push_tokens_debug","user_broadcast_reads"]) {
  print("SILINDI " + c + ": " + db[c].deleteMany({}).deletedCount);
}'
'@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh.Replace("`r`n", "`n")))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
