import { useEffect, useState } from 'react';
import { api, ApiError, BACKEND_ORIGIN, uploadFile } from '../lib/api';
import { formatDateTime, maskPhone } from '../lib/format';

interface ContractConfig {
  url?: string;
  version?: string;
  title?: string;
  updated_at?: string;
  updated_by?: string;
}

interface StaffUser {
  user_id: string;
  name?: string;
  phone?: string;
  supplier_group?: string;
  supplier_contract_accepted_version?: string | null;
  supplier_contract_accepted_at?: string | null;
}

function pdfSrc(url?: string) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`;
}

export default function SupplierContract() {
  const [contract, setContract] = useState<ContractConfig | null>(null);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('Tedarikçi Sözleşmesi');
  const [version, setVersion] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<ContractConfig>('/supplier-contract'),
      api.get<StaffUser[]>('/admin/staff'),
    ])
      .then(([c, s]) => {
        setContract(c);
        setStaff(s);
        setTitle(c.title || 'Tedarikçi Sözleşmesi');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleUpload(file: File) {
    setUploading(true);
    setFormError('');
    try {
      const res = await uploadFile(file);
      setPdfUrl(res.url);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!pdfUrl || !version.trim()) {
      setFormError('PDF yükle ve sürüm numarası gir (ör: 1.0, 2024-01)');
      return;
    }
    setSaving(true);
    setFormError('');
    setSaved(false);
    try {
      const updated = await api.post<ContractConfig>('/admin/supplier-contract', {
        url: pdfUrl,
        version: version.trim(),
        title: title.trim() || 'Tedarikçi Sözleşmesi',
      });
      setContract(updated);
      setPdfUrl('');
      setVersion('');
      setSaved(true);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  const currentVersion = contract?.version;
  const accepted = staff.filter((s) => currentVersion && s.supplier_contract_accepted_version === currentVersion);
  const pending = staff.filter((s) => !currentVersion || s.supplier_contract_accepted_version !== currentVersion);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Tedarikçi Sözleşmesi</h1>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Tedarikçiler panele girmeden önce bu sözleşmeyi onaylamak zorunda. Yeni bir PDF yükleyip sürüm
        değiştirirsen, tüm tedarikçiler tekrar onaylamak zorunda kalır.
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {!loading && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Yürürlükteki Sözleşme</div>
            {contract?.url ? (
              <>
                <div style={{ fontSize: 14 }}>{contract.title} — sürüm {contract.version}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Son güncelleme: {formatDateTime(contract.updated_at)}
                </div>
                <a href={pdfSrc(contract.url)} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>
                  PDF'i Görüntüle
                </a>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Henüz bir sözleşme yüklenmemiş.</div>
            )}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Yeni Sürüm Yükle</div>
            <div className="field">
              <label>Başlık</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>Sürüm (ör: 1.0, 2026-09)</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Yeni sürüm numarası" />
            </div>
            <div className="field">
              <label>PDF Dosyası</label>
              <input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} disabled={uploading} />
              {uploading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yükleniyor…</span>}
              {pdfUrl && <span style={{ fontSize: 13, color: 'var(--primary)' }}>PDF yüklendi ✓</span>}
            </div>
            {formError && <div className="error-text">{formError}</div>}
            {saved && !saving && <div style={{ color: 'var(--primary)', fontSize: 14 }}>Kaydedildi ✓</div>}
            <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={save}>
              {saving ? 'Kaydediliyor…' : 'Yayınla'}
            </button>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700 }}>
              Onay Durumu {currentVersion && `(sürüm ${currentVersion})`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-green">{accepted.length} onayladı</span>
              <span className="badge badge-orange">{pending.length} bekliyor</span>
            </div>
            {pending.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pending.map((s) => (
                  <div key={s.user_id} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {s.name || '—'} · {maskPhone(s.phone)} {s.supplier_group ? `· ${s.supplier_group}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
