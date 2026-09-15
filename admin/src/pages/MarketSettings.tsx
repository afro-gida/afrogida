import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Market } from '../lib/market-types';

interface FormState {
  active_eve_servis: boolean;
  eve_servis_urun_gorunurlugu: boolean;
  eve_servis_min_tutar: number | '';
  eve_servis_saati: string;

  active_gel_al: boolean;
  gel_al_min_tutar: number | '';
  gel_al_saati: string;

  teslimat_ucreti: number | '';
  ucretsiz_teslimat_alt_limiti: number | '';

  online_payment_enabled: boolean;
  kapida_nakit_odeme_enabled: boolean;
  nakit_tezgah_limit_enabled: boolean;
  nakit_tezgah_maksimum_tutari: number | '';

  pazar_saati: string;
}

function toForm(m: Market): FormState {
  return {
    active_eve_servis: m.active_eve_servis,
    eve_servis_urun_gorunurlugu: m.eve_servis_urun_gorunurlugu ?? true,
    eve_servis_min_tutar: m.eve_servis_min_tutar ?? 0,
    eve_servis_saati: m.eve_servis_saati ?? '00:00-23:59',
    active_gel_al: m.active_gel_al,
    gel_al_min_tutar: m.gel_al_min_tutar ?? 0,
    gel_al_saati: m.gel_al_saati ?? '00:00-23:59',
    teslimat_ucreti: m.teslimat_ucreti ?? 0,
    ucretsiz_teslimat_alt_limiti: m.ucretsiz_teslimat_alt_limiti ?? 0,
    online_payment_enabled: m.online_payment_enabled,
    kapida_nakit_odeme_enabled: m.kapida_nakit_odeme_enabled ?? true,
    nakit_tezgah_limit_enabled: m.nakit_tezgah_limit_enabled ?? false,
    nakit_tezgah_maksimum_tutari: m.nakit_tezgah_maksimum_tutari ?? 0,
    pazar_saati: m.pazar_saati ?? '00:00-23:59',
  };
}

export default function MarketSettings() {
  const { marketId } = useParams<{ marketId: string }>();
  const [market, setMarket] = useState<Market | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    api
      .get<Market[]>('/admin/markets')
      .then((all) => {
        const m = all.find((x) => x.id === marketId);
        if (!m) {
          setError('Pazar bulunamadı');
          return;
        }
        setMarket(m);
        setForm(toForm(m));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [marketId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function save() {
    if (!market || !form) return;
    setSaving(true);
    setError('');
    const payload = {
      name: market.name,
      day: market.day,
      google_maps_url: market.google_maps_url ?? null,
      image_url: market.image_url ?? null,
      delivery_neighborhoods: market.delivery_neighborhoods ?? [],
      location: market.location ?? '',
      note: market.note ?? '',
      location_url: market.location_url ?? '',
      active: market.active,
      orders_enabled: market.orders_enabled,
      delivery_enabled: market.delivery_enabled,
      ...form,
      eve_servis_min_tutar: form.eve_servis_min_tutar === '' ? 0 : Number(form.eve_servis_min_tutar),
      gel_al_min_tutar: form.gel_al_min_tutar === '' ? 0 : Number(form.gel_al_min_tutar),
      teslimat_ucreti: form.teslimat_ucreti === '' ? 0 : Number(form.teslimat_ucreti),
      ucretsiz_teslimat_alt_limiti: form.ucretsiz_teslimat_alt_limiti === '' ? 0 : Number(form.ucretsiz_teslimat_alt_limiti),
      nakit_tezgah_maksimum_tutari: form.nakit_tezgah_maksimum_tutari === '' ? 0 : Number(form.nakit_tezgah_maksimum_tutari),
    };
    try {
      await api.put(`/admin/markets/${market.id}`, payload);
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function resetDiscounts() {
    if (!market) return;
    setResetting(true);
    setError('');
    try {
      await api.post(`/admin/markets/${market.id}/reset-campaigns`, {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sıfırlanamadı');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>;
  if (error && !form) return <div className="error-text">{error}</div>;
  if (!form || !market) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/markets" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>{market.name} — Pazar Ayarları</h1>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Eve Servis</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={form.active_eve_servis} onChange={(e) => update('active_eve_servis', e.target.checked)} />
          Eve Servis Aktif — sipariş ve ürün görünürlüğü için genel anahtar
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={form.eve_servis_urun_gorunurlugu}
            onChange={(e) => update('eve_servis_urun_gorunurlugu', e.target.checked)}
          />
          Eve Servis Ürün Görünürlüğü — fiyatlar/ürünler müşteride görünür
        </label>
        <div className="field">
          <label>Eve Servis Minimum Tutar (₺)</label>
          <input
            type="number"
            value={form.eve_servis_min_tutar}
            onChange={(e) => update('eve_servis_min_tutar', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Eve Servis Saati (HH:MM-HH:MM)</label>
          <input value={form.eve_servis_saati} onChange={(e) => update('eve_servis_saati', e.target.value)} placeholder="00:00-23:00" />
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Gel-Al (Tezgahtan Teslim)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={form.active_gel_al} onChange={(e) => update('active_gel_al', e.target.checked)} />
          Gel-Al Aktif
        </label>
        <div className="field">
          <label>Gel-Al Minimum Tutar (₺)</label>
          <input
            type="number"
            value={form.gel_al_min_tutar}
            onChange={(e) => update('gel_al_min_tutar', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Gel-Al Saati (HH:MM-HH:MM)</label>
          <input value={form.gel_al_saati} onChange={(e) => update('gel_al_saati', e.target.value)} placeholder="11:00-19:00" />
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Teslimat</div>
        <div className="field">
          <label>Teslimat Ücreti (₺)</label>
          <input
            type="number"
            value={form.teslimat_ucreti}
            onChange={(e) => update('teslimat_ucreti', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Ücretsiz Teslimat Alt Limiti (₺) — 0 = kapalı</label>
          <input
            type="number"
            value={form.ucretsiz_teslimat_alt_limiti}
            onChange={(e) => update('ucretsiz_teslimat_alt_limiti', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Ödeme</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={form.online_payment_enabled} onChange={(e) => update('online_payment_enabled', e.target.checked)} />
          Online Ödeme
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={form.kapida_nakit_odeme_enabled}
            onChange={(e) => update('kapida_nakit_odeme_enabled', e.target.checked)}
          />
          Kapıda Nakit Ödeme
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={form.nakit_tezgah_limit_enabled}
            onChange={(e) => update('nakit_tezgah_limit_enabled', e.target.checked)}
          />
          Nakit/Tezgah Ödeme Limiti — açılırsa alttaki tutarın üzerinde sadece online ödeme kabul edilir
        </label>
        {form.nakit_tezgah_limit_enabled && (
          <div className="field">
            <label>Nakit/Tezgah Maksimum Tutarı (₺)</label>
            <input
              type="number"
              value={form.nakit_tezgah_maksimum_tutari}
              onChange={(e) => update('nakit_tezgah_maksimum_tutari', e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
        )}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Pazar Saati</div>
        <div className="field">
          <label>Pazar Saati (HH:MM-HH:MM) — sipariş alma bu aralıkta aktif, teslimat saatinden ayrı</label>
          <input value={form.pazar_saati} onChange={(e) => update('pazar_saati', e.target.value)} placeholder="00:00-22:00" />
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {saved && <div style={{ color: 'var(--primary)', fontSize: 14 }}>Kaydedildi.</div>}

      <button
        className="btn"
        style={{ background: 'var(--danger)' }}
        disabled={resetting}
        onClick={resetDiscounts}
      >
        🗑 {resetting ? 'Sıfırlanıyor…' : 'İndirimleri Sıfırla'}
      </button>
      <button className="btn" disabled={saving} onClick={save}>
        {saving ? 'Kaydediliyor…' : '💾 Ayarları Kaydet'}
      </button>
    </div>
  );
}
