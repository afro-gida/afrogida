import { useState } from 'react';

export interface MarketPickerOption {
  key: string;
  label: string;
}

/** Arama kutulu, çoklu-seçimli pazar seçici (pill listesi). Pazar sayısı arttıkça
 * elle kaydırıp bulmak yerine yazarak filtrelemek için - Sorumlu/Kurye/Tedarikçi
 * atama formlarının hepsinde aynı desen. Seçili olanlar arama sırasında bile
 * listeden kaybolmaz. */
export function MarketPicker({
  options,
  selected,
  onToggle,
  placeholder = 'Pazar ara…',
}: {
  options: MarketPickerOption[];
  selected: string[];
  onToggle: (key: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLocaleLowerCase('tr');
  const matches = q ? options.filter((o) => o.label.toLocaleLowerCase('tr').includes(q)) : options;
  const selectedOptions = options.filter((o) => selected.includes(o.key));
  const shown = q
    ? [...selectedOptions, ...matches.filter((o) => !selected.includes(o.key))]
    : options;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          background: '#0f0f0f',
          border: '1px solid var(--surface-border)',
          borderRadius: 10,
          padding: '10px 14px',
          color: 'var(--text)',
        }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {shown.map((o) => (
          <button
            key={o.key}
            type="button"
            className={selected.includes(o.key) ? 'btn' : 'btn btn-outline'}
            style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => onToggle(o.key)}
          >
            {o.label}
          </button>
        ))}
        {shown.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Eşleşen pazar yok.</div>}
      </div>
    </div>
  );
}
