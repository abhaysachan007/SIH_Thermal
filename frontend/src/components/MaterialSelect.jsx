import { useState } from 'react';

const CATEGORIES = ['earthen', 'masonry', 'insulation', 'composite', 'glazing', 'concrete'];

const CATEGORY_NAMES = {
  earthen: 'Earthen / Vernacular',
  masonry: 'Stone / Masonry',
  insulation: 'Thermal Insulation',
  composite: 'Engineered Composites',
  glazing: 'Window Glazing',
  concrete: 'Structural Concrete',
};

export default function MaterialSelect({
  label,
  materials = [],
  value,
  onChange,
  thickness,
  onThicknessChange,
  category,
}) {
  const filtered = category === 'no_glazing'
    ? materials.filter((m) => m.category !== 'glazing')
    : materials;

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter((m) => m.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  const selectedMat = materials.find((m) => (m.id || m.material_id) === value);

  return (
    <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-slate-50/70 border border-slate-200">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
          {label}
        </label>
        {selectedMat?.category && (
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 font-semibold">
            {CATEGORY_NAMES[selectedMat.category] || selectedMat.category}
          </span>
        )}
      </div>

      <div className="relative">
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 cursor-pointer shadow-sm transition-all"
        >
          <option value="">-- Select Envelope Material --</option>
          {Object.entries(grouped).map(([cat, items]) => (
            <optgroup key={cat} label={CATEGORY_NAMES[cat] || cat}>
              {items.map((m) => {
                const matId = m.id || m.material_id;
                const kVal = m.conductivity != null ? ` (k = ${m.conductivity} W/m·K)` : '';
                return (
                  <option key={matId} value={matId}>
                    {m.name}{kVal}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </div>

      {selectedMat && (
        <div className="text-xs bg-white rounded-lg p-2.5 border border-slate-200/80 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>Conductivity: <strong className="text-slate-800">{selectedMat.conductivity ?? '—'} W/m·K</strong></span>
            <span>Density: <strong className="text-slate-800">{selectedMat.density ?? '—'} kg/m³</strong></span>
          </div>
          {selectedMat.description && (
            <p className="text-[11px] text-slate-600 leading-relaxed pt-0.5 border-t border-slate-100">
              {selectedMat.description}
            </p>
          )}
        </div>
      )}

      {onThicknessChange && (
        <div className="flex items-center gap-3 pt-1">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Thickness:
          </label>
          <input
            type="range"
            min={0.05}
            max={0.80}
            step={0.05}
            value={thickness || 0.30}
            onChange={(e) => onThicknessChange(parseFloat(e.target.value))}
            className="flex-1 accent-sky-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
          />
          <div className="px-2 py-0.5 rounded bg-slate-200/70 border border-slate-300 font-mono text-xs text-slate-800 font-bold min-w-[60px] text-center">
            {((thickness || 0.30) * 100).toFixed(0)} cm
          </div>
        </div>
      )}
    </div>
  );
}
