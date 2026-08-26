import { useState } from 'react';

const MATERIAL_NAMES = {
  mud_brick: 'Mud Brick / Adobe',
  stone_masonry: 'Local Stone Masonry',
  rammed_earth: 'Rammed Earth',
  composite_eps: 'Composite EPS Panel',
  concrete_block: 'Concrete Block',
  timber: 'Timber / Wood',
  double_pane: 'Double Pane Low-E Glass',
  single_pane: 'Single Glazed Glass',
};

const DIR_LABELS = {
  0: 'North (0°)',
  45: 'NE (45°)',
  90: 'East (90°)',
  135: 'SE (135°)',
  180: 'South Direct (180°)',
  225: 'SW (225°)',
  270: 'West (270°)',
  315: 'NW (315°)',
};

const COLUMNS = [
  { key: 'label',            label: 'Design Configuration', align: 'left'  },
  { key: 'avg_inside_temp',  label: 'Avg Temp (°C)',        align: 'right' },
  { key: 'min_temp',         label: 'Min Night (°C)',       align: 'right' },
  { key: 'total_solar_kwh',  label: 'Solar Yield (kWh)',    align: 'right' },
  { key: 'total_heat_loss',  label: 'Heat Loss (kWh)',      align: 'right' },
  { key: 'efficiency_score', label: 'Score / 100',         align: 'right' },
  { key: 'actions',          label: 'Specifications',       align: 'center'},
];

function getValue(row, key) {
  return row[key] ?? row?.summary?.[key] ?? '-';
}

function formatCell(key, val) {
  if (val === null || val === undefined || val === '-') return '—';
  if (['avg_inside_temp', 'min_temp'].includes(key)) return `${Number(val).toFixed(1)}°C`;
  if (['total_solar_kwh', 'total_heat_loss'].includes(key)) return `${Number(val).toFixed(2)} kWh`;
  if (key === 'efficiency_score') return `${Number(val).toFixed(1)}`;
  return String(val);
}

export default function ComparisonTable({
  results = [],
  bestVariantLabel,
  onSelectVariant,
  activeVariantLabel,
}) {
  const [sortKey, setSortKey] = useState('efficiency_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);

  const handleSort = (key) => {
    if (key === 'actions') return;
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sorted = [...results].sort((a, b) => {
    const va = getValue(a, sortKey);
    const vb = getValue(b, sortKey);
    const na = parseFloat(va);
    const nb = parseFloat(vb);
    const cmp = isNaN(na) || isNaN(nb) ? String(va).localeCompare(String(vb)) : na - nb;
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div className="space-y-4">
      {/* Help hint */}
      <div className="flex items-center justify-between text-xs font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
          <span>Click any variant row or <strong>"View Spec"</strong> button to inspect its full input details.</span>
        </div>
        <span className="text-[11px] text-slate-400">Interactive Design Matrix</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
        <table className="min-w-full text-xs font-mono">
          <thead className="bg-slate-900 text-white">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-4 py-3 font-semibold uppercase tracking-wider select-none whitespace-nowrap transition-colors text-${col.align} ${
                    col.key !== 'actions' ? 'cursor-pointer hover:bg-slate-800' : ''
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 text-sky-400">{sortAsc ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const label = row.label || row.variant_label || 'Design';
              const isBest = label === bestVariantLabel;
              const isSelected = selectedVariant && (selectedVariant.label === label || selectedVariant.variant_label === label);
              const isActive3D = activeVariantLabel === label;

              return (
                <tr
                  key={i}
                  onClick={() => setSelectedVariant(row)}
                  className={`border-b border-slate-100 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-sky-100/80 border-sky-300 ring-1 ring-sky-400 font-semibold'
                      : isBest
                      ? 'bg-sky-50/60 font-semibold hover:bg-sky-100/50'
                      : i % 2 === 0
                      ? 'bg-white hover:bg-slate-100/70'
                      : 'bg-slate-50/40 hover:bg-slate-100/70'
                  }`}
                >
                  {/* Label Column */}
                  <td className="px-4 py-3.5 text-left">
                    <div className="flex items-center gap-2">
                      {isBest && (
                        <span className="px-1.5 py-0.5 bg-slate-900 text-sky-400 rounded text-[9px] font-bold tracking-wider">
                          OPTIMAL
                        </span>
                      )}
                      {isActive3D && (
                        <span className="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-bold">
                          3D ACTIVE
                        </span>
                      )}
                      <span className={`font-bold ${isBest ? 'text-sky-950' : 'text-slate-800'}`}>
                        {label}
                      </span>
                    </div>
                  </td>

                  {/* Avg Temp */}
                  <td className="px-4 py-3.5 text-right font-medium text-slate-700">
                    {formatCell('avg_inside_temp', getValue(row, 'avg_inside_temp'))}
                  </td>

                  {/* Min Night Temp */}
                  <td className="px-4 py-3.5 text-right font-bold text-sky-700">
                    {formatCell('min_temp', getValue(row, 'min_temp'))}
                  </td>

                  {/* Solar Yield */}
                  <td className="px-4 py-3.5 text-right font-medium text-orange-600">
                    {formatCell('total_solar_kwh', getValue(row, 'total_solar_kwh'))}
                  </td>

                  {/* Heat Loss */}
                  <td className="px-4 py-3.5 text-right font-medium text-slate-600">
                    {formatCell('total_heat_loss', getValue(row, 'total_heat_loss'))}
                  </td>

                  {/* Score */}
                  <td className="px-4 py-3.5 text-right font-bold text-emerald-700">
                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                      {formatCell('efficiency_score', getValue(row, 'efficiency_score'))}
                    </span>
                  </td>

                  {/* Actions Column */}
                  <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setSelectedVariant(row)}
                      className="px-2.5 py-1 rounded bg-slate-900 hover:bg-sky-700 text-white text-[11px] font-mono transition-colors shadow-sm inline-flex items-center gap-1"
                    >
                      <span>🔍 View Spec</span>
                    </button>
                  </td>
                </tr>
              );
            })}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="text-center py-8 text-slate-400 font-sans">
                  No comparison matrix available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Selected Variant Specification Drawer / Modal */}
      {selectedVariant && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-2xl space-y-5 animate-fadeIn">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-100">
                  Configuration Specs: {selectedVariant.label || selectedVariant.variant_label || 'Design Variant'}
                </h3>
                {(selectedVariant.label === bestVariantLabel || selectedVariant.variant_label === bestVariantLabel) && (
                  <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded text-[10px] font-bold">
                    RECOMMENDED OPTIMAL
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono mt-1">
                Complete architectural inputs and simulated thermal telemetry
              </p>
            </div>

            <div className="flex items-center gap-2">
              {onSelectVariant && (
                <button
                  onClick={() => onSelectVariant(selectedVariant)}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-mono font-bold transition-all shadow-md inline-flex items-center gap-1.5"
                >
                  <span>👁️ Load in 3D CAD Viewer</span>
                </button>
              )}
              <button
                onClick={() => setSelectedVariant(null)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-mono transition-colors"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* 3-Section Grid: Geometry, Materials, Climate & Results */}
          {(() => {
            const inp = selectedVariant.input_config || selectedVariant.input || selectedVariant.geometry || {};
            const wallMatKey = inp.wall_material_id || selectedVariant.wall_material_id || 'mud_brick';
            const roofMatKey = inp.roof_material_id || selectedVariant.roof_material_id || 'mud_brick';
            const floorMatKey = inp.floor_material_id || selectedVariant.floor_material_id || 'rammed_earth';
            const orient = inp.orientation_deg ?? selectedVariant.orientation_deg ?? 180;
            const dirStr = DIR_LABELS[orient] || `${orient}°`;

            const length = inp.length_m || selectedVariant.length_m || 6.0;
            const width = inp.width_m || selectedVariant.width_m || 4.0;
            const height = inp.height_m || selectedVariant.height_m || 3.0;
            const wallThk = inp.wall_thickness_m || selectedVariant.wall_thickness_m || 0.35;
            const shape = inp.shape || selectedVariant.shape || 'rectangular';
            const winCount = inp.num_windows ?? (inp.openings ? inp.openings.filter(o => o.type === 'window').length : 3);
            const doorCount = inp.num_doors ?? (inp.openings ? inp.openings.filter(o => o.type === 'door').length : 1);

            return (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
                {/* Column 1: Geometry & Envelope */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                  <span className="text-[10px] text-sky-400 uppercase tracking-wider font-bold block border-b border-slate-800 pb-1">
                    📐 1. Architectural Geometry
                  </span>
                  <div className="space-y-1.5 text-slate-300">
                    <div className="flex justify-between"><span className="text-slate-400">Dimensions:</span> <strong className="text-white">{length}m × {width}m × {height}m</strong></div>
                    <div className="flex justify-between"><span className="text-slate-400">Floor Footprint:</span> <span className="text-slate-200">{(length * width).toFixed(1)} m²</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Interior Volume:</span> <span className="text-slate-200">{(length * width * height).toFixed(1)} m³</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Building Form:</span> <span className="text-slate-200 capitalize">{shape === 'dome' ? 'Igloo / Dome' : 'Alpine Gable House'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Fenestration:</span> <span className="text-slate-200">{winCount} Windows, {doorCount} Door</span></div>
                  </div>
                </div>

                {/* Column 2: Material Assemblies */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                  <span className="text-[10px] text-amber-400 uppercase tracking-wider font-bold block border-b border-slate-800 pb-1">
                    🧱 2. Material Layering & Orientation
                  </span>
                  <div className="space-y-1.5 text-slate-300">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Wall Assembly:</span>
                      <strong className="text-amber-300">{MATERIAL_NAMES[wallMatKey] || wallMatKey} ({(wallThk * 100).toFixed(0)}cm)</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Roof Assembly:</span>
                      <span className="text-slate-200">{MATERIAL_NAMES[roofMatKey] || roofMatKey} (Gable Slope)</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Floor Plinth:</span>
                      <span className="text-slate-200">{MATERIAL_NAMES[floorMatKey] || floorMatKey}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-800/60">
                      <span className="text-slate-400">Solar Azimuth:</span>
                      <strong className="text-orange-400">{dirStr}</strong>
                    </div>
                  </div>
                </div>

                {/* Column 3: Thermal Performance */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                  <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold block border-b border-slate-800 pb-1">
                    🌡️ 3. Simulated Physics Yield
                  </span>
                  <div className="space-y-1.5 text-slate-300">
                    <div className="flex justify-between"><span className="text-slate-400">Overnight Min Temp:</span> <strong className="text-sky-300">{Number(getValue(selectedVariant, 'min_temp')).toFixed(1)}°C</strong></div>
                    <div className="flex justify-between"><span className="text-slate-400">Daytime Peak Temp:</span> <strong className="text-amber-300">{Number(getValue(selectedVariant, 'avg_inside_temp')).toFixed(1)}°C</strong></div>
                    <div className="flex justify-between"><span className="text-slate-400">Daily Solar Gain:</span> <strong className="text-orange-300">{Number(getValue(selectedVariant, 'total_solar_kwh')).toFixed(2)} kWh</strong></div>
                    <div className="flex justify-between"><span className="text-slate-400">Envelope Heat Loss:</span> <span className="text-slate-200">{Number(getValue(selectedVariant, 'total_heat_loss')).toFixed(2)} kWh</span></div>
                    <div className="flex justify-between pt-1 border-t border-slate-800/60">
                      <span className="text-slate-400">Efficiency Score:</span>
                      <strong className="text-emerald-400 text-sm">{Number(getValue(selectedVariant, 'efficiency_score')).toFixed(1)} / 100</strong>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
