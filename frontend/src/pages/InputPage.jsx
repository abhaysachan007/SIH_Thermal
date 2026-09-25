import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
    badge: 'RECOMMENDED · LEH',
    desc: 'High thermal inertia mud-brick envelope with dual south-facing glazing for maximum solar storage in high-altitude valley terrains.',
    dimensions: '6.0m × 4.0m × 3.0m',
    envelope: '30cm Mud Brick · 180° Direct',
    config: {
      shape: 'rectangular', length_m: 6.0, width_m: 4.0, height_m: 3.0,
      wall_material_id: 'mud_brick', wall_thickness_m: 0.30,
      roof_material_id: 'mud_brick', roof_thickness_m: 0.20,
      floor_material_id: 'rammed_earth', floor_thickness_m: 0.15,
      openings: [{ type: 'window', width_m: 1.2, height_m: 1.2, count: 2, glazing_material_id: 'double_glazing' }],
      orientation_deg: 180, climate_profile_id: 'ladakh_winter',
      min_ambient_temp_C: -19.2, max_ambient_temp_C: 3.5,
      peak_solar_radiation_W_m2: 940.0, duration_hours: 24,
      variant_label: 'Mud-Brick Passive Shelter',
    },
  },
  {
    id: 'insulated_stone',
    name: 'Insulated Stone Alpine Unit',
    badge: 'EXTREME -30°C',
    desc: 'Heavy local stone masonry thermal mass reinforced with exterior insulation to endure extreme sub-zero wind chills.',
    dimensions: '8.0m × 5.0m × 3.0m',
    envelope: '35cm Stone + EPS · Triple Glaze',
    config: {
      shape: 'rectangular', length_m: 8.0, width_m: 5.0, height_m: 3.0,
      wall_material_id: 'stone_masonry', wall_thickness_m: 0.35,
      roof_material_id: 'insulation_eps', roof_thickness_m: 0.25,
      floor_material_id: 'concrete', floor_thickness_m: 0.20,
      openings: [{ type: 'window', width_m: 1.5, height_m: 1.2, count: 3, glazing_material_id: 'triple_glazing' }],
      orientation_deg: 180, climate_profile_id: 'ladakh_winter',
      min_ambient_temp_C: -25.0, max_ambient_temp_C: -2.0,
      peak_solar_radiation_W_m2: 980.0, duration_hours: 24,
      variant_label: 'Insulated Stone Unit',
    },
  },
  {
    id: 'igloo_dome',
    name: 'Aerodynamic Igloo Dome',
    badge: 'HIGH-WIND RIDGE',
    desc: 'Hemispherical aerodynamic structure minimizing external perimeter surface area and high-velocity wind convective dissipation.',
    dimensions: '5.0m × 5.0m × 2.8m',
    envelope: 'Hemisphere · Rammed Earth',
    config: {
      shape: 'dome', length_m: 5.0, width_m: 5.0, height_m: 2.8,
      wall_material_id: 'rammed_earth', wall_thickness_m: 0.30,
      roof_material_id: 'rammed_earth', roof_thickness_m: 0.20,
      floor_material_id: 'rammed_earth', floor_thickness_m: 0.15,
      openings: [{ type: 'window', width_m: 1.0, height_m: 1.0, count: 1, glazing_material_id: 'double_glazing' }],
      orientation_deg: 180, climate_profile_id: 'ladakh_winter',
      min_ambient_temp_C: -22.0, max_ambient_temp_C: 0.0,
      peak_solar_radiation_W_m2: 900.0, duration_hours: 24,
      variant_label: 'Aerodynamic Igloo Dome',
    },
  },
];

const DEFAULT_FORM = {
  shape: 'rectangular', length_m: 6.0, width_m: 4.0, height_m: 3.0,
  wall_material_id: 'mud_brick', wall_thickness_m: 0.30,
  roof_material_id: 'mud_brick', roof_thickness_m: 0.20,
  floor_material_id: 'rammed_earth', floor_thickness_m: 0.15,
  openings: [{ type: 'window', width_m: 1.2, height_m: 1.2, count: 2, glazing_material_id: 'double_glazing' }],
  orientation_deg: 180, climate_profile_id: 'ladakh_winter', duration_hours: 24,
  variant_label: 'Base Design',
};

function GeometryStep({ data, onChange, errors }) {
  const svgW = 240; const svgH = 150;
  const scale = Math.min((svgW - 50) / data.length_m, (svgH - 50) / data.width_m);
  const rectW = data.length_m * scale; const rectH = data.width_m * scale;
  const rx = (svgW - rectW) / 2; const ry = (svgH - rectH) / 2;
  const floorArea = (data.length_m * data.width_m).toFixed(1);
  const envelopeVol = (data.length_m * data.width_m * data.height_m).toFixed(1);

  return (
    <div style={{display:'flex', flexDirection:'column', gap:'28px'}}>
      {/* Meteorological Boundary Conditions */}
      <div className="card card-sm" style={{borderLeft: '2px solid var(--ice)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)', paddingBottom:'12px', marginBottom:'16px'}}>
          <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--ice)', display:'inline-block', animation:'pulse-dot 2s infinite'}} />
            <span style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ice)'}}>Site Meteorological Boundary Conditions</span>
          </div>
          <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>Leh 34.15°N · 3500m</span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
          {[
            {key:'min_ambient_temp_C', label:'Min Night Temp', default:-19.2, min:-40, max:20, color:'var(--ice)'},
            {key:'max_ambient_temp_C', label:'Max Day Temp', default:3.5, min:-25, max:45, color:'#FF9A3C'},
            {key:'peak_solar_radiation_W_m2', label:'Peak Solar', default:940, min:100, max:1300, step:10, color:'var(--fire)', unit:' W/m²'},
          ].map(f => (
            <div key={f.key} style={{background:'var(--bg-2)', border:'1px solid var(--border)', padding:'10px 14px'}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.08em'}}>{f.label}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700, color:f.color}}>{(data[f.key] ?? f.default).toFixed?.(f.step ? 0 : 1) ?? data[f.key] ?? f.default}{f.unit ?? '°C'}</span>
              </div>
              <input type="range" min={f.min} max={f.max} step={f.step || 0.5}
                value={data[f.key] ?? f.default}
                onChange={e => onChange(f.key, parseFloat(e.target.value))}
                style={{width:'100%'}}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="section-eyebrow">Envelope Architecture</div>
        <div className="shape-grid">
          {[
            { value: 'rectangular', label: 'Alpine Rect', sub: 'Pitched Gable / Flat' },
            { value: 'aframe',      label: 'A-Frame',    sub: 'Snow-Shedding Alpine' },
            { value: 'dome',        label: 'Igloo Dome', sub: 'Aerodynamic Arch Form' },
          ].map(s => (
            <div key={s.value}
              className={`shape-card${data.shape === s.value ? ' selected' : ''}`}
              onClick={() => onChange('shape', s.value)}
            >
              <svg width="40" height="36" viewBox="0 0 40 36" fill="none">
                {s.value === 'rectangular' && <>
                  <rect x="4" y="14" width="32" height="18" stroke={data.shape===s.value?'var(--ice)':'var(--border-2)'} strokeWidth="1.5" fill={data.shape===s.value?'rgba(0,207,255,0.08)':'var(--bg)'}/>
                  <polyline points="1,14 20,4 39,14" stroke={data.shape===s.value?'var(--ice)':'var(--border-2)'} strokeWidth="1.5" fill="none"/>
                </>}
                {s.value === 'aframe' && <>
                  <polyline points="6,32 20,4 34,32" stroke={data.shape===s.value?'var(--ice)':'var(--border-2)'} strokeWidth="1.5" fill={data.shape===s.value?'rgba(0,207,255,0.08)':'var(--bg)'}/>
                  <line x1="6" y1="32" x2="34" y2="32" stroke={data.shape===s.value?'var(--ice)':'var(--border-2)'} strokeWidth="1.5"/>
                </>}
                {s.value === 'dome' && <>
                  <ellipse cx="20" cy="20" rx="16" ry="12" stroke={data.shape===s.value?'var(--ice)':'var(--border-2)'} strokeWidth="1.5" fill={data.shape===s.value?'rgba(0,207,255,0.08)':'var(--bg)'}/>
                </>}
              </svg>
              <span className="shape-label">{s.label}</span>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', textAlign:'center'}}>{s.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        {[
          { key: 'length_m', label: 'Length (L)', sliderMin: 3, sliderMax: 50, unit: 'm', step: 0.5, desc: 'Primary south/north span' },
          { key: 'width_m',  label: 'Width (W)',  sliderMin: 3, sliderMax: 50, unit: 'm', step: 0.5, desc: 'East/west cross section' },
          { key: 'height_m', label: 'Height (H)', sliderMin: 2, sliderMax: 20, unit: 'm', step: 0.1, desc: 'Interior thermal clearance' },
        ].map(({ key, label, sliderMin, sliderMax, unit, step, desc }) => (
          <div key={key} style={{background:'var(--bg-2)', border:'1px solid var(--border)', padding:'14px 18px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
              <div>
                <span style={{fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, color:'var(--text-1)'}}>{label}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', display:'block', marginTop:2}}>{desc}</span>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:6, border:'1px solid var(--border-2)', background:'var(--surface)', padding:'4px 10px'}}>
                <input type="number" min={0.1} step={step} value={data[key]}
                  onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onChange(key, v); }}
                  style={{width:48, fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:'var(--text-1)', textAlign:'right', background:'transparent', border:'none', outline:'none'}}
                />
                <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-3)'}}>{unit}</span>
              </div>
            </div>
            <input type="range" min={sliderMin} max={sliderMax} step={step}
              value={Math.min(data[key], sliderMax)}
              onChange={e => onChange(key, parseFloat(e.target.value))}
              style={{width:'100%'}}
            />
            {errors[key] && <p style={{color:'var(--fire)', fontSize:11, marginTop:6, fontFamily:'var(--font-mono)'}}>{errors[key]}</p>}
          </div>
        ))}
      </div>

      {/* CAD Schematic */}
      <div style={{background:'var(--bg-2)', border:'1px solid var(--border)'}} className="cad-grid-dark">
        <div style={{display:'flex', justifyContent:'space-between', padding:'10px 16px', borderBottom:'1px solid var(--border)', fontFamily:'var(--font-mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-3)'}}>
          <span>Floorplan CAD Schematic</span>
          <span>Area: <strong style={{color:'var(--ice)'}}>{floorArea} m²</strong> · Vol: <strong style={{color:'var(--text-1)'}}>{envelopeVol} m³</strong></span>
        </div>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{width:'100%', maxWidth:280, display:'block', margin:'0 auto', padding:'12px 0'}}>
          <g transform="translate(18, 20)">
            <circle cx="0" cy="0" r="10" fill="var(--surface)" stroke="var(--border-2)" strokeWidth="0.8" />
            <line x1="0" y1="8" x2="0" y2="-8" stroke="var(--fire)" strokeWidth="1.5" strokeLinecap="round" />
            <polygon points="0,-8 -3,-3 3,-3" fill="var(--fire)" />
            <text x="0" y="4" textAnchor="middle" fontSize="6" fill="var(--text-3)" fontFamily="monospace">N</text>
          </g>
          {data.shape === 'dome' ? (
            <ellipse cx={svgW/2} cy={svgH/2} rx={rectW/2} ry={rectH/2}
              fill="rgba(0,207,255,0.1)" stroke="var(--ice)" strokeWidth="1.5" strokeDasharray="4 2" />
          ) : (
            <rect x={rx} y={ry} width={rectW} height={rectH}
              fill="rgba(0,207,255,0.1)" stroke="var(--ice)" strokeWidth="1.5" />
          )}
          <text x={svgW/2} y={ry + rectH/2 + 4} textAnchor="middle" fontSize="11" fill="var(--text-1)" fontFamily="monospace" fontWeight="bold">
            {data.length_m}m × {data.width_m}m
          </text>
          <text x={svgW/2} y={ry + rectH + 14} textAnchor="middle" fontSize="8" fill="var(--fire)" fontFamily="monospace">
            ▲ SOUTH SOLAR FACADE (180°)
          </text>
        </svg>
      </div>
    </div>
  );
}

function MaterialsStep({ data, onChange, materials, errors }) {
  const glazingMaterials = materials.filter(m => m.category === 'glazing');

  const addOpening = type => {
    const defaultGlazing = glazingMaterials[0]?.id || glazingMaterials[0]?.material_id || 'double_glazing';
    const newOpening = type === 'window'
      ? { type: 'window', width_m: 1.2, height_m: 1.2, count: 1, glazing_material_id: defaultGlazing }
      : { type: 'door', width_m: 0.9, height_m: 2.1, count: 1, glazing_material_id: 'single_glazing' };
    onChange('openings', [...data.openings, newOpening]);
  };

  const updateOpening = (i, field, val) =>
    onChange('openings', data.openings.map((o, idx) => idx === i ? { ...o, [field]: val } : o));
  const removeOpening = i =>
    onChange('openings', data.openings.filter((_, idx) => idx !== i));

  return (
    <div style={{display:'flex', flexDirection:'column', gap:28}}>
      <div className="section-eyebrow">Thermal Envelope & Materials</div>

      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        <MaterialSelect label="Wall Assembly Material" materials={materials} value={data.wall_material_id}
          onChange={v => onChange('wall_material_id', v)} thickness={data.wall_thickness_m}
          onThicknessChange={v => onChange('wall_thickness_m', v)} category="no_glazing" />
        {errors.wall_material_id && <p style={{color:'var(--fire)', fontSize:11, fontFamily:'var(--font-mono)'}}>{errors.wall_material_id}</p>}

        <MaterialSelect label="Roof Assembly Material" materials={materials} value={data.roof_material_id}
          onChange={v => onChange('roof_material_id', v)} thickness={data.roof_thickness_m}
          onThicknessChange={v => onChange('roof_thickness_m', v)} category="no_glazing" />
        {errors.roof_material_id && <p style={{color:'var(--fire)', fontSize:11, fontFamily:'var(--font-mono)'}}>{errors.roof_material_id}</p>}

        <MaterialSelect label="Foundation / Floor Slab" materials={materials} value={data.floor_material_id}
          onChange={v => onChange('floor_material_id', v)} thickness={data.floor_thickness_m}
          onThicknessChange={v => onChange('floor_thickness_m', v)} category="no_glazing" />
        {errors.floor_material_id && <p style={{color:'var(--fire)', fontSize:11, fontFamily:'var(--font-mono)'}}>{errors.floor_material_id}</p>}
      </div>

      {/* Openings */}
      <div style={{border:'1px solid var(--border)', background:'var(--surface)', padding:'20px 24px'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
          <div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)', fontWeight:600}}>Glazing & Doors — South Facade</div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', marginTop:4}}>Direct solar radiation capture elements</div>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button type="button" onClick={() => addOpening('window')}
              style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', padding:'6px 14px', background:'var(--ice)', color:'#000', fontWeight:700, border:'none', cursor:'pointer'}}>
              + Window
            </button>
            <button type="button" onClick={() => addOpening('door')}
              style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase', padding:'6px 14px', background:'var(--bg-2)', color:'var(--text-2)', fontWeight:700, border:'1px solid var(--border)', cursor:'pointer'}}>
              + Door
            </button>
          </div>
        </div>

        {data.openings.length === 0 && (
          <div style={{border:'1px dashed var(--border-2)', padding:'24px', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-3)'}}>
            No openings added — south-facing windows recommended for passive solar heating
          </div>
        )}

        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {data.openings.map((op, i) => (
            <div key={i} style={{border:'1px solid var(--border)', background:'var(--bg-2)', padding:'14px 16px'}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}>
                <span style={{fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'0.06em'}}>
                  {op.type === 'window' ? 'Window' : 'Door'} #{i + 1}
                </span>
                <button type="button" onClick={() => removeOpening(i)}
                  style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--fire)', background:'none', border:'1px solid rgba(255,79,23,0.3)', padding:'2px 8px', cursor:'pointer', letterSpacing:'0.06em', textTransform:'uppercase'}}>
                  Remove
                </button>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
                {['width_m', 'height_m', 'count'].map(field => (
                  <div key={field}>
                    <label style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.1em', display:'block', marginBottom:6}}>
                      {field === 'width_m' ? 'Width (m)' : field === 'height_m' ? 'Height (m)' : 'Count'}
                    </label>
                    <input type="number"
                      min={field === 'count' ? 1 : 0.3}
                      max={field === 'count' ? 10 : 3}
                      step={field === 'count' ? 1 : 0.1}
                      value={op[field]}
                      onChange={e => updateOpening(i, field, field === 'count' ? parseInt(e.target.value)||1 : parseFloat(e.target.value)||0.5)}
                    />
                  </div>
                ))}
              </div>
              {op.type === 'window' && (
                <div style={{marginTop:10}}>
                  <label style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.1em', display:'block', marginBottom:6}}>Glazing Specification</label>
                  <select value={op.glazing_material_id || 'double_glazing'}
                    onChange={e => updateOpening(i, 'glazing_material_id', e.target.value)}>
                    {glazingMaterials.map(m => {
                      const matId = m.id || m.material_id;
                      return <option key={matId} value={matId}>{m.name} (SHGC ~{m.shgc ?? '0.65'})</option>;
                    })}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrientationStep({ data, onChange, climateProfiles, errors, compareMode, onCompareModeChange }) {
  const [liveStatus, setLiveStatus] = useState(null);
  const [liveNote, setLiveNote] = useState('');

  const handleFetchLive = async () => {
    setLiveStatus('loading'); setLiveNote('');
    try {
      const res = await fetchLiveClimate(34.15, 77.57);
      if (!res?.ok) { setLiveStatus('error'); setLiveNote(res?.detail || 'Live fetch failed'); return; }
      onChange('climate_profile_id', res.climate_profile_id);
      if (res.min_temp_C != null) onChange('min_ambient_temp_C', res.min_temp_C);
      if (res.max_temp_C != null) onChange('max_ambient_temp_C', res.max_temp_C);
      if (res.peak_solar_W_m2 != null) onChange('peak_solar_radiation_W_m2', res.peak_solar_W_m2);
      setLiveStatus('ok');
      setLiveNote(`${res.name} · ${res.min_temp_C}°C to ${res.max_temp_C}°C · peak ${res.peak_solar_W_m2} W/m²`);
    } catch (e) { setLiveStatus('error'); setLiveNote(e?.message || 'Network error'); }
  };

  return (
    <div style={{display:'flex', flexDirection:'column', gap:28}}>
      <div className="section-eyebrow">Solar Orientation & High-Altitude Climate</div>

      <div style={{border:'1px solid var(--border)', background:'var(--surface)', padding:'20px'}}>
        <div style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-3)', textAlign:'center', marginBottom:16}}>Solar Orientation & Facade Azimuth</div>
        <CompassSelector value={data.orientation_deg} onChange={deg => onChange('orientation_deg', deg)} />
      </div>

      <div>
        <div style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-3)', marginBottom:12}}>Meteorological Climate Dataset</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:8}}>
          {climateProfiles.map(cp => {
            const cId = cp.id || cp.profile_id;
            const isSelected = data.climate_profile_id === cId;
            return (
              <div key={cId}
                onClick={() => onChange('climate_profile_id', cId)}
                style={{
                  border: isSelected ? '1px solid rgba(0,207,255,0.5)' : '1px solid var(--border)',
                  background: isSelected ? 'rgba(0,207,255,0.06)' : 'var(--bg-2)',
                  padding:'16px 18px', cursor:'pointer', transition:'all 0.2s',
                  borderLeft: isSelected ? '3px solid var(--ice)' : '3px solid transparent',
                }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <span style={{fontFamily:'var(--font-display)', fontSize:13, fontWeight:700, color: isSelected ? 'var(--text-1)' : 'var(--text-2)'}}>{cp.name || cId}</span>
                  {isSelected && <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--ice)'}}>ACTIVE</span>}
                </div>
                {cp.description && <p style={{fontFamily:'var(--font-body)', fontSize:11, color:'var(--text-3)', marginTop:6, lineHeight:1.5}}>{cp.description}</p>}
              </div>
            );
          })}
        </div>
        {errors.climate_profile_id && <p style={{color:'var(--fire)', fontSize:11, marginTop:8, fontFamily:'var(--font-mono)'}}>{errors.climate_profile_id}</p>}

        <div style={{marginTop:16, display:'flex', flexDirection:'column', gap:8}}>
          <button type="button" onClick={handleFetchLive} disabled={liveStatus === 'loading'}
            style={{
              fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
              padding:'8px 16px', background:'var(--surface)', border:'1px solid var(--border)',
              color: liveStatus==='loading' ? '#FF9A3C' : 'var(--ice)', cursor:'pointer',
              display:'inline-flex', alignItems:'center', gap:8, opacity: liveStatus==='loading'?0.7:1,
            }}>
            <span style={{width:6,height:6,borderRadius:'50%',background:liveStatus==='loading'?'#FF9A3C':'var(--ice)',display:'inline-block'}} />
            {liveStatus === 'loading' ? 'Fetching NASA POWER…' : 'Fetch Live Leh Climate (NASA POWER)'}
          </button>
          {liveStatus === 'ok' && <p style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--lime)'}}>✓ {liveNote}</p>}
          {liveStatus === 'error' && <p style={{fontFamily:'var(--font-mono)', fontSize:10, color:'#FF9A3C'}}>Live fetch unavailable ({liveNote}). Using bundled dataset.</p>}
        </div>
      </div>

      {/* Duration */}
      <div style={{border:'1px solid var(--border)', background:'var(--surface)', padding:'14px 18px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-2)'}}>Simulation Horizon</span>
        <div style={{display:'flex', gap:6}}>
          {[24, 48, 72].map(h => (
            <button key={h} type="button" onClick={() => onChange('duration_hours', h)}
              style={{
                fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase',
                padding:'6px 14px', cursor:'pointer', border:'1px solid',
                borderColor: data.duration_hours===h ? 'var(--ice)' : 'var(--border)',
                background: data.duration_hours===h ? 'rgba(0,207,255,0.1)' : 'var(--bg-2)',
                color: data.duration_hours===h ? 'var(--ice)' : 'var(--text-3)',
              }}>
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Compare mode */}
      <div style={{border:'1px solid var(--border)', background:'var(--surface)', padding:'14px 18px', display:'flex', alignItems:'center', gap:14, cursor:'pointer'}}
        onClick={() => onCompareModeChange(!compareMode)}>
        <div style={{
          width:18, height:18, border:'1px solid', flexShrink:0,
          borderColor: compareMode ? 'var(--ice)' : 'var(--border-2)',
          background: compareMode ? 'var(--ice)' : 'transparent',
          display:'flex', alignItems:'center', justifyContent:'center'
        }}>
          {compareMode && <span style={{color:'#000', fontSize:11, fontWeight:700}}>✓</span>}
        </div>
        <div>
          <div style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-1)', fontWeight:600}}>Enable Multi-Design Comparison Matrix</div>
          <div style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', marginTop:3}}>Evaluate multiple material variants in parallel to find the optimal configuration</div>
        </div>
      </div>
    </div>
  );
}

function ReviewStep({ data, materials, climateProfiles, compareMode, variants, onAddVariant, onRemoveVariant, onVariantChange }) {
  const mat = id => materials.find(m => (m.id || m.material_id) === id)?.name || id || '-';
  const cp = id => climateProfiles.find(c => (c.id || c.profile_id) === id)?.name || id || '-';
  const rows = [
    ['Structural Form', data.shape === 'dome' ? 'Igloo Dome Hemisphere' : data.shape === 'aframe' ? 'A-Frame Alpine Cabin' : 'Alpine Rectangular'],
    ['Dimensions (L×W×H)', `${data.length_m}m × ${data.width_m}m × ${data.height_m}m`],
    ['Wall Assembly', `${mat(data.wall_material_id)} (${(data.wall_thickness_m * 100).toFixed(0)} cm)`],
    ['Roof Assembly', `${mat(data.roof_material_id)} (${(data.roof_thickness_m * 100).toFixed(0)} cm)`],
    ['Floor Assembly', `${mat(data.floor_material_id)} (${(data.floor_thickness_m * 100).toFixed(0)} cm)`],
    ['Fenestrations', `${data.openings.reduce((sum, o) => sum + (o.count || 1), 0)} openings`],
    ['Solar Orientation', `${data.orientation_deg}°`],
    ['Climate Profile', cp(data.climate_profile_id)],
    ['Transient Horizon', `${data.duration_hours} Hours`],
  ];
  const nonGlazingMaterials = materials.filter(m => m.category !== 'glazing');

  return (
    <div style={{display:'flex', flexDirection:'column', gap:28}}>
      <div className="section-eyebrow">{compareMode ? 'Multi-Variant Design Matrix' : 'Design Specification Review'}</div>

      <div style={{border:'1px solid var(--border)'}}>
        <div style={{background:'var(--surface-2)', borderBottom:'1px solid var(--border)', padding:'10px 18px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <span style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-2)'}}>{data.variant_label || 'Base Design'}</span>
          <span style={{fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.1em', color:'var(--lime)', border:'1px solid rgba(0,229,155,0.3)', padding:'2px 10px'}}>READY</span>
        </div>
        <table style={{width:'100%'}}>
          <tbody>
            {rows.map(([k, v], idx) => (
              <tr key={k} style={{background: idx % 2 === 0 ? 'var(--surface)' : 'var(--bg-2)'}}>
                <td style={{padding:'10px 18px', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-3)', width:200}}>{k}</td>
                <td style={{padding:'10px 18px', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-1)', fontWeight:600}}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {compareMode && (
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <span style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-3)'}}>{variants.length + 1} Variants Total</span>
            {variants.length < 4 && (
              <button type="button" onClick={onAddVariant}
                style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', padding:'6px 14px', background:'var(--surface)', border:'1px solid var(--border)', color:'var(--ice)', cursor:'pointer'}}>
                + Add Variant
              </button>
            )}
          </div>

          {variants.map((v, i) => (
            <div key={i} style={{border:'1px solid var(--border)', background:'var(--surface)', padding:'18px'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border)', paddingBottom:12, marginBottom:14}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <span style={{width:6, height:6, borderRadius:'50%', background:'var(--ice)', display:'inline-block'}} />
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-1)', fontWeight:600}}>Variant #{i + 2}</span>
                </div>
                <button type="button" onClick={() => onRemoveVariant(i)}
                  style={{fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--fire)', background:'none', border:'1px solid rgba(255,79,23,0.3)', padding:'3px 10px', cursor:'pointer'}}>
                  Remove
                </button>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12}}>
                {[
                  {field:'wall_material_id', label:'Wall Assembly'},
                  {field:'roof_material_id', label:'Roof Assembly'},
                  {field:'floor_material_id', label:'Floor Plinth'},
                ].map(({field, label}) => (
                  <div key={field}>
                    <label style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.1em', display:'block', marginBottom:6}}>{label}</label>
                    <select value={v[field] || data[field]}
                      onChange={e => onVariantChange(i, field, e.target.value)}>
                      {nonGlazingMaterials.map(m => (
                        <option key={m.id||m.material_id} value={m.id||m.material_id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div>
                  <label style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.1em', display:'block', marginBottom:6}}>Solar Azimuth</label>
                  <select value={v.orientation_deg ?? data.orientation_deg}
                    onChange={e => onVariantChange(i, 'orientation_deg', parseInt(e.target.value))}>
                    {[{deg:180,l:'180° South Direct'},{deg:135,l:'135° South-East'},{deg:225,l:'225° South-West'},{deg:90,l:'90° East'},{deg:270,l:'270° West'},{deg:0,l:'0° North'},{deg:45,l:'45° North-East'},{deg:315,l:'315° North-West'}].map(d => (
                      <option key={d.deg} value={d.deg}>{d.l}</option>
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
    getMaterials().catch(() => {}).then(d => { if (d && Array.isArray(d)) setMaterials(d); });
    getClimateProfiles().catch(() => {}).then(d => { if (d && Array.isArray(d)) setClimateProfiles(d); });
  }, []);

  const onChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = {...prev}; delete n[field]; return n; });
  };

  const handleStart = (preset = null, targetStep = 0) => {
    if (preset) setFormData(prev => ({ ...prev, ...preset.config }));
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
      if (!formData.wall_material_id) e.wall_material_id = 'Select a wall material';
      if (!formData.roof_material_id) e.roof_material_id = 'Select a roof material';
      if (!formData.floor_material_id) e.floor_material_id = 'Select a floor material';
    }
    if (step === 2) {
      if (!formData.climate_profile_id) e.climate_profile_id = 'Select a climate profile';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validateStep()) setStep(s => Math.min(s + 1, 3)); };
  const prev = () => setStep(s => Math.max(s - 1, 0));

  const addVariant = () => {
    const nextNum = variants.length + 2;
    setVariants(v => [...v, {
      variant_label: `Variant ${nextNum}`,
      wall_material_id: formData.wall_material_id || 'mud_brick',
      roof_material_id: formData.roof_material_id || 'mud_brick',
      floor_material_id: formData.floor_material_id || 'rammed_earth',
      orientation_deg: formData.orientation_deg ?? 180,
    }]);
  };
  const removeVariant = i => setVariants(v => v.filter((_, idx) => idx !== i));
  const updateVariant = (i, field, val) =>
    setVariants(v => v.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const buildPayload = (overrides = {}) => ({
    length_m: parseFloat(formData.length_m), width_m: parseFloat(formData.width_m), height_m: parseFloat(formData.height_m),
    shape: formData.shape,
    wall_material_id: overrides.wall_material_id || formData.wall_material_id || 'mud_brick',
    wall_thickness_m: parseFloat(formData.wall_thickness_m),
    roof_material_id: overrides.roof_material_id || formData.roof_material_id || 'mud_brick',
    roof_thickness_m: parseFloat(formData.roof_thickness_m),
    floor_material_id: overrides.floor_material_id || formData.floor_material_id || 'rammed_earth',
    floor_thickness_m: parseFloat(formData.floor_thickness_m),
    openings: formData.openings.map(op => ({
      type: op.type, width_m: parseFloat(op.width_m||1.0), height_m: parseFloat(op.height_m||1.2),
      count: parseInt(op.count||1), glazing_material_id: op.glazing_material_id || 'double_glazing',
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
    setCancelled(false); setLoading(true);
    const timeoutMs = pollTimeoutMsFor(engine);
    const engineMsg = engine === 'ansys'
      ? 'ANSYS MAPDL: building 3D mesh, solving 24h transient FEA…'
      : 'Running FDM thermal simulation…';
    const progressTick = (result, attempt) => {
      if (cancelled) throw new Error('Cancelled');
      if (engine === 'ansys') setLoadingMsg(`${engineMsg} (${Math.round(((attempt+1)*3)/60*10)/10} min elapsed)`);
    };
    try {
      if (compareMode && variants.length > 0) {
        setLoadingMsg('Submitting comparison simulation...');
        const allVariants = [
          buildPayload({ variant_label: 'Base Design (Variant 1)' }),
          ...variants.map((v, i) => buildPayload({
            wall_material_id: v.wall_material_id || formData.wall_material_id,
            roof_material_id: v.roof_material_id || formData.roof_material_id,
            floor_material_id: v.floor_material_id || formData.floor_material_id,
            orientation_deg: v.orientation_deg ?? formData.orientation_deg,
            variant_label: v.variant_label || `Variant ${i + 2}`,
          })),
        ];
        const { job_id } = await submitCompare(allVariants);
        setLoadingMsg('Running comparative thermal simulation...');
        const compareResult = await pollUntilDone(job_id, true, progressTick, timeoutMs);
        if (compareResult.status === 'failed') throw new Error(compareResult.error_message || 'Comparison failed.');
        navigate('/results', { state: { compareResult, input: formData, isCompare: true } });
      } else {
        setLoadingMsg('Submitting simulation...');
        const payload = buildPayload({ variant_label: 'Custom Design' });
        const { job_id } = await submitSimulation(payload);
        setLoadingMsg(engineMsg);
        const result = await pollUntilDone(job_id, false, progressTick, timeoutMs);
        if (result.status === 'failed') throw new Error(result.error_message || 'Simulation failed.');
        navigate('/results', { state: { result, input: formData, isCompare: false } });
      }
    } catch (err) {
      setLoading(false);
      if (!cancelled) {
        const detail = err?.response?.data?.detail;
        let msg = err?.message || 'Unknown error';
        if (Array.isArray(detail)) msg = detail.map(d => `${(d.loc||[]).slice(1).join('.')}: ${d.msg}`).join('\n');
        else if (typeof detail === 'string') msg = detail;
        alert(`Simulation could not start:\n\n${msg}`);
      }
    } finally { setLoading(false); }
  };

  if (!isStarted) {
    return (
      <div style={{maxWidth:1100, margin:'0 auto'}}>
        {loading && <LoadingSpinner message={loadingMsg} onCancel={() => { setCancelled(true); setLoading(false); }} />}

        {/* Hero Strip */}
        <div className="hero-strip cad-grid-dark">
          <div className="hero-num">01</div>
          <div style={{position:'relative', zIndex:1}}>
            <div className="section-eyebrow">THERMA·LADAKH Simulation Platform</div>
            <h1 style={{fontFamily:'var(--font-display)', fontSize:'clamp(28px, 4vw, 52px)', fontWeight:800, color:'var(--text-1)', letterSpacing:'-0.03em', lineHeight:1.05, marginBottom:16}}>
              High-Altitude Passive<br/>Shelter Thermal Architecture
            </h1>
            <p style={{fontFamily:'var(--font-body)', fontSize:14, color:'var(--text-2)', maxWidth:580, lineHeight:1.7, marginBottom:32}}>
              Computational modeling and transient numerical analysis for extreme cold climates (−20°C). Evaluate passive solar gain, building envelope thermal inertia, and 24-hour interior temperature profiles before construction.
            </p>
            <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
              <button type="button" onClick={() => handleStart(null, 0)} className="btn-primary" style={{padding:'12px 28px', fontSize:12}}>
                Initialize Shelter Model
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
              <button type="button" onClick={() => handleStart(null, 3)}
                style={{fontFamily:'var(--font-mono)', fontSize:11, letterSpacing:'0.08em', textTransform:'uppercase', padding:'12px 24px', background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text-2)', cursor:'pointer', transition:'all 0.15s'}}>
                Open 36-Design Optimizer
              </button>
            </div>
          </div>
        </div>

        {/* Presets */}
        <div style={{marginBottom:56}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24, paddingBottom:16, borderBottom:'1px solid var(--border)'}}>
            <div>
              <div className="section-eyebrow">Pre-Engineered Baselines</div>
              <p style={{fontFamily:'var(--font-body)', fontSize:13, color:'var(--text-2)'}}>Select a validated regional template to pre-load parameters</p>
            </div>
            <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-3)'}}>3 TEMPLATES</span>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:2}}>
            {PRESETS.map(preset => (
              <div key={preset.id} className="preset-card">
                <span className="preset-badge">{preset.badge}</span>
                <h3 className="preset-name">{preset.name}</h3>
                <p className="preset-desc">{preset.desc}</p>
                <div className="preset-meta">
                  <div><span style={{color:'var(--text-3)'}}>Dim:</span> {preset.dimensions}</div>
                  <div><span style={{color:'var(--text-3)'}}>Spec:</span> {preset.envelope}</div>
                </div>
                <button type="button" onClick={() => handleStart(preset, 0)}
                  style={{marginTop:12, fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', padding:'8px 0', background:'transparent', border:'none', color:'var(--ice)', cursor:'pointer', display:'flex', alignItems:'center', gap:8}}>
                  Load & Configure
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Grid */}
        <div className="stat-grid" style={{gridTemplateColumns:'repeat(3, 1fr)'}}>
          {[
            {label:'ANSYS MAPDL SOLID70', desc:'3D parameterized solid mesh with transient thermal conduction and nodal temperature gradients', color:'var(--ice)'},
            {label:'Diurnal Solar Ray-Tracing', desc:'Azimuth-dependent direct beam and sky-diffuse irradiation flux into high-altitude south glazing', color:'#FF9A3C'},
            {label:'36-Design Parameter Sweep', desc:'Automated combinatorial physics optimizer testing candidate assemblies to maximize comfort hours', color:'var(--lime)'},
          ].map(f => (
            <div key={f.label} className="stat-tile">
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                <span style={{width:4, height:4, borderRadius:'50%', background:f.color, display:'inline-block'}} />
                <span style={{fontFamily:'var(--font-mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.12em', color:f.color}}>{f.label}</span>
              </div>
              <p style={{fontFamily:'var(--font-body)', fontSize:12, color:'var(--text-2)', lineHeight:1.6}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{maxWidth:800, margin:'0 auto'}}>
      {loading && <LoadingSpinner message={loadingMsg} onCancel={() => { setCancelled(true); setLoading(false); }} />}

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
        <button type="button" onClick={() => setIsStarted(false)}
          style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:8}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Hub
        </button>
        <span style={{fontFamily:'var(--font-mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-3)'}}>Model Configuration Wizard</span>
      </div>

      {/* Step Track */}
      <div className="step-track">
        {STEPS.map((s, i) => (
          <div key={s} className={`step-item${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
            <div className="step-num">
              {i < step ? '✓' : i + 1}
            </div>
            <div>
              <div className="step-label">{s}</div>
              <span className="step-sublabel">{['Dimensions & Form', 'Thermal Envelope', 'Solar & Climate', 'Launch Simulation'][i]}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Form Card */}
      <div className="card" style={{marginBottom:24}}>
        {step === 0 && <GeometryStep data={formData} onChange={onChange} errors={errors} />}
        {step === 1 && <MaterialsStep data={formData} onChange={onChange} materials={materials} errors={errors} />}
        {step === 2 && <OrientationStep data={formData} onChange={onChange} climateProfiles={climateProfiles} errors={errors} compareMode={compareMode} onCompareModeChange={setCompareMode} />}
        {step === 3 && <ReviewStep data={formData} materials={materials} climateProfiles={climateProfiles} compareMode={compareMode} variants={variants} onAddVariant={addVariant} onRemoveVariant={removeVariant} onVariantChange={updateVariant} />}

        {/* Engine Selector on step 3 */}
        {step === 3 && (
          <div style={{marginTop:28, borderTop:'1px solid var(--border)', paddingTop:24}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div className="section-eyebrow" style={{marginBottom:0}}>Computation Engine Pipeline</div>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>ISO 13790 Compliant</span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:2}}>
              {[
                {id:'fdm', name:'Python FDM Solver', desc:'Implicit 1D multi-layer finite difference. Fast iteration in seconds.', color:'var(--ice)'},
                {id:'ansys', name:'ANSYS MAPDL + FEA', desc:'3D solid parametric APDL geometry + transient thermal FEA (SOLID70 elements).', color:'#FF9A3C'},
              ].map(e => (
                <div key={e.id}
                  onClick={() => setEngine(e.id)}
                  style={{
                    border: engine===e.id ? `1px solid ${e.color}` : '1px solid var(--border)',
                    background: engine===e.id ? 'rgba(0,207,255,0.05)' : 'var(--bg-2)',
                    padding:'18px 20px', cursor:'pointer', transition:'all 0.2s',
                  }}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                    <span style={{fontFamily:'var(--font-display)', fontSize:14, fontWeight:700, color: engine===e.id ? 'var(--text-1)' : 'var(--text-2)'}}>{e.name}</span>
                    <span style={{width:8, height:8, borderRadius:'50%', background: engine===e.id ? e.color : 'var(--border-2)', display:'inline-block'}} />
                  </div>
                  <p style={{fontFamily:'var(--font-body)', fontSize:12, color:'var(--text-3)', lineHeight:1.5}}>{e.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:32, paddingTop:24, borderTop:'1px solid var(--border)'}}>
          <button type="button" onClick={prev} disabled={step === 0}
            style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', padding:'10px 20px', background:'transparent', border:'1px solid var(--border)', color:'var(--text-3)', cursor: step===0 ? 'not-allowed' : 'pointer', opacity: step===0 ? 0.4 : 1}}>
            ← Previous
          </button>

          {step < 3 ? (
            <button type="button" onClick={next}
              style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', padding:'10px 24px', background:'var(--ice)', color:'#000', fontWeight:700, border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:8}}>
              Next Step →
            </button>
          ) : (
            <button type="button" onClick={handleSubmit}
              style={{fontFamily:'var(--font-mono)', fontSize:11, letterSpacing:'0.08em', textTransform:'uppercase', padding:'12px 28px', background:'var(--ice)', color:'#000', fontWeight:700, border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:10}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              {compareMode && variants.length > 0 ? 'Execute Comparison' : 'Execute Simulation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
