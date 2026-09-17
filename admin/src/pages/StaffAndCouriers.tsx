import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { maskPhone } from '../lib/format';
import type { Market } from '../lib/market-types';
import { MarketPicker } from '../components/MarketPicker';

interface CourierUser {
  user_id: string;
  name?: string;
  phone?: string;
  role?: string;
  courier_markets?: string[];
  courier_is_online?: boolean;
}

interface PazarSorumlusu {
  user_id: string;
  name?: string;
  phone?: string;
  managed_markets?: string[];
}

type Tab = 'couriers' | 'sorumlular';

export default function StaffAndCouriers() {
  const [tab, setTab] = useState<Tab>('sorumlular');

  const [couriers, setCouriers] = useState<CourierUser[]>([]);
  const [marketOptions, setMarketOptions] = useState<string[]>([]);
  const [sorumlular, setSorumlular] = useState<PazarSorumlusu[]>([]);
  const [allMarkets, setAllMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [selectedManagedMarketIds, setSelectedManagedMarketIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function loadAll() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<CourierUser[]>('/admin/couriers'),
      api.get<{ markets: string[] }>('/admin/courier-markets'),
      api.get<PazarSorumlusu[]>('/admin/pazar-sorumlulari'),
      api.get<Market[]>('/admin/markets'),
    ])
      .then(([c, cm, ps, mk]) => {
        setCouriers(c);
        setMarketOptions(cm.markets);
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
    setSelectedMarkets([]);
    setSelectedManagedMarketIds([]);
    setFormError('');
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
      <h1 style={{ fontSize: 22, margin: 0 }}>Sorumlu / Kurye</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className={tab === 'sorumlular' ? 'btn' : 'btn btn-outline'} onClick={() => { setTab('sorumlular'); resetForm(); }}>
          Pazar Sorumluları
        </button>
        <button className={tab === 'couriers' ? 'btn' : 'btn btn-outline'} onClick={() => { setTab('couriers'); resetForm(); }}>
          Kuryeler
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

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
              <MarketPicker
                options={marketOptions.map((m) => ({ key: m, label: m }))}
                selected={selectedMarkets}
                onToggle={toggleMarket}
              />
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
              <MarketPicker
                options={allMarkets.map((m) => ({ key: m.id, label: m.name }))}
                selected={selectedManagedMarketIds}
                onToggle={toggleManagedMarket}
              />
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={assignSorumlu}>
              {saving ? 'Kaydediliyor…' : 'Pazar Sorumlusu Yap'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorumlular.map((p) => (
              <div key={p.user_id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link to={`/staff/sorumlu/${p.user_id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{p.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>→ detay</span></div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{maskPhone(p.phone)}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {(p.managed_markets ?? []).map((mid) => (
                      <span key={mid} className="badge badge-green">{marketName(mid)}</span>
                    ))}
                  </div>
                </Link>
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
