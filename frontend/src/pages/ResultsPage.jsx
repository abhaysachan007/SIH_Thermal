import { useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';

import TemperatureChart from '../components/TemperatureChart';
import SolarGainChart from '../components/SolarGainChart';
import HeatFlowChart from '../components/HeatFlowChart';
import ComparisonTable from '../components/ComparisonTable';
import RecommendationCard from '../components/RecommendationCard';
import Shelter3DViewer from '../components/Shelter3DViewer';

const TABS_BASE = ['3D Model & ANSYS', 'Temperature', 'Solar Gain', 'Heat Flow', 'Recommendation'];
const TABS_COMPARE = ['3D Model & ANSYS', 'Temperature', 'Solar Gain', 'Heat Flow', 'Comparison', 'Recommendation'];

const DIR_LABELS = {
  0: 'North (0°)', 45: 'NE (45°)', 90: 'East (90°)', 135: 'SE (135°)',
  180: 'South Direct (180°)', 225: 'SW (225°)', 270: 'West (270°)', 315: 'NW (315°)',
};

function extract(r) {
  if (!r) return {};
  const data = r.result || r;
  const inSeries = data.inside_temperature_series || data.inside_temperature || [];
  const ambSeries = data.ambient_temperature_series || data.ambient_temperature || [];
  const inTemps = inSeries.map(p => p.value).filter(v => v != null);
  const ambTemps = ambSeries.map(p => p.value).filter(v => v != null);
  const minIn = data.min_inside_temp_C ?? (inTemps.length ? Math.min(...inTemps) : null);
  const peakIn = data.peak_inside_temp_C ?? (inTemps.length ? Math.max(...inTemps) : null);
  const avgIn = data.avg_inside_temp_C ?? (inTemps.length ? inTemps.reduce((a,b)=>a+b,0)/inTemps.length : null);
  const minAmb = data.min_ambient_temp_C ?? (ambTemps.length ? Math.min(...ambTemps) : -20.0);
  const maxAmb = data.max_ambient_temp_C ?? (ambTemps.length ? Math.max(...ambTemps) : 3.5);
  const avgAmb = data.avg_ambient_temp_C ?? (ambTemps.length ? ambTemps.reduce((a,b)=>a+b,0)/ambTemps.length : -10.0);
  const inDrop = data.inside_temp_drop_C ?? (peakIn!=null&&minIn!=null ? peakIn-minIn : null);
  const outDrop = data.outside_temp_drop_C ?? (maxAmb!=null&&minAmb!=null ? maxAmb-minAmb : null);
  const diffs = inTemps.map((val,idx)=>ambTemps[idx]!=null?val-ambTemps[idx]:null).filter(v=>v!=null);
  const maxDiff = data.max_temp_diff_C ?? (diffs.length ? Math.max(...diffs) : (peakIn!=null&&minAmb!=null ? peakIn-minAmb : null));
  const avgDiff = data.avg_temp_diff_C ?? (diffs.length ? diffs.reduce((a,b)=>a+b,0)/diffs.length : (avgIn!=null&&avgAmb!=null ? avgIn-avgAmb : null));
  const minDiff = data.min_temp_diff_C ?? (diffs.length ? Math.min(...diffs) : null);
  const damping = data.thermal_damping_ratio_pct ?? (inDrop!=null&&outDrop!=null&&outDrop>0.1 ? Math.max(0,Math.min(100,(1-inDrop/outDrop)*100)) : 70.0);
  return {
    insideTemp: inSeries, ambientTemp: ambSeries,
    solarGain: data.solar_gain_series || [],
    totalKwh: data.total_solar_gain_kwh ?? data.total_solar_kwh ?? null,
    heatFlow: data.heat_flow_series || [],
    minTemp: minIn, peakTemp: peakIn, avgTemp: avgIn,
    minAmb, maxAmb, avgAmb,
    insideDrop: inDrop, outsideDrop: outDrop,
    maxDiff, minDiff, avgDiff, dampingRatio: damping,
    efficiencyScore: data.efficiency_score,
    comfortHours: data.comfort_hours,
    totalLossKwh: data.total_heat_loss_kwh,
    variantLabel: data.variant_label || 'Design',
  };
}

function TabBar({ tabs, active, onSelect }) {
  return (
    <div style={{display:'flex', borderBottom:'1px solid var(--border)', marginBottom:24, overflowX:'auto', gap:0}}>
      {tabs.map(tab => (
        <button key={tab} onClick={() => onSelect(tab)}
          style={{
            fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
            padding:'10px 16px', whiteSpace:'nowrap', border:'none', cursor:'pointer',
            borderBottom: active===tab ? '2px solid var(--ice)' : '2px solid transparent',
            background: 'transparent',
            color: active===tab ? 'var(--ice)' : 'var(--text-3)',
            transition: 'all 0.15s',
          }}>
          {tab}
        </button>
      ))}
    </div>
  );
}

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state;

  useEffect(() => { if (!state) navigate('/'); }, [state, navigate]);
  const [activeTab, setActiveTab] = useState('3D Model & ANSYS');
  const [active3DVariant, setActive3DVariant] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!state) return null;

  const { result, compareResult, input, isCompare } = state;
  const tabs = isCompare ? TABS_COMPARE : TABS_BASE;
  const single = extract(result);
  const compareList = compareResult?.results || [];
  const bestLabel = compareResult?.best_variant_label || 'Optimal Design';
  const optimalVariant = isCompare && compareList.length > 0
    ? (compareList.find(v => v.variant_label===bestLabel||v.label===bestLabel) || compareList[0])
    : null;
  const recText = compareResult?.recommendation_text || result?.recommendation_text ||
    `Simulation completed. Peak inside temperature: ${single.peakTemp!=null?`${single.peakTemp.toFixed(1)}°C`:'—'}, minimum retention: ${single.minTemp!=null?`${single.minTemp.toFixed(1)}°C`:'—'}.`;
  const recReasons = compareResult?.recommendation_reasons || result?.recommendation_reasons || [
    `Thermal efficiency score: ${single.efficiencyScore??'—'}/100`,
    `Overnight minimum interior temperature: ${single.minTemp!=null?`${single.minTemp.toFixed(1)}°C`:'—'}`,
    `Total solar radiation captured: ${single.totalKwh!=null?`${single.totalKwh.toFixed(2)} kWh`:'—'}`,
    `Total envelope transmission loss: ${single.totalLossKwh!=null?`${single.totalLossKwh.toFixed(2)} kWh`:'—'}`,
    `Comfort hours above baseline: ${single.comfortHours??'—'} hours/day`,
  ];
  const activePrimary = isCompare && optimalVariant ? extract(optimalVariant) : single;
  const variantSeries = isCompare ? compareList.map((v,i) => ({ label: v.variant_label||`Variant ${i+1}`, data: extract(v).insideTemp })) : [];
  const orientDeg = input?.orientation_deg ?? input?.orientation ?? 180;
  const dirLabel = DIR_LABELS[orientDeg] || `${orientDeg}°`;
  const climateName = input?.climate_profile_id || 'Ladakh Winter';

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const marginX = 14;
      let y = 18;
      const fmt = (v, digits=1, unit='') => (v==null||Number.isNaN(v)) ? '—' : `${Number(v).toFixed(digits)}${unit}`;
      const ensureSpace = needed => { if (y+needed>285) { pdf.addPage(); y=18; } };
      const sectionHeader = text => {
        ensureSpace(12); pdf.setFontSize(12); pdf.setTextColor(2,132,199); pdf.text(text,marginX,y);
        y+=2; pdf.setDrawColor(203,213,225); pdf.line(marginX,y,pageW-marginX,y); y+=6;
      };
      const row = (label, value) => {
        ensureSpace(7); pdf.setFontSize(10); pdf.setTextColor(71,85,105); pdf.text(String(label),marginX,y);
        pdf.setTextColor(15,23,42); pdf.text(String(value),pageW-marginX,y,{align:'right'}); y+=6;
      };
      pdf.setFontSize(17); pdf.setTextColor(15,23,42);
      pdf.text('THERMA-LADAKH — Thermal Simulation Report', pageW/2, y, {align:'center'}); y+=8;
      pdf.setFontSize(9); pdf.setTextColor(100,116,139);
      pdf.text(`Climate: ${climateName}   |   Azimuth: ${dirLabel}   |   Duration: ${input?.duration_hours||24}h`, pageW/2, y, {align:'center'}); y+=5;
      pdf.text(`Generated: ${new Date().toLocaleString()}`, pageW/2, y, {align:'center'}); y+=12;
      const engineLabel = (result?.engine_used||compareList?.[0]?.engine_used||'python_fdm').includes('ansys') ? 'ANSYS MAPDL SOLID70 Transient FEA' : 'Python FDM (1D transient)';
      sectionHeader('Design Configuration');
      row('Solver engine', engineLabel);
      row('Dimensions (L x W x H)', `${input?.length_m??'—'} x ${input?.width_m??'—'} x ${input?.height_m??'—'} m`);
      row('Wall material', input?.wall_material_id??'—');
      row('Wall thickness', fmt(input?.wall_thickness_m,2,' m'));
      row('Orientation', dirLabel);
      row('Outside ambient range', `${fmt(activePrimary.minAmb)}°C to ${fmt(activePrimary.maxAmb)}°C`); y+=4;
      sectionHeader('Thermal Performance');
      row('Min interior temperature', fmt(activePrimary.minTemp,1,' °C'));
      row('Peak interior temperature', fmt(activePrimary.peakTemp,1,' °C'));
      row('Max thermal lift', fmt(activePrimary.maxDiff,1,' °C'));
      row('Thermal damping ratio', fmt(activePrimary.dampingRatio,0,' %'));
      row('Efficiency index', `${activePrimary.efficiencyScore??'—'} / 100`); y+=4;
      sectionHeader('Energy Balance');
      row('Total solar gain', fmt(activePrimary.totalKwh,2,' kWh'));
      row('Total heat loss', fmt(activePrimary.totalLossKwh,2,' kWh')); y+=4;
      sectionHeader('Engineering Recommendation');
      pdf.setFontSize(10); pdf.setTextColor(30,41,59);
      pdf.splitTextToSize(recText,pageW-2*marginX).forEach(line => { ensureSpace(6); pdf.text(line,marginX,y); y+=5; });
      recReasons.forEach(r => {
        pdf.splitTextToSize(`•  ${r}`,pageW-2*marginX).forEach(line => { ensureSpace(6); pdf.text(line,marginX,y); y+=5; });
      });
      pdf.save('THERMA_LADAKH_Simulation_Report.pdf');
    } catch (e) {
      console.error('PDF export failed:', e);
      alert(`PDF export failed: ${e?.message||e}`);
    } finally { setIsExporting(false); }
  };

  const eng = result?.engine_used || compareList?.[0]?.engine_used;
  let engineLabel = 'Python FDM — 1D Transient';
  if (eng === 'ansys_thermal_fea') engineLabel = 'ANSYS MAPDL SOLID70 Transient FEA';
  else if (eng?.includes('ansys')) engineLabel = 'ANSYS MAPDL Solver';

  return (
    <div style={{maxWidth:1100, margin:'0 auto'}}>
      {/* Results Header */}
      <div className="hero-strip" style={{paddingBottom:32, marginBottom:40}}>
        <div style={{position:'relative', zIndex:1}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:16}}>
            <div>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:12}}>
                <span style={{width:6, height:6, borderRadius:'50%', background:'var(--lime)', display:'inline-block', animation:'pulse-dot 2s infinite'}} />
                <span style={{fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--lime)'}}>Simulation Complete</span>
              </div>
              <h1 style={{fontFamily:'var(--font-display)', fontSize:'clamp(22px, 3vw, 40px)', fontWeight:800, color:'var(--text-1)', letterSpacing:'-0.03em', marginBottom:12}}>
                Thermal Performance Telemetry
              </h1>
              <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
                {[
                  `Climate: ${climateName}`,
                  `Outside: ${input?.min_ambient_temp_C!=null?input.min_ambient_temp_C.toFixed(1):'-19.2'}°C to ${input?.max_ambient_temp_C!=null?input.max_ambient_temp_C.toFixed(1):'3.5'}°C`,
                  `Peak Solar: ${input?.peak_solar_radiation_W_m2!=null?input.peak_solar_radiation_W_m2.toFixed(0):'940'} W/m²`,
                  `Azimuth: ${dirLabel}`,
                  `Duration: ${input?.duration_hours||24}h`,
                  isCompare ? `${compareList.length} Variants` : null,
                ].filter(Boolean).map(c => (
                  <span key={c} style={{fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'0.08em', color:'var(--text-3)', border:'1px solid var(--border)', padding:'3px 10px', background:'var(--surface)'}}>
                    {c}
                  </span>
                ))}
                {eng && <span className="engine-tag">{engineLabel}</span>}
              </div>
            </div>
            <div style={{display:'flex', gap:8, flexShrink:0}}>
              <button onClick={() => navigate('/')}
                style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', padding:'10px 18px', background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text-2)', cursor:'pointer'}}>
                ← Edit Parameters
              </button>
              <button onClick={handleExportPDF} disabled={isExporting}
                className="btn-primary" style={{padding:'10px 20px', fontSize:10}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                {isExporting ? 'Generating…' : 'Export PDF'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ANSYS Fallback Warning */}
      {result?.ansys_fallback_reason && (
        <div style={{border:'1px solid rgba(255,79,23,0.4)', background:'rgba(255,79,23,0.06)', padding:'14px 20px', marginBottom:16, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fire)'}}>
          <span style={{fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', fontSize:10}}>⚠ ANSYS solve failed — showing Python FDM result</span>
          <p style={{marginTop:6, color:'#FF9A3C', fontSize:10}}>{result.ansys_fallback_reason}</p>
        </div>
      )}

      {/* ANSYS FEA Telemetry */}
      {(result?.ansys_fea_details || result?.ansys_thermal_solved) && (
        <div style={{border:'1px solid rgba(0,207,255,0.2)', background:'rgba(0,207,255,0.04)', padding:'16px 20px', marginBottom:16}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border)', paddingBottom:10, marginBottom:12}}>
            <span style={{fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ice)', fontWeight:700}}>ANSYS MAPDL FEA — Transient Solver Output</span>
            <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>SOLID70 3D Thermal Brick</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:16}}>
            {[
              {label:'Formulation', val: result.ansys_fea_details?.solver || 'MAPDL SOLID70'},
              {label:'Mesh Nodes', val: result.ansys_fea_details?.total_nodes?.toLocaleString() || '—'},
              {label:'Peak Nodal Temp', val: result.ansys_fea_details?.peak_temp_any_C?.toFixed(1)+'°C' || '—', color:'#FF9A3C'},
              {label:'Min Nodal Temp', val: result.ansys_fea_details?.min_temp_any_C?.toFixed(1)+'°C' || '—', color:'var(--ice)'},
            ].map(d => (
              <div key={d.label}>
                <span style={{fontFamily:'var(--font-mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-3)', display:'block', marginBottom:4}}>{d.label}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color: d.color||'var(--text-1)'}}>{d.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Stat Grid */}
      <div className="stat-grid" style={{marginBottom:2}}>
        {[
          {label:'Min Night Temp', val: activePrimary.minTemp!=null?`${activePrimary.minTemp.toFixed(1)}°C`:'—', sub:'Overnight cold retention', class:'ice'},
          {label:'Peak Day Temp', val: activePrimary.peakTemp!=null?`${activePrimary.peakTemp.toFixed(1)}°C`:'—', sub:'Daytime solar thermal peak', class:'fire'},
          {label:'Solar Captured', val: activePrimary.totalKwh!=null?`${activePrimary.totalKwh.toFixed(2)}`:'—', sub:'kWh daily solar yield', class:''},
          {label:'Efficiency Index', val: activePrimary.efficiencyScore!=null?`${activePrimary.efficiencyScore.toFixed(0)}/100`:'—', sub:'Comfort & heat retention', class:'lime'},
        ].map(kpi => (
          <div key={kpi.label} className="stat-tile">
            <div className="stat-label">{kpi.label}</div>
            <div className={`stat-value ${kpi.class}`}>{kpi.val}</div>
            <div className="stat-unit">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Thermal Difference Banner */}
      <div className="stat-grid" style={{marginBottom:16}}>
        {[
          {label:'Max Thermal Lift ΔT', val: activePrimary.maxDiff!=null?`${activePrimary.maxDiff>=0?'+':''}${activePrimary.maxDiff.toFixed(1)}°C`:'—', sub:'Warmer than outside', class:'lime'},
          {label:'Average ΔT Lift', val: activePrimary.avgDiff!=null?`${activePrimary.avgDiff>=0?'+':''}${activePrimary.avgDiff.toFixed(1)}°C`:'—', sub:'24h mean temperature boost', class:'ice'},
          {label:'Diurnal Temp Drop', val: activePrimary.insideDrop!=null?`${activePrimary.insideDrop.toFixed(1)}°C`:'—', sub:`vs outside ${activePrimary.outsideDrop!=null?activePrimary.outsideDrop.toFixed(1):'—'}°C`, class:''},
          {label:'Thermal Damping', val: activePrimary.dampingRatio!=null?`${activePrimary.dampingRatio.toFixed(0)}%`:'—', sub:'Outside fluctuation arrested', class:''},
        ].map(kpi => (
          <div key={kpi.label} className="stat-tile">
            <div className="stat-label">{kpi.label}</div>
            <div className={`stat-value ${kpi.class}`} style={{fontSize:24}}>{kpi.val}</div>
            <div className="stat-unit">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Cost & Feasibility */}
      {(() => {
        const ce = result?.cost_estimate || optimalVariant?.cost_estimate;
        if (!ce) return null;
        const inr = v => v==null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`;
        return (
          <div className="card" style={{marginBottom:16}}>
            <div className="section-eyebrow">Cost & Real-World Feasibility</div>
            <div className="stat-grid" style={{marginTop:16}}>
              {[
                {label:'Estimated Build Cost', val:inr(ce.material_cost_inr), sub:'Materials + glazing'},
                {label:'Annual Heating Cost', val:inr(ce.annual_heating_cost_inr), sub:`${ce.annual_heating_kwh?.toLocaleString('en-IN')} kWh/yr`, class:'fire'},
                {label:'Heating Cost Saved', val:`${ce.heating_cost_savings_pct}%`, sub:'vs uninsulated baseline', class:'lime'},
                {label:'Annual Savings', val:inr(ce.annual_savings_inr), sub:'per year vs baseline', class:'lime'},
              ].map(kpi => (
                <div key={kpi.label} className="stat-tile">
                  <div className="stat-label">{kpi.label}</div>
                  <div className={`stat-value ${kpi.class||''}`} style={{fontSize:22}}>{kpi.val}</div>
                  <div className="stat-unit">{kpi.sub}</div>
                </div>
              ))}
            </div>
            {ce.assumptions && (
              <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-3)', marginTop:14, paddingTop:14, borderTop:'1px solid var(--border)'}}>
                {ce.assumptions.winter_heating_days} heating days/yr · {ce.assumptions.comfort_setpoint_C}°C setpoint · Baseline: {ce.assumptions.baseline}
              </div>
            )}
          </div>
        );
      })()}

      {/* Analytics Tabs */}
      <div className="card">
        <TabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        {activeTab === '3D Model & ANSYS' && (() => {
          const currentVariant = active3DVariant || optimalVariant;
          const currentInput = currentVariant?.input_config || currentVariant?.input || input;
          const currentResult = currentVariant || result || (compareList.length > 0 ? compareList[0] : null);
          const isOptimalSelected = !active3DVariant || (optimalVariant && active3DVariant.variant_label === optimalVariant.variant_label);
          return (
            <div>
              <div style={{background:'var(--bg-2)', border:'1px solid var(--border)', padding:'10px 16px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <span style={{width:6, height:6, borderRadius:'50%', background:'var(--lime)', display:'inline-block', animation:'pulse-dot 2s infinite'}} />
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-2)'}}>
                    3D Envelope: <strong style={{color:'var(--ice)'}}>{currentVariant?.variant_label||currentVariant?.label||input?.variant_label||'Base Design'}</strong>
                  </span>
                  {isCompare && isOptimalSelected && (
                    <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--lime)', border:'1px solid rgba(0,229,155,0.3)', padding:'2px 8px'}}>OPTIMAL</span>
                  )}
                </div>
                {active3DVariant && optimalVariant && active3DVariant.variant_label !== optimalVariant.variant_label && (
                  <button onClick={() => setActive3DVariant(null)}
                    style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--ice)', background:'none', border:'none', cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.08em'}}>
                    ↺ Reset to Optimal
                  </button>
                )}
              </div>
              <Shelter3DViewer shelterData={currentInput} ansysData={currentResult} height="480px" />
            </div>
          );
        })()}

        {activeTab === 'Temperature' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div className="section-eyebrow" style={{marginBottom:0}}>24-Hour Diurnal Temperature Profile</div>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>Threshold: +15.0°C</span>
            </div>
            <TemperatureChart insideSeriesData={activePrimary.insideTemp||[]} ambientSeriesData={activePrimary.ambientTemp||[]} variantSeries={variantSeries} />
          </div>
        )}

        {activeTab === 'Solar Gain' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div className="section-eyebrow" style={{marginBottom:0}}>Direct & Diffuse Solar Radiation Gain (W)</div>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>South Facade Capture</span>
            </div>
            <SolarGainChart solarGainSeries={activePrimary.solarGain||[]} totalKwh={activePrimary.totalKwh} />
          </div>
        )}

        {activeTab === 'Heat Flow' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div className="section-eyebrow" style={{marginBottom:0}}>Envelope Component Heat Flux Matrix (W)</div>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>Walls · Roof · Plinth · Fenestration</span>
            </div>
            <HeatFlowChart heatFlowSeries={activePrimary.heatFlow||[]} />
          </div>
        )}

        {activeTab === 'Comparison' && isCompare && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div className="section-eyebrow" style={{marginBottom:0}}>Comparative Design Variants Matrix</div>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>{compareList.length} Configurations</span>
            </div>
            <ComparisonTable
              results={compareList.map(v => ({
                ...v, label: v.variant_label||'Design',
                avg_inside_temp: v.avg_inside_temp_C, min_temp: v.min_inside_temp_C,
                total_solar_kwh: v.total_solar_gain_kwh, total_heat_loss: v.total_heat_loss_kwh,
                efficiency_score: v.efficiency_score, comfort_hours: v.comfort_hours,
                input_config: v.input_config || input,
              }))}
              bestVariantLabel={bestLabel}
              activeVariantLabel={active3DVariant?.variant_label||active3DVariant?.label||(compareList[0]?.variant_label||'Base Design')}
              onSelectVariant={v => { setActive3DVariant(v); setActiveTab('3D Model & ANSYS'); }}
            />
          </div>
        )}

        {activeTab === 'Recommendation' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div className="section-eyebrow" style={{marginBottom:0}}>Passive Thermal Architecture Recommendation</div>
              <span style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-3)'}}>Engineering Insights</span>
            </div>
            <RecommendationCard
              recommendationText={recText}
              reasons={recReasons}
              bestLabel={isCompare ? bestLabel : (input?.variant_label||'Base Design')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
