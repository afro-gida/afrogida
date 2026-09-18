import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { maskPhone } from '../lib/format';
import type { Market } from '../lib/market-types';
import { MarketPicker } from '../components/MarketPicker';

interface PazarSorumlusu {
  user_id: string;
  name?: string;
  phone?: string;
  managed_markets?: string[];
}

interface StaffUser {
  user_id: string;
  name?: string;
  phone?: string;
  role?: string;
  supplier_group?: string;
}

interface CatalogConfig {
  suppliers: string[];
  supplier_markets: Record<string, string[]>;
  [key: string]: unknown;
}

export default function SorumluDetail() {
  const { userId } = useParams<{ userId: string }>();
  const [sorumlu, setSorumlu] = useState<PazarSorumlusu | null>(null);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [supplierGroups, setSupplierGroups] = useState<string[]>([]);
  const [catalogConfig, setCatalogConfig] = useState<CatalogConfig | null>(null);
  const [allMarkets, setAllMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [selectedSupplierGroup, setSelectedSupplierGroup] = useState('');
  const [selectedAssignMarkets, setSelectedAssignMarkets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function loadAll() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<PazarSorumlusu[]>('/admin/pazar-sorumlulari'),
      api.get<StaffUser[]>('/admin/staff'),
      api.get<string[]>('/admin/supplier-groups'),
      api.get<CatalogConfig>('/admin/catalog-config'),
      api.get<Market[]>('/admin/markets'),
    ])
      .then(([ps, s, sg, cfg, mk]) => {
        setSorumlu(ps.find((p) => p.user_id === userId) ?? null);
        setStaff(s);
        setSupplierGroups(sg);
        setCatalogConfig(cfg);
        setAllMarkets(mk);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, [userId]);

  function marketName(id: string) {
    return allMarkets.find((m) => m.id === id)?.name ?? id;
  }

  const managedMarketNames = (sorumlu?.managed_markets ?? []).map(marketName);

  // Bu sorumlunun pazarlarından en az birinde aktif olan tedarikçi grupları.
  const groupsUnderSorumlu = supplierGroups.filter((g) =>
    (catalogConfig?.supplier_markets?.[g] ?? []).some((m) => managedMarketNames.includes(m)),
  );

  function staffFor(group: string) {
    return staff.find((s) => s.supplier_group === group);
  }

  async function saveSupplierMarkets(group: string, markets: string[]) {
    if (!catalogConfig) return;
    const updated = { ...catalogConfig, supplier_markets: { ...catalogConfig.supplier_markets, [group]: markets } };
    await api.put('/admin/catalog-config', updated);
    setCatalogConfig(updated);
  }

  function toggleAssignMarket(name: string) {
    setSelectedAssignMarkets((prev) => (prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]));
  }

  async function assignSupplier() {
    if (!identifier.trim() || !selectedSupplierGroup || selectedAssignMarkets.length === 0) {
      setFormError('Telefon/ID, tedarikçi ve en az bir pazar seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/admin/staff/assign', { identifier: identifier.trim(), supplier_group: selectedSupplierGroup });
      const current = catalogConfig?.supplier_markets?.[selectedSupplierGroup] ?? [];
      const merged = Array.from(new Set([...current, ...selectedAssignMarkets]));
      await saveSupplierMarkets(selectedSupplierGroup, merged);
      setIdentifier('');
      setSelectedSupplierGroup('');
      setSelectedAssignMarkets([]);
      setFormError('');
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Atanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function removeFromMarkets(group: string) {
    if (!window.confirm(`"${group}" bu sorumlunun pazarlarından kaldırılsın mı? (Başka pazarda çalışıyorsa oradan etkilenmez.)`)) return;
    const remaining = (catalogConfig?.supplier_markets?.[group] ?? []).filter((m) => !managedMarketNames.includes(m));
    await saveSupplierMarkets(group, remaining);
    loadAll();
  }

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>;
  if (error) return <div className="error-text">{error}</div>;
  if (!sorumlu) return <div style={{ color: 'var(--text-muted)' }}>Pazar sorumlusu bulunamadı.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/staff" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{sorumlu.name || 'İsimsiz'}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{maskPhone(sorumlu.phone)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {managedMarketNames.map((m) => (
          <span key={m} className="badge badge-green">{m}</span>
        ))}
        {managedMarketNames.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sorumlu olduğu pazar yok.</span>}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Tedarikçi Ata</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Bu kişiyi bu sorumlunun pazarlarından birinde tedarikçi (esnaf) yap.
        </div>
        <div className="field">
          <label>Telefon veya Kullanıcı ID</label>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Kayıtlı üyenin telefon numarası" />
        </div>
        <div className="field">
          <label>Tedarikçi</label>
          <select
            value={selectedSupplierGroup}
            onChange={(e) => setSelectedSupplierGroup(e.target.value)}
            style={{ background: '#0f0f0f', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
          >
            <option value="">Seçiniz…</option>
            {supplierGroups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Pazar (bu sorumlunun pazarları arasından, birden fazla seçilebilir)</label>
          <MarketPicker
            options={managedMarketNames.map((m) => ({ key: m, label: m }))}
            selected={selectedAssignMarkets}
            onToggle={toggleAssignMarket}
          />
        </div>
        {formError && <div className="error-text">{formError}</div>}
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={assignSupplier}>
          {saving ? 'Kaydediliyor…' : 'Esnaf Yap'}
        </button>
      </div>

      <div style={{ fontWeight: 700 }}>Bu Sorumlunun Tedarikçileri</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groupsUnderSorumlu.map((g) => {
          const s = staffFor(g);
          const marketsForGroup = (catalogConfig?.supplier_markets?.[g] ?? []).filter((m) => managedMarketNames.includes(m));
          return (
            <div key={g} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{g}</div>
                {s && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.name} · {maskPhone(s.phone)}</div>}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {marketsForGroup.map((m) => (
                    <span key={m} className="badge badge-muted">{m}</span>
                  ))}
                </div>
              </div>
              <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeFromMarkets(g)}>
                Kaldır
              </button>
            </div>
          );
        })}
        {groupsUnderSorumlu.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>Bu sorumlunun pazarlarında henüz tedarikçi yok.</div>
        )}
      </div>
    </div>
  );
}
