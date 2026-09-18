import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Coupon, CouponForm } from '../lib/coupon-types';
import type { Member } from '../lib/types';
import { formatMoney, maskPhone } from '../lib/format';

const EMPTY_FORM: CouponForm = {
  code: '',
  title: '',
  description: '',
  discount_percent: 0,
  discount_amount: '',
  min_amount: '',
  members_only: true,
  single_use: false,
  active: true,
  valid_until: '',
};

type Mode = null | 'create' | 'edit' | 'assign-all' | 'assign-member' | 'default-new-member';

export default function Coupons() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [mode, setMode] = useState<Mode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // assign-all / assign-member ortak
  const [targetCouponId, setTargetCouponId] = useState('');
  const [limit, setLimit] = useState(1);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');

  const [defaultCouponId, setDefaultCouponId] = useState<string | null>(null);
  const [defaultCouponLimit, setDefaultCouponLimit] = useState(1);
  const [defaultFormCouponId, setDefaultFormCouponId] = useState('');
  const [defaultFormLimit, setDefaultFormLimit] = useState(1);

  interface SettingsResponse {
    new_member_coupon_id?: string | null;
    new_member_coupon_limit?: number;
  }

  function loadDefaultSetting() {
    api
      .get<SettingsResponse>('/settings')
      .then((s) => {
        setDefaultCouponId(s.new_member_coupon_id ?? null);
        setDefaultCouponLimit(s.new_member_coupon_limit ?? 1);
        setDefaultFormCouponId(s.new_member_coupon_id ?? '');
        setDefaultFormLimit(s.new_member_coupon_limit ?? 1);
      })
      .catch(() => {});
  }

  useEffect(loadDefaultSetting, []);

  async function saveDefaultCoupon(clear: boolean) {
    setSaving(true);
    setFormError('');
    try {
      await api.put('/admin/settings', {
        new_member_coupon_id: clear ? null : defaultFormCouponId || null,
        new_member_coupon_limit: clear ? defaultCouponLimit : defaultFormLimit,
      });
      loadDefaultSetting();
      if (clear) setMode(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  function load() {
    setLoading(true);
    setError('');
    api
      .get<Coupon[]>('/admin/coupons')
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Kuponlar yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    if (mode !== 'assign-member' || !memberSearch.trim()) {
      setMemberResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<Member[]>(`/admin/members?search=${encodeURIComponent(memberSearch.trim())}`)
        .then(setMemberResults)
        .catch(() => setMemberResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [mode, memberSearch]);

  function openCreate() {
    setMode('create');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  function openEdit(c: Coupon) {
    setMode('edit');
    setEditingId(c.id);
    setForm({
      code: c.code,
      title: c.title,
      description: c.description ?? '',
      discount_percent: c.discount_percent,
      discount_amount: c.discount_amount ?? '',
      min_amount: c.min_amount,
      members_only: c.members_only,
      single_use: c.single_use,
      active: c.active,
      valid_until: (c.valid_until ?? '').slice(0, 10),
    });
    setFormError('');
  }

  function closeForm() {
    setMode(null);
    setTargetCouponId('');
    setLimit(1);
    setMemberSearch('');
    setMemberResults([]);
    setSelectedMemberId('');
  }

  async function saveCoupon() {
    if (!form.code.trim() || !form.title.trim()) {
      setFormError('Kupon kodu ve başlık zorunlu');
      return;
    }
    setSaving(true);
    setFormError('');
    const payload = {
      code: form.code.trim(),
      title: form.title.trim(),
      description: form.description?.trim() || null,
      discount_percent: form.discount_amount === '' ? form.discount_percent : 0,
      discount_amount: form.discount_amount === '' ? null : Number(form.discount_amount),
      min_amount: form.min_amount === '' ? 0 : Number(form.min_amount),
      members_only: form.members_only,
      assigned_user_ids: [],
      single_use: form.single_use,
      active: form.active,
      valid_until: form.valid_until.trim() || null,
    };
    try {
      if (editingId) {
        await api.put(`/admin/coupons/${editingId}`, payload);
      } else {
        await api.post('/admin/coupons', payload);
      }
      closeForm();
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function removeCoupon(id: string) {
    try {
      await api.del(`/admin/coupons/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  async function submitAssignAll() {
    if (!targetCouponId) {
      setFormError('Kupon seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/admin/coupons/assign-all', { coupon_id: targetCouponId, limit });
      closeForm();
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Tanımlanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function submitAssignMember() {
    if (!targetCouponId || !selectedMemberId) {
      setFormError('Kupon ve üye seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/admin/coupons/assign-member', { coupon_id: targetCouponId, user_id: selectedMemberId, limit });
      closeForm();
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Tanımlanamadı');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Kuponlar</h1>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', minWidth: 0, paddingBottom: 4 }}>
          <button className="btn" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={openCreate}>
            + Yeni Kupon
          </button>
          <button
            className="btn btn-outline"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => { setMode('assign-all'); setFormError(''); }}
          >
            Tüm Üyelere Ver
          </button>
          <button
            className="btn btn-outline"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => { setMode('assign-member'); setFormError(''); }}
          >
            Kişiye Özel Tanımla
          </button>
          <button
            className="btn btn-outline"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => { setMode('default-new-member'); setFormError(''); }}
          >
            Yeni Üyelere Kupon Tanımla
          </button>
        </div>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {(mode === 'create' || mode === 'edit') && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>{mode === 'edit' ? 'Kuponu Düzenle' : 'Yeni Kupon'}</div>
            <button className="btn btn-outline" onClick={closeForm}>✕</button>
          </div>
          <div className="field">
            <label>Kupon Kodu</label>
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          </div>
          <div className="field">
            <label>Başlık</label>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>İndirim Tutarı (₺)</label>
              <input
                type="number"
                style={{ width: '100%' }}
                value={form.discount_amount}
                onChange={(e) => setForm((f) => ({ ...f, discount_amount: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>Alt Limit (₺)</label>
              <input
                type="number"
                style={{ width: '100%' }}
                value={form.min_amount}
                onChange={(e) => setForm((f) => ({ ...f, min_amount: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="field">
            <label>Son Kullanma Tarihi</label>
            <input
              type="date"
              value={form.valid_until.slice(0, 10)}
              onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.members_only}
              onChange={(e) => setForm((f) => ({ ...f, members_only: e.target.checked }))}
            />
            Sadece Üyelere Özel
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Aktif
          </label>
          {formError && <div className="error-text">{formError}</div>}
          <button className="btn" disabled={saving} onClick={saveCoupon}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      )}

      {(mode === 'assign-all' || mode === 'assign-member') && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>
              {mode === 'assign-all' ? 'Seçili Kuponu Tüm Üyelere Ver' : 'Kişiye Özel Kupon Tanımla'}
            </div>
            <button className="btn btn-outline" onClick={closeForm}>✕</button>
          </div>
          <div className="field">
            <label>Kupon</label>
            <select
              value={targetCouponId}
              onChange={(e) => setTargetCouponId(e.target.value)}
              style={{ background: '#0f0f0f', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
            >
              <option value="">Seçiniz…</option>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>
          {mode === 'assign-member' && (
            <div className="field">
              <label>Üye Ara (isim/telefon)</label>
              <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
              {memberResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {memberResults.map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      className={selectedMemberId === m.user_id ? 'btn' : 'btn btn-outline'}
                      style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                      onClick={() => setSelectedMemberId(m.user_id)}
                    >
                      {m.name} · {maskPhone(m.phone)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="field">
            <label>Kişi Başı Kullanım Hakkı</label>
            <input type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1)} />
          </div>
          {formError && <div className="error-text">{formError}</div>}
          <button className="btn" disabled={saving} onClick={mode === 'assign-all' ? submitAssignAll : submitAssignMember}>
            {saving ? 'Kaydediliyor…' : 'Uygula'}
          </button>
        </div>
      )}

      {mode === 'default-new-member' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>Yeni Üyelere Kupon Tanımla</div>
            <button className="btn btn-outline" onClick={closeForm}>✕</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {defaultCouponId
              ? `Şu an her yeni üyeye otomatik: ${items.find((c) => c.id === defaultCouponId)?.code ?? defaultCouponId} (${defaultCouponLimit} kullanım hakkı)`
              : 'Şu an yeni üyelere otomatik kupon tanımlı değil.'}
          </div>
          {defaultCouponId && (
            <button className="btn btn-outline" style={{ color: 'var(--danger)' }} disabled={saving} onClick={() => saveDefaultCoupon(true)}>
              🗑 Kaldır (yeni üyeler kupon almasın)
            </button>
          )}
          <div className="field">
            <label>Yeni Kupon Seç</label>
            <select
              value={defaultFormCouponId}
              onChange={(e) => setDefaultFormCouponId(e.target.value)}
              style={{ background: '#0f0f0f', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
            >
              <option value="">Seçiniz…</option>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Kişi Başı Kullanım Hakkı</label>
            <input type="number" min={1} value={defaultFormLimit} onChange={(e) => setDefaultFormLimit(Number(e.target.value) || 1)} />
          </div>
          {formError && <div className="error-text">{formError}</div>}
          <button className="btn" disabled={saving || !defaultFormCouponId} onClick={() => saveDefaultCoupon(false)}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((c) => (
          <div key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link to={`/coupons/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{c.code}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{c.title}</div>
                </div>
                {!c.active && <span className="badge badge-red">Pasif</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {formatMoney(c.discount_amount)} indirim
                {c.min_amount ? ` (Min: ${formatMoney(c.min_amount)})` : ''} · SKT: {c.valid_until || '—'} · Tanımlı üye:{' '}
                {c.assigned_user_ids?.length ?? 0}
              </div>
            </Link>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => openEdit(c)}>
                Düzenle
              </button>
              <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeCoupon(c.id)}>
                Sil
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
