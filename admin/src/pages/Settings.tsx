import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface SettingsResponse {
  coupon_anomaly_detection_enabled?: boolean;
  coupon_anomaly_discount_threshold?: number;
  support_phone?: string;
}

export default function Settings() {
  const [anomalyEnabled, setAnomalyEnabled] = useState(true);
  const [anomalyBusy, setAnomalyBusy] = useState(false);
  const [threshold, setThreshold] = useState<number | ''>('');
  const [thresholdSaved, setThresholdSaved] = useState<number | ''>('');
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [supportPhone, setSupportPhone] = useState('');
  const [supportPhoneSaved, setSupportPhoneSaved] = useState('');
  const [supportPhoneBusy, setSupportPhoneBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get<SettingsResponse>('/settings')
      .then((s) => {
        setAnomalyEnabled(s.coupon_anomaly_detection_enabled ?? true);
        const t = s.coupon_anomaly_discount_threshold ?? 500;
        setThreshold(t);
        setThresholdSaved(t);
        setSupportPhone(s.support_phone ?? '');
        setSupportPhoneSaved(s.support_phone ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Ayarlar yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleAnomalyDetection() {
    setAnomalyBusy(true);
    setError('');
    try {
      await api.put('/admin/settings', { coupon_anomaly_detection_enabled: !anomalyEnabled });
      setAnomalyEnabled((v) => !v);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Değiştirilemedi');
    } finally {
      setAnomalyBusy(false);
    }
  }

  async function saveThreshold() {
    if (threshold === '' || Number(threshold) <= 0) {
      setError('Geçerli bir tutar girin');
      return;
    }
    setThresholdBusy(true);
    setError('');
    try {
      await api.put('/admin/settings', { coupon_anomaly_discount_threshold: Number(threshold) });
      setThresholdSaved(threshold);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setThresholdBusy(false);
    }
  }

  async function saveSupportPhone() {
    setSupportPhoneBusy(true);
    setError('');
    try {
      await api.put('/admin/settings', { support_phone: supportPhone.trim() });
      setSupportPhoneSaved(supportPhone.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSupportPhoneBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Ayarlar</h1>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700 }}>İletişim</div>
        <div className="field">
          <label>Destek Telefonu — mahalle listesi gibi yerlerde müşteriye gösterilir</label>
          <input value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="0538 055 75 77" />
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={supportPhoneBusy || supportPhone === supportPhoneSaved} onClick={saveSupportPhone}>
          {supportPhoneBusy ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700 }}>Anormal Kupon Kullanımı Uyarısı</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Açıkken: çok fazla kullanım, çok yüksek indirim vb. durumlarda sana SMS gider. Açıp kapatman da ayrıca
            sana SMS ile bildirilir.
          </div>
          <button
            className={anomalyEnabled ? 'btn' : 'btn btn-outline'}
            disabled={anomalyBusy}
            onClick={toggleAnomalyDetection}
            style={{ flexShrink: 0 }}
          >
            {anomalyBusy ? '…' : anomalyEnabled ? 'Açık' : 'Kapalı'}
          </button>
        </div>

        <div className="field">
          <label>Uyarı Eşiği — Bu tutarın (₺) üzerindeki kupon indirimlerinde uyar</label>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={thresholdBusy || threshold === thresholdSaved} onClick={saveThreshold}>
          {thresholdBusy ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}
