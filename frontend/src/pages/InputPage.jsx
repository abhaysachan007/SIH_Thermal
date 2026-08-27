import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import StepIndicator from '../components/StepIndicator';
import CompassSelector from '../components/CompassSelector';
import MaterialSelect from '../components/MaterialSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  getMaterials,
  getClimateProfiles,
  submitSimulation,
  submitCompare,
  pollUntilDone,
  pollTimeoutMsFor,
  fetchLiveClimate,
} from '../api/simulationApi';

const STEPS = ['Geometry', 'Materials', 'Orientation', 'Submit'];


const PRESETS = [
  {
    id: 'mud_brick_standard',
    name: 'Traditional Mud-Brick Shelter',
    badge: 'RECOMMENDED · LEH REGION',
    desc: 'High thermal inertia mud-brick envelope with dual south-facing glazing for maximum solar storage in high-altitude valley terrains.',
    dimensions: '6.0m × 4.0m × 3.0m',
    envelope: '30cm Mud Brick · South 180° Direct',
    config: {
      shape: 'rectangular',
      length_m: 6.0,
      width_m: 4.0,
      height_m: 3.0,
      wall_material_id: 'mud_brick',
      wall_thickness_m: 0.30,
      roof_material_id: 'mud_brick',
      roof_thickness_m: 0.20,
      floor_material_id: 'rammed_earth',
      floor_thickness_m: 0.15,
      openings: [{ type: 'window', width_m: 1.2, height_m: 1.2, count: 2, glazing_material_id: 'double_glazing' }],
      orientation_deg: 180,
      climate_profile_id: 'ladakh_winter',
      min_ambient_temp_C: -19.2,
      max_ambient_temp_C: 3.5,
      peak_solar_radiation_W_m2: 940.0,
      duration_hours: 24,
      variant_label: 'Mud-Brick Passive Shelter',
    },
  },
  {
    id: 'insulated_stone',
    name: 'Insulated Stone Alpine Unit',
    badge: 'EXTREME SUB-ZERO (-30°C)',
    desc: 'Heavy local stone masonry thermal mass reinforced with exterior insulation to endure extreme sub-zero wind chills.',
    dimensions: '8.0m × 5.0m × 3.0m',
    envelope: '35cm Stone Masonry + EPS · Triple Glazing',
    config: {
      shape: 'rectangular',
      length_m: 8.0,
      width_m: 5.0,
      height_m: 3.0,
      wall_material_id: 'stone_masonry',
      wall_thickness_m: 0.35,
      roof_material_id: 'insulation_eps',
      roof_thickness_m: 0.25,
      floor_material_id: 'concrete',
      floor_thickness_m: 0.20,
      openings: [{ type: 'window', width_m: 1.5, height_m: 1.2, count: 3, glazing_material_id: 'triple_glazing' }],
      orientation_deg: 180,
      climate_profile_id: 'ladakh_winter',
      min_ambient_temp_C: -25.0,
      max_ambient_temp_C: -2.0,
      peak_solar_radiation_W_m2: 980.0,
      duration_hours: 24,
      variant_label: 'Insulated Stone Unit',
    },
  },
  {
    id: 'igloo_dome',
    name: 'Aerodynamic Igloo Dome',
    badge: 'HIGH-WIND SNOW RIDGE',
    desc: 'Hemispherical aerodynamic structure minimizing external perimeter surface area and high-velocity wind convective dissipation.',
    dimensions: '5.0m × 5.0m × 2.8m',
    envelope: 'Igloo Hemisphere · Rammed Earth Envelope',
    config: {
      shape: 'dome',
      length_m: 5.0,
      width_m: 5.0,
      height_m: 2.8,
      wall_material_id: 'rammed_earth',
      wall_thickness_m: 0.30,
      roof_material_id: 'rammed_earth',
      roof_thickness_m: 0.20,
      floor_material_id: 'rammed_earth',
      floor_thickness_m: 0.15,
      openings: [{ type: 'window', width_m: 1.0, height_m: 1.0, count: 1, glazing_material_id: 'double_glazing' }],
      orientation_deg: 180,
      climate_profile_id: 'ladakh_winter',
      min_ambient_temp_C: -22.0,
      max_ambient_temp_C: 0.0,
      peak_solar_radiation_W_m2: 900.0,
      duration_hours: 24,
      variant_label: 'Aerodynamic Igloo Dome',
    },
  },
];

const DEFAULT_FORM = {
  shape: 'rectangular',
  length_m: 6.0,
  width_m: 4.0,
  height_m: 3.0,
  wall_material_id: 'mud_brick',
  wall_thickness_m: 0.30,
  roof_material_id: 'mud_brick',
  roof_thickness_m: 0.20,
  floor_material_id: 'rammed_earth',
  floor_thickness_m: 0.15,
  openings: [
    { type: 'window', width_m: 1.2, height_m: 1.2, count: 2, glazing_material_id: 'double_glazing' }
  ],
  orientation_deg: 180,
  climate_profile_id: 'ladakh_winter',
  duration_hours: 24,
  variant_label: 'Base Design',
};

// --- Step 1: Shelter Geometry ---
function GeometryStep({ data, onChange, errors }) {
  const svgW = 240;
  const svgH = 150;
  const scale = Math.min((svgW - 50) / data.length_m, (svgH - 50) / data.width_m);
  const rectW = data.length_m * scale;
  const rectH = data.width_m * scale;
  const rx = (svgW - rectW) / 2;
  const ry = (svgH - rectH) / 2;
  const floorArea = (data.length_m * data.width_m).toFixed(1);
  const envelopeVol = (data.length_m * data.width_m * data.height_m).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Environmental Baseline Bar in Step 1 */}
      <div className="p-4 rounded-xl bg-slate-900 text-white border border-slate-800 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-sky-400">
              Site Meteorological Boundary Conditions
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">Leh 34.15°N · 3500m</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Min Temp */}
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Min Night Temp</span>
              <span className="text-xs font-mono font-bold text-sky-400">{data.min_ambient_temp_C ?? -19.2}°C</span>
            </div>
            <input
              type="range" min="-40" max="20" step="0.5"
              value={data.min_ambient_temp_C ?? -19.2}
              onChange={(e) => onChange('min_ambient_temp_C', parseFloat(e.target.value))}
              className="w-full accent-sky-500 h-1 bg-slate-800 rounded cursor-pointer"
            />
          </div>

          {/* Max Temp */}
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Max Day Temp</span>
              <span className="text-xs font-mono font-bold text-amber-400">{data.max_ambient_temp_C ?? 3.5}°C</span>
            </div>
            <input
              type="range" min="-25" max="45" step="0.5"
              value={data.max_ambient_temp_C ?? 3.5}
              onChange={(e) => onChange('max_ambient_temp_C', parseFloat(e.target.value))}
              className="w-full accent-amber-500 h-1 bg-slate-800 rounded cursor-pointer"
            />
          </div>

          {/* Solar Radiation */}
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Peak Solar</span>
              <span className="text-xs font-mono font-bold text-orange-400">{(data.peak_solar_radiation_W_m2 ?? 940).toFixed(0)} W/m²</span>
            </div>
            <input
              type="range" min="100" max="1300" step="10"
              value={data.peak_solar_radiation_W_m2 ?? 940.0}
              onChange={(e) => onChange('peak_solar_radiation_W_m2', parseFloat(e.target.value))}
              className="w-full accent-orange-500 h-1 bg-slate-800 rounded cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Shelter Structural Geometry</h2>
        <p className="text-xs text-slate-500 mt-0.5">Define envelope dimensions, structural form factor, and spatial proportions</p>
      </div>

      {/* Shape Form Selector */}
      <div className="space-y-2">
        <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700">Envelope Architecture</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { value: 'rectangular', label: 'Alpine Rectangular', sub: 'Pitched Gable / Flat Overhang' },
            { value: 'aframe', label: 'A-Frame Cabin', sub: 'Steep Snow-Shedding Alpine' },
            { value: 'dome', label: 'Igloo Hemisphere', sub: 'Aerodynamic Snow Arch Form' },
          ].map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange('shape', s.value)}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                data.shape === s.value
                  ? 'border-sky-600 bg-sky-50/70 text-sky-950 ring-2 ring-sky-500/20 shadow-sm font-semibold'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold">{s.label}</span>
                <span className={`w-2 h-2 rounded-full ${data.shape === s.value ? 'bg-sky-600' : 'bg-slate-300'}`} />
              </div>
              <p className="text-[11px] text-slate-500 font-normal">{s.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Dimension Parameter Inputs */}
      <div className="space-y-4 pt-1">
        {[
          { key: 'length_m', label: 'Length (L)', sliderMin: 3, sliderMax: 50, unit: 'm', step: 0.5, desc: 'Primary south/north span' },
          { key: 'width_m',  label: 'Width (W)',  sliderMin: 3, sliderMax: 50, unit: 'm', step: 0.5, desc: 'East/west cross section' },
          { key: 'height_m', label: 'Ceiling Height (H)', sliderMin: 2, sliderMax: 20,  unit: 'm', step: 0.1, desc: 'Interior thermal clearance' },
        ].map(({ key, label, sliderMin, sliderMax, unit, step, desc }) => (
          <div key={key} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-xs font-mono font-bold text-slate-800">{label}</span>
                <span className="text-[11px] text-slate-400 block -mt-0.5">{desc}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1 shadow-inner">
                <input
                  type="number"
                  min={0.1}
                  step={step}
                  value={data[key]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) onChange(key, v);
                  }}
                  className="w-16 font-mono font-bold text-sm text-right text-slate-900 focus:outline-none"
                />
                <span className="text-xs font-mono font-medium text-slate-500">{unit}</span>
              </div>
            </div>
            <input
              type="range" min={sliderMin} max={sliderMax} step={step}
              value={Math.min(data[key], sliderMax)}
              onChange={(e) => onChange(key, parseFloat(e.target.value))}
              className="w-full accent-sky-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
            />
            {errors[key] && <p className="text-rose-500 text-xs">{errors[key]}</p>}
          </div>
        ))}
      </div>

      {/* CAD Blueprint Floor Plan Preview */}
      <div className="bg-slate-950 text-slate-200 rounded-xl p-4 border border-slate-800 cad-grid-dark relative">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2 border-b border-slate-800 pb-1.5">
          <span>FLOORPLAN CAD SCHEMATIC</span>
          <span>AREA: <strong className="text-sky-400">{floorArea} m²</strong> · VOL: <strong className="text-slate-200">{envelopeVol} m³</strong></span>
        </div>

        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-xs mx-auto block">
          {/* North compass indicator in corner */}
          <g transform="translate(18, 20)">
            <circle cx="0" cy="0" r="10" fill="#1e293b" stroke="#475569" strokeWidth="0.8" />
            <line x1="0" y1="8" x2="0" y2="-8" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" />
            <polygon points="0,-8 -3,-3 3,-3" fill="#f43f5e" />
            <text x="0" y="4" textAnchor="middle" fontSize="6" fill="#94a3b8" fontFamily="monospace">N</text>
          </g>

          {data.shape === 'dome' ? (
            <ellipse
              cx={svgW / 2} cy={svgH / 2}
              rx={rectW / 2} ry={rectH / 2}
              fill="rgba(2, 132, 199, 0.15)" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 2"
            />
          ) : (
            <rect
              x={rx} y={ry} width={rectW} height={rectH}
              fill="rgba(2, 132, 199, 0.15)" stroke="#38bdf8" strokeWidth="1.5" rx="2"
            />
          )}

          {/* Dimension Text */}
          <text x={svgW / 2} y={ry + rectH / 2 + 4} textAnchor="middle" fontSize="11" fill="#f8fafc" fontFamily="monospace" fontWeight="bold">
            {data.length_m}m × {data.width_m}m
          </text>
          
          <text x={svgW / 2} y={ry + rectH + 14} textAnchor="middle" fontSize="8" fill="#f97316" fontFamily="monospace">
            ▲ SOUTH SOLAR FACADE (180°)
          </text>
        </svg>
      </div>
    </div>
  );
}

// --- Step 2: Materials & Openings ---
function MaterialsStep({ data, onChange, materials, errors }) {
  const glazingMaterials = materials.filter((m) => m.category === 'glazing');

  const addOpening = (type) => {
    const defaultGlazing = glazingMaterials[0]?.id || glazingMaterials[0]?.material_id || 'double_glazing';
    const newOpening =
      type === 'window'
        ? { type: 'window', width_m: 1.2, height_m: 1.2, count: 1, glazing_material_id: defaultGlazing }
        : { type: 'door', width_m: 0.9, height_m: 2.1, count: 1, glazing_material_id: 'single_glazing' };
    onChange('openings', [...data.openings, newOpening]);
  };

  const updateOpening = (i, field, val) => {
    const updated = data.openings.map((o, idx) => (idx === i ? { ...o, [field]: val } : o));
    onChange('openings', updated);
  };

  const removeOpening = (i) => {
    onChange('openings', data.openings.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Thermal Envelope & Materials</h2>
        <p className="text-xs text-slate-500 mt-0.5">Select high-thermal-mass building assemblies and opening fenestrations</p>
      </div>

      <div className="space-y-3.5">
        <MaterialSelect
          label="Wall Assembly Material"
          materials={materials}
          value={data.wall_material_id}
          onChange={(v) => onChange('wall_material_id', v)}
          thickness={data.wall_thickness_m}
          onThicknessChange={(v) => onChange('wall_thickness_m', v)}
          category="no_glazing"
        />
        {errors.wall_material_id && <p className="text-rose-500 text-xs">{errors.wall_material_id}</p>}

        <MaterialSelect
          label="Roof Assembly Material"
          materials={materials}
          value={data.roof_material_id}
          onChange={(v) => onChange('roof_material_id', v)}
          thickness={data.roof_thickness_m}
          onThicknessChange={(v) => onChange('roof_thickness_m', v)}
          category="no_glazing"
        />
        {errors.roof_material_id && <p className="text-rose-500 text-xs">{errors.roof_material_id}</p>}

        <MaterialSelect
          label="Foundation / Floor Slab Material"
          materials={materials}
          value={data.floor_material_id}
          onChange={(v) => onChange('floor_material_id', v)}
          thickness={data.floor_thickness_m}
          onThicknessChange={(v) => onChange('floor_thickness_m', v)}
          category="no_glazing"
        />
        {errors.floor_material_id && <p className="text-rose-500 text-xs">{errors.floor_material_id}</p>}
      </div>

      {/* Openings Section */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-800">Glazing & Doors (South Facade)</h3>
            <span className="text-[11px] text-slate-500">Direct solar radiation capture elements</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addOpening('window')}
              className="px-2.5 py-1 text-xs font-mono font-medium bg-slate-900 hover:bg-slate-800 text-sky-400 rounded-lg transition-colors border border-slate-700"
            >
              + Window
            </button>
            <button
              type="button"
              onClick={() => addOpening('door')}
              className="px-2.5 py-1 text-xs font-mono font-medium bg-white hover:bg-slate-100 text-slate-700 rounded-lg transition-colors border border-slate-300"
            >
              + Door
            </button>
          </div>
        </div>

        {data.openings.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4 border border-dashed border-slate-300 rounded-lg">
            No openings added. Windows on south facade are recommended for passive solar heating.
          </p>
        )}

        <div className="space-y-2.5">
          {data.openings.map((op, i) => (
            <div key={i} className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-slate-800">
                  {op.type === 'window' ? '🪟 Window Element' : '🚪 Entry Door'} #{i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeOpening(i)}
                  className="text-rose-600 hover:text-rose-800 text-[11px] font-mono"
                >
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase">Width (m)</span>
                  <input
                    type="number" min={0.3} max={3} step={0.1}
                    value={op.width_m}
                    onChange={(e) => updateOpening(i, 'width_m', parseFloat(e.target.value) || 0.5)}
                    className="border border-slate-300 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-sky-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase">Height (m)</span>
                  <input
                    type="number" min={0.3} max={3} step={0.1}
                    value={op.height_m}
                    onChange={(e) => updateOpening(i, 'height_m', parseFloat(e.target.value) || 0.5)}
                    className="border border-slate-300 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-sky-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase">Count</span>
                  <input
                    type="number" min={1} max={10} step={1}
                    value={op.count}
                    onChange={(e) => updateOpening(i, 'count', parseInt(e.target.value) || 1)}
                    className="border border-slate-300 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-sky-500 font-bold text-sky-700"
                  />
                </label>
              </div>

              {op.type === 'window' && (
                <div className="pt-1">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-[10px] font-mono text-slate-500 uppercase">Glazing Specification</span>
                    <select
                      value={op.glazing_material_id || 'double_glazing'}
                      onChange={(e) => updateOpening(i, 'glazing_material_id', e.target.value)}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white text-slate-800 focus:ring-1 focus:ring-sky-500"
                    >
                      {glazingMaterials.map((m) => {
                        const matId = m.id || m.material_id;
                        return (
                          <option key={matId} value={matId}>{m.name} (SHGC ~{m.shgc ?? '0.65'})</option>
                        );
                      })}
                    </select>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Step 3: Orientation & Climate ---
function OrientationStep({ data, onChange, climateProfiles, errors, compareMode, onCompareModeChange }) {
  const [liveStatus, setLiveStatus] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [liveNote, setLiveNote] = useState('');

  const handleFetchLive = async () => {
    setLiveStatus('loading');
    setLiveNote('');
    try {
      const res = await fetchLiveClimate(34.15, 77.57);
      if (!res?.ok) {
        setLiveStatus('error');
        setLiveNote(res?.detail || 'Live fetch failed');
        return;
      }
      onChange('climate_profile_id', res.climate_profile_id);
      if (res.min_temp_C != null) onChange('min_ambient_temp_C', res.min_temp_C);
      if (res.max_temp_C != null) onChange('max_ambient_temp_C', res.max_temp_C);
      if (res.peak_solar_W_m2 != null) onChange('peak_solar_radiation_W_m2', res.peak_solar_W_m2);
      setLiveStatus('ok');
      setLiveNote(`${res.name} · ${res.min_temp_C}°C to ${res.max_temp_C}°C · peak ${res.peak_solar_W_m2} W/m²`);
    } catch (e) {
      setLiveStatus('error');
      setLiveNote(e?.message || 'Network error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Solar Orientation & High-Altitude Climate</h2>
        <p className="text-xs text-slate-500 mt-0.5">Calibrate meteorological diurnal cycles, solar azimuth, and test horizon</p>
      </div>

      {/* Facade Orientation Compass */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
        <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 block mb-2 text-center">
          Solar Orientation & Facade Azimuth
        </label>
        <CompassSelector
          value={data.orientation_deg}
          onChange={(deg) => onChange('orientation_deg', deg)}
        />
      </div>

      {/* Climate Profile Selector */}
      <div className="space-y-2">
        <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 block">
          Meteorological Climate Dataset
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {climateProfiles.map((cp) => {
            const cId = cp.id || cp.profile_id;
            const isSelected = data.climate_profile_id === cId;
            return (
              <button
                key={cId}
                type="button"
                onClick={() => onChange('climate_profile_id', cId)}
                className={`p-3.5 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-sky-600 bg-sky-50/70 text-sky-950 ring-2 ring-sky-500/20 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-sm font-sans">{cp.name || cId}</p>
                  <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-sky-600' : 'bg-slate-300'}`} />
                </div>
                {cp.description && (
                  <p className="text-[11px] text-slate-500 leading-relaxed font-normal">{cp.description}</p>
                )}
              </button>
            );
          })}
        </div>
        {errors.climate_profile_id && (
          <p className="text-rose-500 text-xs mt-1">{errors.climate_profile_id}</p>
        )}

        {/* Live NASA POWER climate fetch */}
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={handleFetchLive}
            disabled={liveStatus === 'loading'}
            className="self-start inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-sky-300 border border-slate-800 text-xs font-mono font-bold transition-all"
          >
            <span className={`w-2 h-2 rounded-full ${liveStatus === 'loading' ? 'bg-amber-400 animate-pulse' : 'bg-sky-400'}`} />
            {liveStatus === 'loading' ? 'Fetching NASA POWER…' : '🛰️ Fetch Live Leh Climate (NASA POWER)'}
          </button>
          {liveStatus === 'ok' && (
            <p className="text-[11px] font-mono text-emerald-600">✓ {liveNote}</p>
          )}
          {liveStatus === 'error' && (
            <p className="text-[11px] font-mono text-amber-600">Live fetch unavailable ({liveNote}). Using bundled climate dataset.</p>
          )}
        </div>
      </div>

      {/* Duration Selector */}
      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
        <span className="text-xs font-mono font-bold text-slate-700 uppercase">Simulation Horizon</span>
        <div className="flex gap-2">
          {[24, 48, 72].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChange('duration_hours', h)}
              className={`px-3 py-1 rounded-md text-xs font-mono font-bold transition-all border ${
                data.duration_hours === h
                  ? 'bg-slate-900 text-sky-400 border-slate-800 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {h}h Cycle
            </button>
          ))}
        </div>
      </div>

      {/* Comparison Toggle */}
      <div className="flex items-center gap-3 bg-slate-100/80 border border-slate-300 rounded-xl px-4 py-3">
        <input
          type="checkbox"
          id="compare-mode"
          checked={compareMode}
          onChange={(e) => onCompareModeChange(e.target.checked)}
          className="w-4 h-4 accent-sky-600 rounded"
        />
        <label htmlFor="compare-mode" className="text-xs font-semibold text-slate-800 cursor-pointer">
          Enable Comparative Multi-Design Matrix (evaluate multiple material variants in parallel)
        </label>
      </div>
    </div>
  );
}

// --- Step 4: Review & Submit ---
function ReviewStep({ data, materials, climateProfiles, compareMode, variants, onAddVariant, onRemoveVariant, onVariantChange }) {
  const mat = (id) => materials.find((m) => (m.id || m.material_id) === id)?.name || id || '-';
  const cp = (id) => climateProfiles.find((c) => (c.id || c.profile_id) === id)?.name || id || '-';
  const degLabel = (d) => `${d}° (${d === 180 ? 'South Direct' : 'Azimuth'})`;

  const rows = [
    ['Structural Form', data.shape === 'dome' ? 'Igloo Dome Hemisphere' : data.shape === 'aframe' ? 'A-Frame Alpine Cabin' : 'Alpine Rectangular Envelope'],
    ['Dimensions (L×W×H)', `${data.length_m}m × ${data.width_m}m × ${data.height_m}m`],
    ['Wall Assembly', `${mat(data.wall_material_id)} (${(data.wall_thickness_m * 100).toFixed(0)} cm)`],
    ['Roof Assembly', `${mat(data.roof_material_id)} (${(data.roof_thickness_m * 100).toFixed(0)} cm)`],
    ['Floor Assembly', `${mat(data.floor_material_id)} (${(data.floor_thickness_m * 100).toFixed(0)} cm)`],
    ['Fenestrations', `${data.openings.reduce((sum, o) => sum + (o.count || 1), 0)} openings total`],
    ['Solar Orientation', degLabel(data.orientation_deg)],
    ['Climate Profile', cp(data.climate_profile_id)],
    ['Transient Horizon', `${data.duration_hours} Hours`],
  ];

  const nonGlazingMaterials = materials.filter((m) => m.category !== 'glazing');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">
          {compareMode ? 'Multi-Variant Design Matrix' : 'Design Specification Summary'}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Verify parameters before running numerical transient computation</p>
      </div>

      {/* Specification Table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm bg-white">
        <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-mono font-bold tracking-wider uppercase text-slate-200">
            Primary Configuration: {data.variant_label || 'Base Design'}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-600 text-white font-bold">READY</span>
        </div>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([k, v], idx) => (
              <tr key={k} className={`border-b border-slate-100 last:border-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                <td className="px-4 py-2 font-mono text-slate-500 font-medium w-48">{k}</td>
                <td className="px-4 py-2 font-mono text-slate-900 font-semibold">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compare Variants Setup */}
      {compareMode && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700">Comparative Design Variants ({variants.length + 1} Total)</span>
            {variants.length < 4 && (
              <button
                type="button"
                onClick={onAddVariant}
                className="px-3 py-1 bg-slate-900 text-sky-400 border border-slate-700 rounded-lg text-xs font-mono font-medium hover:bg-slate-800"
              >
                + Add Variant
              </button>
            )}
          </div>

          {variants.map((v, i) => (
            <div key={i} className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-sky-500" />
                  <span className="text-xs font-mono font-bold text-slate-900">Variant #{i + 2} Configuration</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveVariant(i)}
                  className="text-rose-600 hover:text-rose-800 text-xs font-mono font-semibold px-2 py-0.5 rounded hover:bg-rose-50 transition-colors"
                >
                  ✕ Remove
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* 1. Wall Assembly */}
                <div>
                  <label className="text-[10px] text-slate-600 font-mono uppercase font-bold block mb-1 flex items-center gap-1">
                    <span>🧱 Wall Assembly</span>
                  </label>
                  <select
                    value={v.wall_material_id || data.wall_material_id}
                    onChange={(e) => onVariantChange(i, 'wall_material_id', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-xs font-mono text-slate-800 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 shadow-sm"
                  >
                    {nonGlazingMaterials.map((m) => (
                      <option key={m.id || m.material_id} value={m.id || m.material_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Roof Assembly */}
                <div>
                  <label className="text-[10px] text-slate-600 font-mono uppercase font-bold block mb-1 flex items-center gap-1">
                    <span>🏠 Roof Assembly</span>
                  </label>
                  <select
                    value={v.roof_material_id || data.roof_material_id}
                    onChange={(e) => onVariantChange(i, 'roof_material_id', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-xs font-mono text-slate-800 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 shadow-sm"
                  >
                    {nonGlazingMaterials.map((m) => (
                      <option key={m.id || m.material_id} value={m.id || m.material_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Floor Plinth */}
                <div>
                  <label className="text-[10px] text-slate-600 font-mono uppercase font-bold block mb-1 flex items-center gap-1">
                    <span>🟫 Floor Plinth</span>
                  </label>
                  <select
                    value={v.floor_material_id || data.floor_material_id}
                    onChange={(e) => onVariantChange(i, 'floor_material_id', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-xs font-mono text-slate-800 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 shadow-sm"
                  >
                    {nonGlazingMaterials.map((m) => (
                      <option key={m.id || m.material_id} value={m.id || m.material_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 4. Solar Azimuth / Orientation */}
                <div>
                  <label className="text-[10px] text-slate-600 font-mono uppercase font-bold block mb-1 flex items-center gap-1">
                    <span>☀️ Solar Azimuth</span>
                  </label>
                  <select
                    value={v.orientation_deg ?? data.orientation_deg}
                    onChange={(e) => onVariantChange(i, 'orientation_deg', parseInt(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-xs font-mono text-slate-800 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 shadow-sm"
                  >
                    {[
                      { deg: 180, label: '180° (South Direct - Max Solar)' },
                      { deg: 135, label: '135° (South-East - Morning Sun)' },
                      { deg: 225, label: '225° (South-West - Afternoon Sun)' },
                      { deg: 90,  label: '90° (East Direct)' },
                      { deg: 270, label: '270° (West Direct)' },
                      { deg: 0,   label: '0° (North Direct - Min Solar)' },
                      { deg: 45,  label: '45° (North-East)' },
                      { deg: 315, label: '315° (North-West)' },
                    ].map((d) => (
                      <option key={d.deg} value={d.deg}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main InputPage ---
export default function InputPage() {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [compareMode, setCompareMode] = useState(false);
  const [variants, setVariants] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [climateProfiles, setClimateProfiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Running thermal simulation...');
  const [cancelled, setCancelled] = useState(false);
  const [engine, setEngine] = useState('fdm'); 

  useEffect(() => {
    getMaterials().catch(() => {}).then((data) => {
      if (data && Array.isArray(data)) {
        setMaterials(data);
      }
    });
    getClimateProfiles().catch(() => {}).then((data) => {
      if (data && Array.isArray(data)) {
        setClimateProfiles(data);
      }
    });
  }, []);

  const onChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  
  const handleStart = (preset = null, targetStep = 0) => {
    if (preset) {
      setFormData((prev) => ({
        ...prev,
        ...preset.config,
      }));
    }
    setStep(targetStep);
    setIsStarted(true);
  };

  const validateStep = () => {
    const e = {};
    if (step === 0) {
      if (formData.length_m < 0.5) e.length_m = 'Length must be > 0.5m';
      if (formData.width_m < 0.5) e.width_m = 'Width must be > 0.5m';
      if (formData.height_m < 0.5) e.height_m = 'Height must be > 0.5m';
    }
    if (step === 1) {
      if (!formData.wall_material_id) e.wall_material_id = 'Please select a wall material';
      if (!formData.roof_material_id) e.roof_material_id = 'Please select a roof material';
      if (!formData.floor_material_id) e.floor_material_id = 'Please select a floor material';
    }
    if (step === 2) {
      if (!formData.climate_profile_id) e.climate_profile_id = 'Please select a climate profile';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validateStep()) setStep((s) => Math.min(s + 1, 3)); };
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const addVariant = () => {
    const nextNum = variants.length + 2;
    setVariants((v) => [
      ...v,
      {
        variant_label: `Variant ${nextNum}`,
        wall_material_id: formData.wall_material_id || 'mud_brick',
        roof_material_id: formData.roof_material_id || 'mud_brick',
        floor_material_id: formData.floor_material_id || 'rammed_earth',
        orientation_deg: formData.orientation_deg ?? 180,
      },
    ]);
  };

  const removeVariant = (i) => setVariants((v) => v.filter((_, idx) => idx !== i));
  const updateVariant = (i, field, val) =>
    setVariants((v) => v.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)));

  const buildPayload = (overrides = {}) => ({
    length_m: parseFloat(formData.length_m),
    width_m: parseFloat(formData.width_m),
    height_m: parseFloat(formData.height_m),
    shape: formData.shape,
    wall_material_id: overrides.wall_material_id || formData.wall_material_id || 'mud_brick',
    wall_thickness_m: parseFloat(formData.wall_thickness_m),
    roof_material_id: overrides.roof_material_id || formData.roof_material_id || 'mud_brick',
    roof_thickness_m: parseFloat(formData.roof_thickness_m),
    floor_material_id: overrides.floor_material_id || formData.floor_material_id || 'rammed_earth',
    floor_thickness_m: parseFloat(formData.floor_thickness_m),
    openings: formData.openings.map((op) => ({
      type: op.type,
      width_m: parseFloat(op.width_m || 1.0),
      height_m: parseFloat(op.height_m || 1.2),
      count: parseInt(op.count || 1),
      glazing_material_id: op.glazing_material_id || 'double_glazing',
    })),
    orientation_deg: parseFloat(overrides.orientation_deg ?? formData.orientation_deg ?? 180),
    climate_profile_id: formData.climate_profile_id || 'ladakh_winter',
    min_ambient_temp_C: formData.min_ambient_temp_C != null ? parseFloat(formData.min_ambient_temp_C) : -19.2,
    max_ambient_temp_C: formData.max_ambient_temp_C != null ? parseFloat(formData.max_ambient_temp_C) : 3.5,
    peak_solar_radiation_W_m2: formData.peak_solar_radiation_W_m2 != null ? parseFloat(formData.peak_solar_radiation_W_m2) : 940.0,
    duration_hours: parseInt(formData.duration_hours || 24),
    variant_label: overrides.variant_label || formData.variant_label || 'Base Design',
    engine: engine,
  });

  const handleSubmit = async () => {
    setCancelled(false);
    setLoading(true);
    const timeoutMs = pollTimeoutMsFor(engine);
    const engineMsg = engine === 'ansys'
      ? 'ANSYS MAPDL: building 3D mesh and solving 24h transient thermal FEA (this can take several minutes)...'
      : 'Running FDM thermal simulation...';
    const progressTick = (result, attempt) => {
      if (cancelled) throw new Error('Cancelled');
      if (engine === 'ansys') {
        const elapsedMin = Math.round(((attempt + 1) * 3) / 60 * 10) / 10;
        setLoadingMsg(`${engineMsg} (${elapsedMin} min elapsed)`);
      }
    };
    try {
      if (compareMode && variants.length > 0) {
        setLoadingMsg('Submitting comparison simulation...');
        const allVariants = [
          buildPayload({ variant_label: 'Base Design (Variant 1)' }),
          ...variants.map((v, i) =>
            buildPayload({
              wall_material_id: v.wall_material_id || formData.wall_material_id,
              roof_material_id: v.roof_material_id || formData.roof_material_id,
              floor_material_id: v.floor_material_id || formData.floor_material_id,
              orientation_deg: v.orientation_deg ?? formData.orientation_deg,
              variant_label: v.variant_label || `Variant ${i + 2}`,
            })
          ),
        ];
        const { job_id } = await submitCompare(allVariants);
        setLoadingMsg('Running comparative thermal simulation...');
        const compareResult = await pollUntilDone(job_id, true, progressTick, timeoutMs);
        if (compareResult.status === 'failed') {
          throw new Error(compareResult.error_message || 'Comparison simulation failed on the server.');
        }
        navigate('/results', { state: { compareResult, input: formData, isCompare: true } });
      } else {
        setLoadingMsg('Submitting simulation...');
        const payload = buildPayload({ variant_label: 'Custom Design' });
        const { job_id } = await submitSimulation(payload);
        setLoadingMsg(engineMsg);
        const result = await pollUntilDone(job_id, false, progressTick, timeoutMs);
        if (result.status === 'failed') {
          throw new Error(result.error_message || 'Simulation failed on the server.');
        }
        navigate('/results', { state: { result, input: formData, isCompare: false } });
      }
    } catch (err) {
      setLoading(false);
      if (!cancelled) {
        // Surface the backend's real reason (FastAPI 422 validation detail /
        // 400 message) instead of a cryptic "Request failed with status 422",
        // which otherwise looks like the app terminated on its own.
        const detail = err?.response?.data?.detail;
        let msg = err?.message || 'Unknown error';
        if (Array.isArray(detail)) {
          msg = detail.map((d) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('\n');
        } else if (typeof detail === 'string') {
          msg = detail;
        }
        alert(`Simulation could not start:\n\n${msg}\n\nApne dimensions/inputs check karein aur dobara try karein.`);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isStarted) {
    return (
      <div className="max-w-4xl mx-auto py-4 space-y-8">
        {loading && (
          <LoadingSpinner
            message={loadingMsg}
            onCancel={() => { setCancelled(true); setLoading(false); }}
          />
        )}

        {/* Hero Banner Card */}
        <div className="bg-slate-950 text-white rounded-3xl border border-slate-800 p-8 sm:p-12 relative overflow-hidden shadow-2xl cad-grid-dark">
          <div className="relative z-10 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-md bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[11px] font-mono font-bold uppercase tracking-wider">
                THERMA·LADAKH SIMULATION PLATFORM
              </span>
              <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-mono">
                ANSYS MAPDL FEA + FDM DUAL-ENGINE
              </span>
            </div>

            <div className="space-y-3 max-w-2xl">
              <h1 className="text-3xl sm:text-4xl font-extrabold font-sans tracking-tight text-white leading-tight">
                High-Altitude Passive Shelter Thermal Architecture
              </h1>
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-sans">
                Computational modeling and numerical transient analysis for extreme cold climates (-20°C). 
                Evaluate passive solar gain, building envelope thermal inertia, and 24-hour interior temperature profiles before construction.
              </p>
            </div>

            {/* Primary Action Button */}
            <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <button
                type="button"
                onClick={() => handleStart(null, 0)}
                className="px-8 py-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-mono text-sm font-bold shadow-xl shadow-sky-600/30 transition-all flex items-center gap-3 group border border-sky-400/30"
              >
                <span>Initialize Shelter Model</span>
                <span className="group-hover:translate-x-1 transition-transform font-mono">→</span>
              </button>

              <button
                type="button"
                onClick={() => handleStart(null, 3)}
                className="px-6 py-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-mono text-xs font-semibold border border-slate-700 transition-all"
              >
                ⚡ Open 36-Design Optimizer
              </button>
            </div>
          </div>
        </div>

        {/* Architectural Baseline Presets Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-900">
                Pre-Engineered Architecture Baselines
              </h2>
              <p className="text-xs text-slate-500">Select a validated regional template to pre-load dimensions and envelope parameters</p>
            </div>
            <span className="text-xs font-mono text-slate-400 hidden sm:inline">3 Templates Available</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-sky-500/50 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4 group"
              >
                <div className="space-y-2">
                  <span className="inline-block px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono font-bold uppercase tracking-wider">
                    {preset.badge}
                  </span>
                  <h3 className="font-bold text-sm text-slate-900 group-hover:text-sky-600 transition-colors">
                    {preset.name}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {preset.desc}
                  </p>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-mono text-slate-600 space-y-1">
                    <div><span className="text-slate-400">Dim:</span> {preset.dimensions}</div>
                    <div><span className="text-slate-400">Spec:</span> {preset.envelope}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStart(preset, 0)}
                    className="w-full py-2 bg-slate-50 hover:bg-sky-50 hover:text-sky-700 text-slate-700 border border-slate-200 hover:border-sky-300 rounded-lg text-xs font-mono font-bold transition-all text-center"
                  >
                    Load & Configure →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Telemetry Showcase Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="text-xs font-mono font-bold text-slate-900 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
              ANSYS MAPDL SOLID70
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              3D parameterized solid volume mesh generating transient thermal conduction and nodal temperature gradients.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="text-xs font-mono font-bold text-slate-900 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Diurnal Solar Ray-Tracing
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Azimuth-dependent direct beam and sky-diffuse irradiation flux entering high-altitude south glazing.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="text-xs font-mono font-bold text-slate-900 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              36-Design Parameter Sweep
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Automated combinatorial physics optimizer testing candidate envelope assemblies to maximize comfort hours.
            </p>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="max-w-3xl mx-auto py-2">
      {loading && (
        <LoadingSpinner
          message={loadingMsg}
          onCancel={() => { setCancelled(true); setLoading(false); }}
        />
      )}

      {/* Back to Landing Hub Button */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setIsStarted(false)}
          className="text-xs font-mono text-slate-500 hover:text-slate-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
        >
          <span>←</span>
          <span>Back to Project Hub</span>
        </button>
        <span className="text-[11px] font-mono text-slate-400">Model Configuration Wizard</span>
      </div>

      {/* Stepper Header */}
      <StepIndicator steps={STEPS} currentStep={step} />

      {/* Main Form Workstation Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        {step === 0 && <GeometryStep data={formData} onChange={onChange} errors={errors} />}
        {step === 1 && <MaterialsStep data={formData} onChange={onChange} materials={materials} errors={errors} />}
        {step === 2 && (
          <OrientationStep
            data={formData}
            onChange={onChange}
            climateProfiles={climateProfiles}
            errors={errors}
            compareMode={compareMode}
            onCompareModeChange={setCompareMode}
          />
        )}
        {step === 3 && (
          <ReviewStep
            data={formData}
            materials={materials}
            climateProfiles={climateProfiles}
            compareMode={compareMode}
            variants={variants}
            onAddVariant={addVariant}
            onRemoveVariant={removeVariant}
            onVariantChange={updateVariant}
          />
        )}

        {/* Engine Mode Selector — shown on Step 4 */}
        {step === 3 && (
          <div className="mt-6 p-4 rounded-xl border border-slate-200 bg-slate-50/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-800">Computation Engine Pipeline</span>
              <span className="text-[11px] font-mono text-slate-500">ISO 13790 Compliant</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setEngine('fdm')}
                className={`p-3.5 rounded-xl border text-left transition-all ${
                  engine === 'fdm'
                    ? 'bg-slate-900 border-slate-800 text-white shadow-md'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">Python FDM Solver</span>
                  <span className={`w-2 h-2 rounded-full ${engine === 'fdm' ? 'bg-sky-400' : 'bg-slate-300'}`} />
                </div>
                <p className={`text-[11px] leading-relaxed ${engine === 'fdm' ? 'text-slate-300' : 'text-slate-500'}`}>
                  Implicit 1D multi-layer finite difference solver. Fast iteration in seconds.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setEngine('ansys')}
                className={`p-3.5 rounded-xl border text-left transition-all ${
                  engine === 'ansys'
                    ? 'bg-slate-900 border-slate-800 text-white shadow-md'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">ANSYS MAPDL + FEA</span>
                  <span className={`w-2 h-2 rounded-full ${engine === 'ansys' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                </div>
                <p className={`text-[11px] leading-relaxed ${engine === 'ansys' ? 'text-slate-300' : 'text-slate-500'}`}>
                  3D solid parametric APDL geometry + transient thermal FEA (SOLID70 elements).
                </p>
              </button>
            </div>
          </div>
        )}


        {/* Stepper Navigation Footer */}
        <div className="flex justify-between items-center mt-8 pt-5 border-t border-slate-100">
          <button
            type="button"
            onClick={prev}
            disabled={step === 0}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-mono font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            ← Previous Step
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              className="px-6 py-2 rounded-lg bg-slate-900 text-sky-400 hover:text-white hover:bg-slate-800 text-xs font-mono font-bold transition-all shadow-sm border border-slate-800 flex items-center gap-1.5"
            >
              <span>Next Step</span>
              <span>→</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="px-8 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold transition-all shadow-md shadow-sky-600/20 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>{compareMode && variants.length > 0 ? 'Execute Comparison Simulation' : 'Execute Thermal Simulation'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
