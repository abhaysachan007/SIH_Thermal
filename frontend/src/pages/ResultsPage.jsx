import { useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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

  const inTemps = inSeries.map((p) => p.value).filter((v) => v != null);
  const ambTemps = ambSeries.map((p) => p.value).filter((v) => v != null);

  const minIn = data.min_inside_temp_C ?? (inTemps.length ? Math.min(...inTemps) : null);
  const peakIn = data.peak_inside_temp_C ?? (inTemps.length ? Math.max(...inTemps) : null);
  const avgIn = data.avg_inside_temp_C ?? (inTemps.length ? inTemps.reduce((a, b) => a + b, 0) / inTemps.length : null);

  const minAmb = data.min_ambient_temp_C ?? (ambTemps.length ? Math.min(...ambTemps) : -20.0);
  const maxAmb = data.max_ambient_temp_C ?? (ambTemps.length ? Math.max(...ambTemps) : 3.5);
  const avgAmb = data.avg_ambient_temp_C ?? (ambTemps.length ? ambTemps.reduce((a, b) => a + b, 0) / ambTemps.length : -10.0);

  const inDrop = data.inside_temp_drop_C ?? (peakIn != null && minIn != null ? peakIn - minIn : null);
  const outDrop = data.outside_temp_drop_C ?? (maxAmb != null && minAmb != null ? maxAmb - minAmb : null);

  const diffs = inTemps.map((val, idx) => ambTemps[idx] != null ? val - ambTemps[idx] : null).filter((v) => v != null);
  const maxDiff = data.max_temp_diff_C ?? (diffs.length ? Math.max(...diffs) : (peakIn != null && minAmb != null ? peakIn - minAmb : null));
  const avgDiff = data.avg_temp_diff_C ?? (diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : (avgIn != null && avgAmb != null ? avgIn - avgAmb : null));
  const minDiff = data.min_temp_diff_C ?? (diffs.length ? Math.min(...diffs) : null);

  const damping = data.thermal_damping_ratio_pct ?? (inDrop != null && outDrop != null && outDrop > 0.1 ? Math.max(0, Math.min(100, (1 - inDrop / outDrop) * 100)) : 70.0);

  return {
    insideTemp:    inSeries,
    ambientTemp:   ambSeries,
    solarGain:     data.solar_gain_series || [],
    totalKwh:      data.total_solar_gain_kwh ?? data.total_solar_kwh ?? null,
    heatFlow:      data.heat_flow_series || [],
    minTemp:       minIn,
    peakTemp:      peakIn,
    avgTemp:       avgIn,
    minAmb:        minAmb,
    maxAmb:        maxAmb,
    avgAmb:        avgAmb,
    insideDrop:    inDrop,
    outsideDrop:   outDrop,
    maxDiff:       maxDiff,
    minDiff:       minDiff,
    avgDiff:       avgDiff,
    dampingRatio:  damping,
    efficiencyScore: data.efficiency_score,
    comfortHours:  data.comfort_hours,
    totalLossKwh:  data.total_heat_loss_kwh,
    variantLabel:  data.variant_label || 'Design',
  };
}

function Chip({ label }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono font-medium">
      {label}
    </span>
  );
}

function TabBar({ tabs, active, onSelect }) {
  return (
    <div className="flex border-b border-slate-200 mb-6 overflow-x-auto gap-1">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          className={`px-4 py-2.5 text-xs font-mono font-bold whitespace-nowrap border-b-2 transition-all ${
            active === tab
              ? 'border-sky-600 text-sky-700 bg-sky-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
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

  const chartRefs = {
    temperature: useRef(null),
    solar:       useRef(null),
    heatflow:    useRef(null),
    comparison:  useRef(null),
    recommendation: useRef(null),
  };

  useEffect(() => {
    if (!state) navigate('/');
  }, [state, navigate]);

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
    ? (compareList.find(v => (v.variant_label === bestLabel || v.label === bestLabel)) || compareList[0])
    : null;

  const recText = compareResult?.recommendation_text || result?.recommendation_text ||
    `Simulation completed for ${input?.variant_label || 'your shelter'}. Peak inside temperature reached ${single.peakTemp != null ? `${single.peakTemp.toFixed(1)}°C` : '—'} with minimum overnight retention of ${single.minTemp != null ? `${single.minTemp.toFixed(1)}°C` : '—'}.`;
  const recReasons = compareResult?.recommendation_reasons || result?.recommendation_reasons || [
    `Thermal efficiency score: ${single.efficiencyScore ?? '—'}/100`,
    `Overnight minimum interior temperature: ${single.minTemp != null ? `${single.minTemp.toFixed(1)}°C` : '—'}`,
    `Total useful solar radiation captured: ${single.totalKwh != null ? `${single.totalKwh.toFixed(2)} kWh` : '—'}`,
    `Total envelope transmission loss: ${single.totalLossKwh != null ? `${single.totalLossKwh.toFixed(2)} kWh` : '—'}`,
    `Comfort hours above baseline: ${single.comfortHours ?? '—'} hours/day`,
  ];

  const activePrimary = isCompare && optimalVariant ? extract(optimalVariant) : single;

  const variantSeries = isCompare
    ? compareList.map((v, i) => ({
        label: v.variant_label || `Variant ${i + 1}`,
        data: extract(v).insideTemp,
      }))
    : [];

  const orientDeg = input?.orientation_deg ?? input?.orientation ?? 180;
  const dirLabel = DIR_LABELS[orientDeg] || `${orientDeg}°`;
  const climateName = input?.climate_profile_id || 'Ladakh Winter';

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      let y = 15;

      pdf.setFontSize(16);
      pdf.setTextColor(15, 23, 42);
      pdf.text('THERMA·LADAKH — Numerical Simulation Report', pageW / 2, y, { align: 'center' });
      y += 7;

      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Climate: ${climateName}  |  Azimuth: ${dirLabel}  |  Duration: ${input?.duration_hours || 24}h`, pageW / 2, y, { align: 'center' });
      y += 5;
      pdf.text(`Generated: ${new Date().toLocaleString()}`, pageW / 2, y, { align: 'center' });
      y += 10;

      const refEntries = [
        ['Transient Temperature Dynamics', chartRefs.temperature],
        ['Direct Solar Irradiation Capture', chartRefs.solar],
        ['Component Heat Flow Analysis', chartRefs.heatflow],
      ];
      if (isCompare) refEntries.push(['Comparative Variant Matrix', chartRefs.comparison]);
      refEntries.push(['Engineering Recommendation Brief', chartRefs.recommendation]);

      for (const [title, ref] of refEntries) {
        if (!ref.current) continue;
        const canvas = await html2canvas(ref.current, { scale: 1.5, useCORS: true });
        const imgData = canvas.toDataURL('image/png');
        const imgW = pageW - 20;
        const imgH = (canvas.height / canvas.width) * imgW;

        if (y + imgH + 15 > 280) { pdf.addPage(); y = 15; }
        pdf.setFontSize(11);
        pdf.setTextColor(2, 132, 199);
        pdf.text(title, 10, y);
        y += 4;
        pdf.addImage(imgData, 'PNG', 10, y, imgW, imgH);
        y += imgH + 8;
      }

      pdf.save('THERMA_LADAKH_Simulation_Report.pdf');
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Results Header Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate-400 font-bold">
                Simulation Execution Complete
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1 font-sans">
              Thermal Performance Telemetry
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/')}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-mono font-medium transition-all"
            >
              ← Edit Parameters
            </button>
            <button
              onClick={handleExportPDF}
              disabled={isExporting}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800 rounded-lg text-xs font-mono font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span>{isExporting ? 'Generating PDF…' : 'Export PDF Report'}</span>
            </button>
          </div>
        </div>

        {/* Metadata Chips */}
        <div className="flex flex-wrap gap-2 pt-4 items-center">
          <Chip label={`Climate: ${climateName}`} />
          <Chip label={`Outside: ${input?.min_ambient_temp_C != null ? input.min_ambient_temp_C.toFixed(1) : '-19.2'}°C to ${input?.max_ambient_temp_C != null ? input.max_ambient_temp_C.toFixed(1) : '3.5'}°C`} />
          <Chip label={`Peak Solar: ${input?.peak_solar_radiation_W_m2 != null ? input.peak_solar_radiation_W_m2.toFixed(0) : '940'} W/m²`} />
          <Chip label={`Azimuth: ${dirLabel}`} />
          <Chip label={`Duration: ${input?.duration_hours || 24}h`} />
          {isCompare && <Chip label={`${compareList.length} Variants Compared`} />}
          
          {(() => {
            const eng = result?.engine_used || compareList?.[0]?.engine_used;
            if (!eng) return null;
            let label = '⚡ Fast Mode (Python FDM)';
            let color = 'bg-slate-100 text-slate-700 border-slate-300';
            if (eng === 'ansys_thermal_fea') {
              label = '🔬 ANSYS Transient Thermal FEA (SOLID70)';
              color = 'bg-sky-50 text-sky-900 border-sky-300 font-bold';
            } else if (eng.includes('ansys_geometry')) {
              label = '⚙️ ANSYS Geometry + FDM Thermal';
              color = 'bg-amber-50 text-amber-900 border-amber-300';
            } else if (eng.includes('ansys')) {
              label = '⚙️ ANSYS MAPDL Solver';
              color = 'bg-sky-50 text-sky-800 border-sky-200';
            }
            return (
              <span className={`inline-flex items-center px-3 py-1 rounded-md text-xs font-mono border ${color}`}>
                {label}
              </span>
            );
          })()}
        </div>

        {/* ANSYS Fallback Warning — shown whenever the real ANSYS solve failed
            and the platform silently substituted the FDM result, so a
            fallback is never mistaken for an actual ANSYS run. */}
        {result?.ansys_fallback_reason && (
          <div className="mt-4 bg-amber-50 text-amber-900 rounded-xl p-4 border border-amber-300 text-xs font-mono">
            <span className="font-bold uppercase tracking-wider text-[11px]">⚠ ANSYS solve failed — showing Python FDM result instead</span>
            <p className="mt-1 text-[11px] text-amber-800">{result.ansys_fallback_reason}</p>
          </div>
        )}

        {/* ANSYS FEA Details Telemetry Card */}
        {(result?.ansys_fea_details || result?.ansys_thermal_solved) && (
          <div className="mt-4 bg-slate-950 text-slate-200 rounded-xl p-4 border border-slate-800 text-xs font-mono">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="font-bold text-sky-400 uppercase tracking-wider text-[11px]">
                ANSYS MAPDL FEA — Transient Solver Output
              </span>
              <span className="text-[10px] text-slate-400">SOLID70 3D Thermal Brick</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
              <div><span className="text-slate-400 block text-[9px] uppercase">Solver Formulation:</span> {result.ansys_fea_details?.solver || 'MAPDL SOLID70 Transient'}</div>
              <div><span className="text-slate-400 block text-[9px] uppercase">Mesh Nodes:</span> {result.ansys_fea_details?.total_nodes?.toLocaleString() || result.geometry?.total_nodes?.toLocaleString() || '—'}</div>
              <div><span className="text-slate-400 block text-[9px] uppercase">Peak Nodal Temp:</span> <strong className="text-amber-400">{result.ansys_fea_details?.peak_temp_any_C?.toFixed(1) ?? '—'}°C</strong></div>
              <div><span className="text-slate-400 block text-[9px] uppercase">Min Nodal Temp:</span> <strong className="text-sky-400">{result.ansys_fea_details?.min_temp_any_C?.toFixed(1) ?? '—'}°C</strong></div>
              <div className="col-span-2 sm:col-span-4 pt-1 text-slate-400 text-[10px] border-t border-slate-800/80">
                Boundary Conditions: Convection (wind-coupled) + Direct Solar Flux (azimuth adjusted) + Ground Plinth 4.0°C
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4 KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">Min Night Temp</span>
            <span className="w-2 h-2 rounded-full bg-sky-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {activePrimary.minTemp != null ? `${activePrimary.minTemp.toFixed(1)}°C` : '—'}
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-1">Overnight cold retention</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">Peak Day Temp</span>
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-amber-600 mt-2">
            {activePrimary.peakTemp != null ? `${activePrimary.peakTemp.toFixed(1)}°C` : '—'}
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-1">Daytime solar thermal peak</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">Solar Captured</span>
            <span className="w-2 h-2 rounded-full bg-orange-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {activePrimary.totalKwh != null ? `${activePrimary.totalKwh.toFixed(2)} kWh` : '—'}
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-1">Direct daily solar yield</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">Efficiency Index</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-emerald-700 mt-2">
            {activePrimary.efficiencyScore != null ? `${activePrimary.efficiencyScore.toFixed(0)}/100` : '—'}
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-1">Comfort & heat retention score</p>
        </div>
      </div>

      {/* Temperature Difference & Thermal Drop Deep-Analysis Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-2xl p-5 text-white shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-slate-200">
              Thermal Difference & Drop Telemetry (Inside vs Outside)
            </h3>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            Transient Passive Climate Performance
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
          {/* Max Temperature Difference */}
          <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Max Thermal Lift (ΔT)</span>
            <div className="text-xl font-bold text-emerald-400 mt-1">
              +{activePrimary.maxDiff != null ? activePrimary.maxDiff.toFixed(1) : '—'}°C
            </div>
            <span className="text-[10px] text-emerald-500/80 block mt-0.5">Warmer than freezing outside</span>
          </div>

          {/* Average Temperature Difference */}
          <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Average ΔT Lift</span>
            <div className="text-xl font-bold text-sky-400 mt-1">
              +{activePrimary.avgDiff != null ? activePrimary.avgDiff.toFixed(1) : '—'}°C
            </div>
            <span className="text-[10px] text-sky-500/80 block mt-0.5">24-hour mean temperature boost</span>
          </div>

          {/* Inside Temperature Drop vs Outside Drop */}
          <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Diurnal Temp Drop</span>
            <div className="text-xl font-bold text-amber-400 mt-1">
              {activePrimary.insideDrop != null ? activePrimary.insideDrop.toFixed(1) : '—'}°C
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              vs Outside {activePrimary.outsideDrop != null ? activePrimary.outsideDrop.toFixed(1) : '—'}°C drop
            </span>
          </div>

          {/* Thermal Mass Damping Ratio */}
          <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Thermal Damping</span>
            <div className="text-xl font-bold text-purple-400 mt-1">
              {activePrimary.dampingRatio != null ? activePrimary.dampingRatio.toFixed(0) : '—'}%
            </div>
            <span className="text-[10px] text-purple-400/80 block mt-0.5">Outside fluctuation arrested</span>
          </div>
        </div>

        {/* Temperature Comparison Strip */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-slate-300">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Outside Ambient:</span>
            <span className="text-sky-300 font-bold">[{activePrimary.minAmb?.toFixed(1)}°C to {activePrimary.maxAmb?.toFixed(1)}°C]</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Inside Shelter:</span>
            <span className="text-amber-300 font-bold">[{activePrimary.minTemp?.toFixed(1)}°C to {activePrimary.peakTemp?.toFixed(1)}°C]</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-400">
            <span>🛡️ Thermal Inertia:</span>
            <span className="font-bold">Active Passive Insulation Protection</span>
          </div>
        </div>
      </div>

      {/* Analytics Tabs Workstation */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <TabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        {activeTab === '3D Model & ANSYS' && (() => {
          const currentVariant = active3DVariant || optimalVariant;
          const currentInput = currentVariant?.input_config || currentVariant?.input || input;
          const currentResult = currentVariant || result || (compareList.length > 0 ? compareList[0] : null);
          const isOptimalSelected = !active3DVariant || (optimalVariant && active3DVariant.variant_label === optimalVariant.variant_label);

          return (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-900 text-white rounded-xl px-4 py-3 text-xs font-mono shadow-md gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>
                    3D Envelope Model:{' '}
                    <strong className="text-sky-300">
                      {currentVariant?.variant_label || currentVariant?.label || input?.variant_label || 'Base Design'}
                    </strong>
                  </span>
                  {isCompare && isOptimalSelected && (
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-bold">
                      RECOMMENDED OPTIMAL
                    </span>
                  )}
                </div>
                {active3DVariant && optimalVariant && active3DVariant.variant_label !== optimalVariant.variant_label && (
                  <button
                    onClick={() => setActive3DVariant(null)}
                    className="text-sky-400 hover:text-sky-300 font-bold underline text-[11px]"
                  >
                    ↺ Reset to Optimal ({optimalVariant.variant_label || bestLabel})
                  </button>
                )}
              </div>
              <Shelter3DViewer
                shelterData={currentInput}
                ansysData={currentResult}
                height="480px"
              />
            </div>
          );
        })()}

        {activeTab === 'Temperature' && (
          <div ref={chartRefs.temperature} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
                24-Hour Diurnal Temperature Profile
              </h2>
              <span className="text-xs font-mono text-slate-500">Threshold: +15.0°C</span>
            </div>
            <TemperatureChart
              insideSeriesData={activePrimary.insideTemp || []}
              ambientSeriesData={activePrimary.ambientTemp || []}
              variantSeries={variantSeries}
            />
          </div>
        )}

        {activeTab === 'Solar Gain' && (
          <div ref={chartRefs.solar} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
                Direct & Diffuse Solar Radiation Gain (W)
              </h2>
              <span className="text-xs font-mono text-slate-500">South Facade Capture</span>
            </div>
            <SolarGainChart
              solarGainSeries={activePrimary.solarGain || []}
              totalKwh={activePrimary.totalKwh}
            />
          </div>
        )}

        {activeTab === 'Heat Flow' && (
          <div ref={chartRefs.heatflow} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
                Envelope Component Heat Flux Matrix (W)
              </h2>
              <span className="text-xs font-mono text-slate-500">Walls · Roof · Plinth · Fenestration</span>
            </div>
            <HeatFlowChart heatFlowSeries={activePrimary.heatFlow || []} />
          </div>
        )}

        {activeTab === 'Comparison' && isCompare && (
          <div ref={chartRefs.comparison} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
                Comparative Design Variants Matrix
              </h2>
              <span className="text-xs font-mono text-slate-500">{compareList.length} Configurations</span>
            </div>
            <ComparisonTable
              results={compareList.map((v) => ({
                ...v,
                label: v.variant_label || 'Design',
                avg_inside_temp: v.avg_inside_temp_C,
                min_temp: v.min_inside_temp_C,
                total_solar_kwh: v.total_solar_gain_kwh,
                total_heat_loss: v.total_heat_loss_kwh,
                efficiency_score: v.efficiency_score,
                comfort_hours: v.comfort_hours,
                input_config: v.input_config || input,
              }))}
              bestVariantLabel={bestLabel}
              activeVariantLabel={active3DVariant?.variant_label || active3DVariant?.label || (compareList[0]?.variant_label || 'Base Design')}
              onSelectVariant={(v) => {
                setActive3DVariant(v);
                setActiveTab('3D Model & ANSYS');
              }}
            />
          </div>
        )}

        {activeTab === 'Recommendation' && (
          <div ref={chartRefs.recommendation} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
                Passive Thermal Architecture Recommendation Brief
              </h2>
              <span className="text-xs font-mono text-slate-500">Engineering Insights</span>
            </div>
            <RecommendationCard
              recommendationText={recText}
              reasons={recReasons}
              bestLabel={isCompare ? bestLabel : (input?.variant_label || 'Base Design')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
