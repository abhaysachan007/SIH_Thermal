import { useState } from 'react';

const CATEGORIES = ['earthen', 'masonry', 'insulation', 'composite', 'glazing', 'concrete'];

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
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-primary">{label}</label>

      <div className="relative">
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer"
        >
          <option value="">-- Select material --</option>
          {Object.entries(grouped).map(([cat, items]) => (
            <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
              {items.map((m) => {
                const matId = m.id || m.material_id;
                return (
                  <option key={matId} value={matId}>
                    {m.name}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </div>

      {selectedMat?.description && (
        <div className="text-xs text-gray-600 bg-gray-50 rounded px-3 py-2 border border-gray-200">
          <span className="font-semibold text-primary">Info: </span>
          {selectedMat.description}
        </div>
      )}

      <div className="flex items-center gap-3 mt-1">
        <label className="text-xs text-gray-600 whitespace-nowrap">Thickness (m):</label>
        <input
          type="range"
          min={0.05}
          max={0.60}
          step={0.05}
          value={thickness || 0.20}
          onChange={(e) => onThicknessChange(parseFloat(e.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="text-xs font-mono text-primary w-14 text-right">
          {(thickness || 0.20).toFixed(2)} m
        </span>
      </div>
    </div>
  );
}
