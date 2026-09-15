import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { maskPhone } from '../lib/format';
import type { Market } from '../lib/market-types';

interface StaffUser {
  user_id: string;
  name?: string;
  phone?: string;
  role?: string;
  supplier_group?: string;
}

interface CourierUser {
  user_id: string;
  name?: string;
  phone?: string;
  role?: string;
  courier_markets?: string[];
  courier_is_online?: boolean;
}

interface CatalogConfig {
  suppliers: string[];
  supplier_markets: Record<string, string[]>;
  [key: string]: unknown;
}

interface PazarSorumlusu {
  user_id: string;
  name?: string;
  phone?: string;
  managed_markets?: string[];
}

type Tab = 'suppliers' | 'couriers' | 'sorumlular';

export default function StaffAndCouriers() {
  const [tab, setTab] = useState<Tab>('suppliers');

  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [supplierGroups, setSupplierGroups] = useState<string[]>([]);
  const [couriers, setCouriers] = useState<CourierUser[]>([]);
  const [marketOptions, setMarketOptions] = useState<string[]>([]);
  const [catalogConfig, setCatalogConfig] = useState<CatalogConfig | null>(null);
  const [sorumlular, setSorumlular] = useState<PazarSorumlusu[]>([]);
  const [allMarkets, setAllMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [selectedSupplierGroup, setSelectedSupplierGroup] = useState('');
  const [selectedSupplierMarkets, setSelectedSupplierMarkets] = useState<string[]>([]);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [selectedManagedMarketIds, setSelectedManagedMarketIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [removingGroupBusy, setRemovingGroupBusy] = useState(false);

  function loadAll() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<StaffUser[]>('/admin/staff'),
      api.get<string[]>('/admin/supplier-groups'),
      api.get<CourierUser[]>('/admin/couriers'),
      api.get<{ markets: string[] }>('/admin/courier-markets'),
      api.get<CatalogConfig>('/admin/catalog-config'),
      api.get<PazarSorumlusu[]>('/admin/pazar-sorumlulari'),
      api.get<Market[]>('/admin/markets'),
    ])
      .then(([s, sg, c, cm, cfg, ps, mk]) => {
        setStaff(s);
        setSupplierGroups(sg);
        setCouriers(c);
        setMarketOptions(cm.markets);
        setCatalogConfig(cfg);
        setSorumlular(ps);
        setAllMarkets(mk);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  function marketName(id: string) {
    return allMarkets.find((m) => m.id === id)?.name ?? id;
  }

  function toggleManagedMarket(id: string) {
    setSelectedManagedMarketIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function assignSorumlu() {
    if (!identifier.trim() || selectedManagedMarketIds.length === 0) {
      setFormError('Telefon/ID ve en az bir pazar seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/admin/pazar-sorumlusu/assign', {
        identifier: identifier.trim(),
        managed_markets: selectedManagedMarketIds,
      });
      resetForm();
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Atanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function removeSorumlu(userId: string) {
    try {
      await api.post('/admin/pazar-sorumlusu/assign', { identifier: userId, managed_markets: [] });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    }
  }

  useEffect(loadAll, []);

  function resetForm() {
    setIdentifier('');
    setSelectedSupplierGroup('');
    setSelectedSupplierMarkets([]);
    setSelectedMarkets([]);
    setSelectedManagedMarketIds([]);
    setFormError('');
  }

  function selectSupplierGroup(group: string) {
    setSelectedSupplierGroup(group);
    setSelectedSupplierMarkets(catalogConfig?.supplier_markets?.[group] ?? []);
  }

  function toggleSupplierMarket(name: string) {
    setSelectedSupplierMarkets((prev) => (prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]));
  }

  async function saveSupplierMarkets(group: string, marketsForGroup: string[]) {
    if (!catalogConfig) return;
    const updated = {
      ...catalogConfig,
      supplier_markets: { ...catalogConfig.supplier_markets, [group]: marketsForGroup },
    };
    await api.put('/admin/catalog-config', updated);
    setCatalogConfig(updated);
  }

  async function removeSupplierGroupFromList(group: string) {
    if (!catalogConfig) return;
    setRemovingGroupBusy(true);
    setError('');
    try {
      const remainingSuppliers = catalogConfig.suppliers.filter((g) => g !== group);
      const remainingMarkets = { ...catalogConfig.supplier_markets };
      delete remainingMarkets[group];
      const updated = { ...catalogConfig, suppliers: remainingSuppliers, supplier_markets: remainingMarkets };
      await api.put('/admin/catalog-config', updated);
      setCatalogConfig(updated);
      setSupplierGroups(remainingSuppliers);
      if (selectedSupplierGroup === group) {
        setSelectedSupplierGroup('');
        setSelectedSupplierMarkets([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    } finally {
      setRemovingGroupBusy(false);
    }
  }

  async function assignSupplier() {
    if (!identifier.trim() || !selectedSupplierGroup) {
      setFormError('Telefon/ID ve tedarikçi seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/admin/staff/assign', { identifier: identifier.trim(), supplier_group: selectedSupplierGroup });
      await saveSupplierMarkets(selectedSupplierGroup, selectedSupplierMarkets);
      resetForm();
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Atanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function removeSupplier(userId: string) {
    try {
      await api.put(`/admin/staff/${userId}`, { supplier_group: null });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    }
  }

  function toggleMarket(name: string) {
    setSelectedMarkets((prev) => (prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]));
  }

  async function assignCourier() {
    if (!identifier.trim() || selectedMarkets.length === 0) {
      setFormError('Telefon/ID ve en az bir pazar seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/admin/courier/assign', { identifier: identifier.trim(), courier_markets: selectedMarkets });
      resetForm();
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Atanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function removeCourier(userId: string) {
    try {
      await api.post('/admin/courier/assign', { identifier: userId, courier_markets: [] });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    }
  }

  function editCourierRegions(c: CourierUser) {
    setIdentifier(c.user_id);
    setSelectedMarkets(c.courier_markets ?? []);
    setFormError('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Tedarikçi / Kurye</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className={tab === 'sorumlular' ? 'btn' : 'btn btn-outline'} onClick={() => { setTab('sorumlular'); resetForm(); }}>
          Pazar Sorumluları
        </button>
        <button className={tab === 'suppliers' ? 'btn' : 'btn btn-outline'} onClick={() => { setTab('suppliers'); resetForm(); }}>
          Tedarikçiler
        </button>
        <button className={tab === 'couriers' ? 'btn' : 'btn btn-outline'} onClick={() => { setTab('couriers'); resetForm(); }}>
          Kuryeler
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {tab === 'suppliers' && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Tedarikçi Ata</div>
            <div className="field">
              <label>Telefon veya Kullanıcı ID</label>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Kayıtlı üyenin telefon numarası" />
            </div>
            <div className="field">
              <label>Tedarikçi</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={selectedSupplierGroup}
                  onChange={(e) => selectSupplierGroup(e.target.value)}
                  style={{ flex: 1, background: '#0a130e', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
                >
                  <option value="">Seçiniz…</option>
                  {supplierGroups.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                {selectedSupplierGroup && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ color: 'var(--danger)', flexShrink: 0 }}
                    disabled={removingGroupBusy}
                    onClick={() => removeSupplierGroupFromList(selectedSupplierGroup)}
                  >
                    Listeden Sil
                  </button>
                )}
              </div>
            </div>
            {selectedSupplierGroup && (
              <div className="field">
                <label>Pazar (aktif olacağı pazarlar, birden fazla seçilebilir)</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {marketOptions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={selectedSupplierMarkets.includes(m) ? 'btn' : 'btn btn-outline'}
                      style={{ fontSize: 13, padding: '6px 12px' }}
                      onClick={() => toggleSupplierMarket(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {formError && <div className="error-text">{formError}</div>}
            <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={assignSupplier}>
              {saving ? 'Kaydediliyor…' : 'Esnaf Yap'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {staff.map((s) => (
              <div key={s.user_id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{maskPhone(s.phone)}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className="badge badge-green">{s.supplier_group}</span>
                    {(catalogConfig?.supplier_markets?.[s.supplier_group ?? ''] ?? []).map((m) => (
                      <span key={m} className="badge badge-muted">{m}</span>
                    ))}
                  </div>
                </div>
                <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeSupplier(s.user_id)}>
                  Kaldır
                </button>
              </div>
            ))}
            {!loading && staff.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Atanmış tedarikçi yok.</div>}
          </div>
        </>
      )}

      {tab === 'couriers' && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Kurye Ata</div>
            <div className="field">
              <label>Telefon veya Kullanıcı ID</label>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Kayıtlı üyenin telefon numarası" />
            </div>
            <div className="field">
              <label>Aktif Olacak Pazarlar (birden fazla seçilebilir)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {marketOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={selectedMarkets.includes(m) ? 'btn' : 'btn btn-outline'}
                    style={{ fontSize: 13, padding: '6px 12px' }}
                    onClick={() => toggleMarket(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={assignCourier}>
              {saving ? 'Kaydediliyor…' : 'Kurye Yap'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {couriers.map((c) => (
              <div key={c.user_id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{maskPhone(c.phone)}</div>
                  </div>
                  <span className={`badge ${c.courier_is_online ? 'badge-green' : 'badge-muted'}`}>
                    {c.courier_is_online ? 'Açık' : 'Kapalı'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{(c.courier_markets ?? []).join(', ') || '—'}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline" onClick={() => editCourierRegions(c)}>Bölge Değiştir</button>
                  <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeCourier(c.user_id)}>Kaldır</button>
                </div>
              </div>
            ))}
            {!loading && couriers.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Atanmış kurye yok.</div>}
          </div>
        </>
      )}

      {tab === 'sorumlular' && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Pazar Sorumlusu Ata</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Bu kişi sadece seçtiğin pazar(lar)daki tedarikçileri yönetebilir, admin paneline erişemez.
            </div>
            <div className="field">
              <label>Telefon veya Kullanıcı ID</label>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Kayıtlı üyenin telefon numarası" />
            </div>
            <div className="field">
              <label>Sorumlu Olacağı Pazarlar (birden fazla seçilebilir)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {allMarkets.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={selectedManagedMarketIds.includes(m.id) ? 'btn' : 'btn btn-outline'}
                    style={{ fontSize: 13, padding: '6px 12px' }}
                    onClick={() => toggleManagedMarket(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={assignSorumlu}>
              {saving ? 'Kaydediliyor…' : 'Pazar Sorumlusu Yap'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorumlular.map((p) => (
              <div key={p.user_id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{maskPhone(p.phone)}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {(p.managed_markets ?? []).map((mid) => (
                      <span key={mid} className="badge badge-green">{marketName(mid)}</span>
                    ))}
                  </div>
                </div>
                <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeSorumlu(p.user_id)}>
                  Kaldır
                </button>
              </div>
            ))}
            {!loading && sorumlular.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Atanmış pazar sorumlusu yok.</div>}
          </div>
        </>
      )}
    </div>
  );
}
