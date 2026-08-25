import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import StepIndicator from '../components/StepIndicator';
import CompassSelector from '../components/CompassSelector';
import MaterialSelect from '../components/MaterialSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import Shelter3DViewer from '../components/Shelter3DViewer';
import {
  getMaterials,
  getClimateProfiles,
  submitSimulation,
  submitCompare,
  pollUntilDone,
} from '../api/simulationApi';

const STEPS = ['Geometry', 'Materials', 'Orientation', 'Submit'];

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
  const svgW = 200;
  const svgH = 140;
  const scale = Math.min((svgW - 40) / data.length_m, (svgH - 40) / data.width_m);
  const rectW = data.length_m * scale;
  const rectH = data.width_m * scale;
  const rx = (svgW - rectW) / 2;
  const ry = (svgH - rectH) / 2;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-primary">Shelter Geometry</h2>

      <div>
        <label className="text-sm font-semibold text-gray-700 mb-2 block">Shape</label>
        <div className="flex gap-4">
          {[
            { value: 'rectangular', label: 'Rectangular' },
            { value: 'dome', label: 'Dome' },
          ].map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange('shape', s.value)}
              className={`flex-1 py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all ${
                data.shape === s.value
                  ? 'border-primary bg-primary/5 text-primary shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:border-primary/40'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {[
        { key: 'length_m', label: 'Length', sliderMin: 3, sliderMax: 50, unit: 'm', step: 0.5 },
        { key: 'width_m',  label: 'Width',  sliderMin: 3, sliderMax: 50, unit: 'm', step: 0.5 },
        { key: 'height_m', label: 'Height', sliderMin: 2, sliderMax: 20,  unit: 'm', step: 0.1 },
      ].map(({ key, label, sliderMin, sliderMax, unit, step }) => (
        <div key={key}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-semibold text-gray-700">{label}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0.1}
                step={step}
                value={data[key]}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) onChange(key, v);
                }}
                className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-sm text-gray-500">{unit}</span>
            </div>
          </div>
          <input
            type="range" min={sliderMin} max={sliderMax} step={step}
            value={Math.min(data[key], sliderMax)}
            onChange={(e) => onChange(key, parseFloat(e.target.value))}
            className="w-full accent-primary"
          />
          {errors[key] && <p className="text-red-500 text-xs mt-1">{errors[key]}</p>}
        </div>
      ))}

      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
        <p className="text-xs font-semibold text-gray-500 mb-2 text-center">Floor Plan Preview</p>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-xs mx-auto block">
          {data.shape === 'dome' ? (
            <ellipse
              cx={svgW / 2} cy={svgH / 2}
              rx={rectW / 2} ry={rectH / 2}
              fill="#dbeafe" stroke="#1B5E7B" strokeWidth="2"
            />
          ) : (
            <rect
              x={rx} y={ry} width={rectW} height={rectH}
              fill="#dbeafe" stroke="#1B5E7B" strokeWidth="2" rx="3"
            />
          )}
          <text x={svgW / 2} y={ry + rectH / 2 + 5} textAnchor="middle" fontSize="12" fill="#1B5E7B" fontWeight="bold">
            {data.length_m}m x {data.width_m}m
          </text>
          <text x="10" y="15" fontSize="10" fill="#64748b">North</text>
          {data.shape === 'dome' && (
            <text x={svgW / 2} y={ry + rectH / 2 + 20} textAnchor="middle" fontSize="10" fill="#1B5E7B">⦿ Dome</text>
          )}
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
        ? { type: 'window', width_m: 1.0, height_m: 1.2, count: 1, glazing_material_id: defaultGlazing }
        : { type: 'door', width_m: 1.0, height_m: 2.1, count: 1, glazing_material_id: 'single_glazing' };
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
      <h2 className="text-xl font-bold text-primary">Materials & Openings</h2>

      <MaterialSelect
        label="Wall Material"
        materials={materials}
        value={data.wall_material_id}
        onChange={(v) => onChange('wall_material_id', v)}
        thickness={data.wall_thickness_m}
        onThicknessChange={(v) => onChange('wall_thickness_m', v)}
        category="no_glazing"
      />
      {errors.wall_material_id && <p className="text-red-500 text-xs">{errors.wall_material_id}</p>}

      <MaterialSelect
        label="Roof Material"
        materials={materials}
        value={data.roof_material_id}
        onChange={(v) => onChange('roof_material_id', v)}
        thickness={data.roof_thickness_m}
        onThicknessChange={(v) => onChange('roof_thickness_m', v)}
        category="no_glazing"
      />
      {errors.roof_material_id && <p className="text-red-500 text-xs">{errors.roof_material_id}</p>}

      <MaterialSelect
        label="Floor Material"
        materials={materials}
        value={data.floor_material_id}
        onChange={(v) => onChange('floor_material_id', v)}
        thickness={data.floor_thickness_m}
        onThicknessChange={(v) => onChange('floor_thickness_m', v)}
        category="no_glazing"
      />
      {errors.floor_material_id && <p className="text-red-500 text-xs">{errors.floor_material_id}</p>}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">Openings (Windows & Doors)</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addOpening('window')}
              className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-light transition-colors font-medium"
            >
              + Add Window
            </button>
            <button
              type="button"
              onClick={() => addOpening('door')}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-light transition-colors font-medium"
            >
              + Add Door
            </button>
          </div>
        </div>

        {data.openings.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
            No openings added yet. Add windows or doors above.
          </p>
        )}

        <div className="space-y-3">
          {data.openings.map((op, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700">
                  {op.type === 'window' ? 'Window' : 'Door'} {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeOpening(i)}
                  className="text-red-500 hover:text-red-700 text-xs font-semibold"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500">Width (m)</span>
                  <input
                    type="number" min={0.3} max={3} step={0.1}
                    value={op.width_m}
                    onChange={(e) => updateOpening(i, 'width_m', parseFloat(e.target.value) || 0.5)}
                    className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                    readOnly={op.type === 'door'}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500">Height (m)</span>
                  <input
                    type="number" min={0.3} max={3} step={0.1}
                    value={op.height_m}
                    onChange={(e) => updateOpening(i, 'height_m', parseFloat(e.target.value) || 0.5)}
                    className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                    readOnly={op.type === 'door'}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500">Count</span>
                  <input
                    type="number" min={1} max={10} step={1}
                    value={op.count}
                    onChange={(e) => updateOpening(i, 'count', parseInt(e.target.value) || 1)}
                    className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                  />
                </label>
              </div>
              {op.type === 'window' && (
                <label className="flex flex-col gap-1 mt-2 text-xs">
                  <span className="text-gray-500">Glazing Type</span>
                  <select
                    value={op.glazing_material_id || 'double_glazing'}
                    onChange={(e) => updateOpening(i, 'glazing_material_id', e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                  >
                    {glazingMaterials.map((m) => {
                      const matId = m.id || m.material_id;
                      return (
                        <option key={matId} value={matId}>{m.name}</option>
                      );
                    })}
                  </select>
                </label>
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
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-primary">Orientation & Climate</h2>

      <div className="flex flex-col items-center">
        <label className="text-sm font-semibold text-gray-700 mb-3 self-start">
          Facade Orientation
        </label>
        <CompassSelector
          value={data.orientation_deg}
          onChange={(deg) => onChange('orientation_deg', deg)}
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 mb-2 block">Climate Profile</label>
        {climateProfiles.length === 0 ? (
          <p className="text-sm text-gray-400">Loading climate profiles...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {climateProfiles.map((cp) => {
              const cId = cp.id || cp.profile_id;
              const isSelected = data.climate_profile_id === cId;
              return (
                <button
                  key={cId}
                  type="button"
                  onClick={() => onChange('climate_profile_id', cId)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 text-primary shadow-sm font-semibold'
                      : 'border-gray-200 hover:border-primary/40 text-gray-700'
                  }`}
                >
                  <p className="font-bold text-sm">{cp.name || cId}</p>
                  {cp.description && (
                    <p className="text-xs text-gray-500 mt-1 font-normal">{cp.description}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {errors.climate_profile_id && (
          <p className="text-red-500 text-xs mt-1">{errors.climate_profile_id}</p>
        )}
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 mb-2 block">Simulation Duration</label>
        <div className="flex gap-6">
          {[24, 48, 72].map((h) => (
            <label key={h} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700">
              <input
                type="radio"
                name="duration"
                value={h}
                checked={data.duration_hours === h}
                onChange={() => onChange('duration_hours', h)}
                className="accent-primary"
              />
              <span>{h} hours</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
        <input
          type="checkbox"
          id="compare-mode"
          checked={compareMode}
          onChange={(e) => onCompareModeChange(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
        <label htmlFor="compare-mode" className="text-sm font-semibold text-primary cursor-pointer">
          Enable Multi-Design Comparison (up to 5 variants)
        </label>
      </div>
    </div>
  );
}

// --- Step 4: Review & Submit ---
function ReviewStep({ data, materials, climateProfiles, compareMode, variants, onAddVariant, onRemoveVariant, onVariantChange }) {
  const mat = (id) => materials.find((m) => (m.id || m.material_id) === id)?.name || id || '-';
  const cp = (id) => climateProfiles.find((c) => (c.id || c.profile_id) === id)?.name || id || '-';
  const degLabel = (d) => {
    const dirs = { 0:'North (0 deg)', 45:'NE (45 deg)', 90:'East (90 deg)', 135:'SE (135 deg)', 180:'South (180 deg)', 225:'SW (225 deg)', 270:'West (270 deg)', 315:'NW (315 deg)' };
    return dirs[d] || `${d} deg`;
  };

  const rows = [
    ['Shape', data.shape],
    ['Dimensions', `${data.length_m}m L x ${data.width_m}m W x ${data.height_m}m H`],
    ['Wall', `${mat(data.wall_material_id)} (${data.wall_thickness_m}m)`],
    ['Roof', `${mat(data.roof_material_id)} (${data.roof_thickness_m}m)`],
    ['Floor', `${mat(data.floor_material_id)} (${data.floor_thickness_m}m)`],
    ['Openings', `${data.openings.length} total (${data.openings.filter(o=>o.type==='window').length} windows, ${data.openings.filter(o=>o.type==='door').length} doors)`],
    ['Orientation', degLabel(data.orientation_deg)],
    ['Climate', cp(data.climate_profile_id)],
    ['Duration', `${data.duration_hours} hours`],
  ];

  const nonGlazingMaterials = materials.filter((m) => m.category !== 'glazing');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-primary">
        {compareMode ? 'Manage Design Variants' : 'Review & Submit'}
      </h2>

      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="bg-primary/5 px-4 py-2 border-b border-gray-200">
          <p className="text-sm font-bold text-primary">Base Design (Variant 1)</p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 text-gray-500 font-medium w-36">{k}</td>
                <td className="px-4 py-2 text-gray-800 font-semibold">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Live 3D Model Inspection */}
      <div className="space-y-2">
        <p className="text-sm font-bold text-gray-700">3D Shelter Model Preview</p>
        <Shelter3DViewer
          shelterData={data}
          height="340px"
          allowLaunchGui={true}
        />
      </div>

      {compareMode && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-700">Additional Variants to Compare</h3>
            {variants.length < 4 && (
              <button
                type="button"
                onClick={onAddVariant}
                className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-light transition-colors font-medium"
              >
                + Add Variant
              </button>
            )}
          </div>

          {variants.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
              Click "+ Add Variant" to compare different materials or orientations.
            </p>
          )}

          {variants.map((v, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold text-sm text-primary">{v.variant_label || `Variant ${i + 2}`}</span>
                <button
                  type="button"
                  onClick={() => onRemoveVariant(i)}
                  className="text-red-500 text-xs font-semibold hover:text-red-700"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Wall Material</label>
                  <select
                    value={v.wall_material_id || data.wall_material_id}
                    onChange={(e) => onVariantChange(i, 'wall_material_id', e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  >
                    {nonGlazingMaterials.map((m) => {
                      const matId = m.id || m.material_id;
                      return (
                        <option key={matId} value={matId}>{m.name}</option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Orientation</label>
                  <select
                    value={v.orientation_deg ?? data.orientation_deg}
                    onChange={(e) => onVariantChange(i, 'orientation_deg', parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  >
                    {[['North (0 deg)', 0], ['NE (45 deg)', 45], ['East (90 deg)', 90], ['SE (135 deg)', 135], ['South (180 deg)', 180], ['SW (225 deg)', 225], ['West (270 deg)', 270], ['NW (315 deg)', 315]].map(([label, deg]) => (
                      <option key={deg} value={deg}>{label}</option>
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
  const [engine, setEngine] = useState('fdm'); // 'fdm' | 'ansys'


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
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateStep = () => {
    const e = {};
    if (step === 0) {
      if (formData.length_m < 3 || formData.length_m > 20) e.length_m = 'Length must be 3-20m';
      if (formData.width_m < 3 || formData.width_m > 20) e.width_m = 'Width must be 3-20m';
      if (formData.height_m < 2 || formData.height_m > 6) e.height_m = 'Height must be 2-6m';
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
        wall_material_id: 'mud_eps_composite',
        orientation_deg: formData.orientation_deg,
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
    duration_hours: parseInt(formData.duration_hours || 24),
    variant_label: overrides.variant_label || formData.variant_label || 'Base Design',
    engine: engine,
  });

  const handleSubmit = async () => {
    setCancelled(false);
    setLoading(true);
    const engineMsg = engine === 'ansys'
      ? 'Phase 1: ANSYS building 3D shelter design... then Phase 2: FDM thermal analysis...'
      : 'Running FDM thermal simulation...';
    try {
      if (compareMode && variants.length > 0) {
        setLoadingMsg('Submitting comparison simulation...');
        const allVariants = [
          buildPayload({ variant_label: 'Base Design (Variant 1)' }),
          ...variants.map((v, i) =>
            buildPayload({
              wall_material_id: v.wall_material_id || formData.wall_material_id,
              orientation_deg: v.orientation_deg ?? formData.orientation_deg,
              variant_label: v.variant_label || `Variant ${i + 2}`,
            })
          ),
        ];
        const { job_id } = await submitCompare(allVariants);
        setLoadingMsg('Running comparative thermal simulation...');
        const compareResult = await pollUntilDone(job_id, true, () => {
          if (cancelled) throw new Error('Cancelled');
        });
        navigate('/results', { state: { compareResult, input: formData, isCompare: true } });
      } else {
        setLoadingMsg('Submitting simulation...');
        const payload = buildPayload({ variant_label: 'Custom Design' });
        const { job_id } = await submitSimulation(payload);
        setLoadingMsg(engineMsg);
        const result = await pollUntilDone(job_id, false, () => {
          if (cancelled) throw new Error('Cancelled');
        });
        navigate('/results', { state: { result, input: formData, isCompare: false } });
      }
    } catch (err) {
      setLoading(false);
      if (!cancelled) alert(`Simulation error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {loading && (
        <LoadingSpinner
          message={loadingMsg}
          onCancel={() => { setCancelled(true); setLoading(false); }}
        />
      )}

      <StepIndicator steps={STEPS} currentStep={step} />

      <div className="bg-white rounded-2xl shadow-md p-6 border border-gray-100">
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

        {/* Engine Mode Selector — shown on final step */}
        {step === 3 && (
          <div className="mt-6 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
            <p className="text-sm font-bold text-gray-700">Simulation Engine</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEngine('fdm')}
                className={`flex-1 py-3 px-3 rounded-lg border text-sm font-semibold transition-colors text-left ${
                  engine === 'fdm'
                    ? 'bg-primary text-white border-primary shadow-md'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                Fast Mode (FDM)
                <span className="block text-xs font-normal mt-1 opacity-80">
                  Results in seconds. Pure Python physics-based 1D solver.
                  Good for quick comparisons.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setEngine('ansys')}
                className={`flex-1 py-3 px-3 rounded-lg border text-sm font-semibold transition-colors text-left ${
                  engine === 'ansys'
                    ? 'bg-accent text-white border-accent shadow-md'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                ANSYS Mode (2-Phase)
                <span className="block text-xs font-normal mt-1 opacity-80">
                  Phase 1: ANSYS builds accurate 3D shelter design.
                  Phase 2: FDM thermal analysis on ANSYS geometry.
                  Higher accuracy. May take 2-5 min.
                </span>
              </button>
            </div>
            {engine === 'ansys' && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  ANSYS Student v2026 R1 detected at D:\ANSYS Inc\ANSYS Student\v261.
                  Phase 1 builds the 3D model in ANSYS, then Phase 2 runs FDM thermal analysis
                  using the exact ANSYS geometry. If ANSYS fails, falls back to Fast Mode automatically.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between mt-8 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={prev}
            disabled={step === 0}
            className="px-5 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              className="px-6 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary-light transition-colors shadow-sm"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="px-8 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-light transition-colors shadow-md"
            >
              {compareMode && variants.length > 0 ? 'Run Comparison' : 'Run Simulation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
