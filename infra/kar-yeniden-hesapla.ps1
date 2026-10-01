# Mevcut urunlerin satis fiyatini GUNCEL kar tablosuna gore yeniden hesaplar
# (backend/core/pricing.py ile ayni tablo). Kar tablosu degisince eski urunler
# kendiliginden degismez; bu betik onlari gunceller.
#   Onizleme (hicbir sey degismez):
#     powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\kar-yeniden-hesapla.ps1
#   Uygula (once urunlerin yedegini alir):
#     powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\infra\kar-yeniden-hesapla.ps1 -Uygula
param([switch]$Uygula)
$apply = if ($Uygula) { 'true' } else { 'false' }
$sh = @'
set -e
APPLY=__APPLY__
if [ "$APPLY" = "true" ]; then
  TS=$(date +%Y%m%d-%H%M%S)
  mongoexport --quiet --db test_database --collection products --out /root/afro-proje-yedek/products-yedek-$TS.json
  echo "yedek: /root/afro-proje-yedek/products-yedek-$TS.json"
fi
mongosh --quiet test_database --eval '
const APPLY = '"$APPLY"';
// backend/core/pricing.py PROFIT_TIERS ile AYNI: [ust sinir (haric), kar]
const TIERS = [[20,15],[40,25],[60,35],[90,50],[130,70],[180,90],[250,110],[350,150]];
const LAST_MAX = 500, LAST_PROFIT = 200;
function profitFor(p) {
  p = Math.round(Number(p || 0) * 100) / 100;
  if (p <= 0) return null;
  for (const [u, k] of TIERS) if (p < u) return k;
  return p <= LAST_MAX ? LAST_PROFIT : null;
}
function fields(p) {
  const k = profitFor(p); if (k == null) return null;
  const s = Math.round((Number(p) + k) * 100) / 100;
  return { profit_margin_amount: k, sale_price: s, price: s, gel_al_price: s, eve_servis_price: s };
}
let changed = 0, same = 0, skipped = 0;
db.products.find({ supplier_price: { $gt: 0 } }).forEach(pr => {
  const f = fields(pr.supplier_price);
  if (!f) { skipped++; print("ATLANDI (500 TL ustu): " + pr.name + " alis " + pr.supplier_price); return; }
  const set = {};
  if (pr.profit_margin_amount !== f.profit_margin_amount || pr.price !== f.price || pr.sale_price !== f.sale_price) Object.assign(set, f);
  // Onay bekleyen fiyat degisikligi de yeni tabloyla
  const ch = pr.pending_approval && pr.pending_approval.changes;
  if (ch && ch.supplier_price > 0) {
    const pf = fields(ch.supplier_price);
    if (pf) for (const key in pf) set["pending_approval.changes." + key] = pf[key];
  }
  if (Object.keys(set).length === 0) { same++; return; }
  changed++;
  print((pr.name || pr.id) + "  alis " + pr.supplier_price + "  satis " + pr.price + " -> " + f.price + "  (kar " + pr.profit_margin_amount + " -> " + f.profit_margin_amount + ")");
  if (APPLY) db.products.updateOne({ _id: pr._id }, { $set: { ...set, updated_at: new Date() } });
});
print("");
print((APPLY ? "GUNCELLENDI: " : "ONIZLEME (degisecek): ") + changed + " urun · ayni kalan: " + same + " · atlanan: " + skipped);
if (!APPLY) print("Uygulamak icin betigi -Uygula ile calistir.");
'
'@
$sh = $sh.Replace('__APPLY__', $apply)
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh.Replace("`r`n", "`n")))
ssh -o IdentitiesOnly=yes afrogida-vps "echo $b | base64 -d | sudo bash"
