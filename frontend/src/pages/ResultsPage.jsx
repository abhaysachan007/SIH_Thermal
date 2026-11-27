import { lazy, Suspense, useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';

import ComparisonTable from '../components/ComparisonTable';
import RecommendationCard from '../components/RecommendationCard';
import { runBudgetOptimizer, validateModel } from '../api/simulationApi';

const TemperatureChart = lazy(() => import('../components/TemperatureChart'));
const SolarGainChart = lazy(() => import('../components/SolarGainChart'));
const HeatFlowChart = lazy(() => import('../components/HeatFlowChart'));
const Shelter3DViewer = lazy(() => import('../components/Shelter3DViewer'));
const ValidationChart = lazy(() => import('../components/ValidationChart'));

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
  const [budgetTargetTemp, setBudgetTargetTemp] = useState(15);
  const [budgetLimit, setBudgetLimit] = useState(500000);
  const [budgetResult, setBudgetResult] = useState(null);
  const [budgetError, setBudgetError] = useState('');
  const [isBudgetLoading, setIsBudgetLoading] = useState(false);
  const [sensorCsv, setSensorCsv] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [isValidationLoading, setIsValidationLoading] = useState(false);

  if (!state) return null;

  const { result, compareResult, input, isCompare } = state;
  const pipelineResult = state.pipelineResult || state.pipeline_result ||
    (Array.isArray(state.result?.top_10_candidates) ? state.result : null) ||
    (Array.isArray(state.top_10_candidates) ? state : null);
  const pipelineCandidates = pipelineResult?.top_10_candidates || [];
  const pipelineRecommendation = pipelineResult?.recommendation_summary;
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

  const handleBudgetOptimize = async () => {
    setIsBudgetLoading(true);
    setBudgetError('');
    setBudgetResult(null);
    try {
      const requestInput = input || {};
      const response = await runBudgetOptimizer({
        target_min_temp_c: Number(budgetTargetTemp),
        max_budget_inr: Number(budgetLimit),
        shelter_config: {
          length_m: requestInput.length_m ?? requestInput.length ?? null,
          width_m: requestInput.width_m ?? requestInput.width ?? null,
          height_m: requestInput.height_m ?? requestInput.height ?? null,
          required_occupancy: requestInput.required_occupancy ?? requestInput.target_occupancy ?? 4,
          climate_profile_id: requestInput.climate_profile_id || 'ladakh_winter',
          min_ambient_temp_c: requestInput.min_ambient_temp_c ?? requestInput.min_ambient_temp_C ?? null,
          max_ambient_temp_c: requestInput.max_ambient_temp_c ?? requestInput.max_ambient_temp_C ?? null,
          peak_solar_radiation_w_m2: requestInput.peak_solar_radiation_w_m2 ?? requestInput.peak_solar_radiation_W_m2 ?? null,
          use_live_climate: requestInput.use_live_climate ?? requestInput.climate_profile_id === 'nasa_live',
          run_ansys_detailed: false,
        },
      });
      setBudgetResult(response);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (Array.isArray(detail)) {
        setBudgetError(detail.map((item) =>
          `${(item.loc || []).slice(1).join('.')}: ${item.msg}`
        ).join('\n'));
      } else {
        setBudgetError(typeof detail === 'string' ? detail : (error?.message || 'Budget optimization failed.'));
      }
    } finally {
      setIsBudgetLoading(false);
    }
  };

  const handleValidateModel = async () => {
    if (!sensorCsv) {
      setValidationError('Choose a CSV file with 24 hourly measurements first.');
      return;
    }
    setIsValidationLoading(true);
    setValidationError('');
    setValidationResult(null);
    try {
      const response = await validateModel(input || {}, sensorCsv);
      setValidationResult(response);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setValidationError(typeof detail === 'string' ? detail : (error?.message || 'Model validation failed.'));
    } finally {
      setIsValidationLoading(false);
    }
  };

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
    // Text/table-based report generated directly from the result data.
    // The previous implementation rasterized DOM nodes with html2canvas,
    // which (a) only saw the one tab currently mounted (the others are
    // conditionally rendered, so their refs were null and silently skipped)
    // and (b) throws on Tailwind v4's oklch() colors, with the error
    // swallowed by the catch — so nothing downloaded. Building the PDF from
    // data avoids the DOM entirely and always produces a full report.
    setIsExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const marginX = 14;
      let y = 18;

      const fmt = (v, digits = 1, unit = '') =>
        (v == null || Number.isNaN(v)) ? '—' : `${Number(v).toFixed(digits)}${unit}`;

      const ensureSpace = (needed) => {
        if (y + needed > 285) { pdf.addPage(); y = 18; }
      };

      const sectionHeader = (text) => {
        ensureSpace(12);
        pdf.setFontSize(12);
        pdf.setTextColor(2, 132, 199);
        pdf.text(text, marginX, y);
        y += 2;
        pdf.setDrawColor(203, 213, 225);
        pdf.line(marginX, y, pageW - marginX, y);
        y += 6;
      };

      const row = (label, value) => {
        ensureSpace(7);
        pdf.setFontSize(10);
        pdf.setTextColor(71, 85, 105);
        pdf.text(String(label), marginX, y);
        pdf.setTextColor(15, 23, 42);
        pdf.text(String(value), pageW - marginX, y, { align: 'right' });
        y += 6;
      };

      // Title block
      pdf.setFontSize(17);
      pdf.setTextColor(15, 23, 42);
      pdf.setDrawColor(27, 94, 123);
      pdf.setLineWidth(0.6);
      pdf.line(marginX, 7, pageW - marginX, 7);
      pdf.text('THERMA-LADAKH | SIH26051', pageW / 2, y, { align: 'center' });
      y += 7;
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text('Passive Thermal Shelter Optimization Report', pageW / 2, y, { align: 'center' });
      y += 5;
      pdf.text(`Generated: ${new Date().toLocaleDateString()}`, pageW / 2, y, { align: 'center' });
      y += 12;

      const engineLabel = (result?.engine_used || compareList?.[0]?.engine_used || 'python_fdm')
        .includes('ansys') ? 'ANSYS MAPDL SOLID70 Transient FEA' : 'Python FDM (1D transient)';

      // Design configuration
      sectionHeader('Design Configuration');
      row('Solver engine', engineLabel);
      row('Dimensions (L x W x H)', `${input?.length_m ?? '—'} x ${input?.width_m ?? '—'} x ${input?.height_m ?? '—'} m`);
      row('Wall material', input?.wall_material_id ?? '—');
      row('Wall thickness', fmt(input?.wall_thickness_m, 2, ' m'));
      row('Roof material', input?.roof_material_id ?? '—');
      row('Floor material', input?.floor_material_id ?? '—');
      row('Orientation', dirLabel);
      row('Outside ambient range', `${fmt(activePrimary.minAmb)}°C to ${fmt(activePrimary.maxAmb)}°C`);
      y += 4;

      // Thermal performance
      sectionHeader('Thermal Performance');
      row('Min interior temperature', fmt(activePrimary.minTemp, 1, ' °C'));
      row('Peak interior temperature', fmt(activePrimary.peakTemp, 1, ' °C'));
      row('Average interior temperature', fmt(activePrimary.avgTemp, 1, ' °C'));
      row('Max thermal lift (interior vs outside)', fmt(activePrimary.maxDiff, 1, ' °C'));
      row('Average thermal lift', fmt(activePrimary.avgDiff, 1, ' °C'));
      row('Interior diurnal swing', fmt(activePrimary.insideDrop, 1, ' °C'));
      row('Thermal damping ratio', fmt(activePrimary.dampingRatio, 0, ' %'));
      row('Comfort hours (>= 12°C)', activePrimary.comfortHours ?? '—');
      row('Efficiency index', `${activePrimary.efficiencyScore ?? '—'} / 100`);
      y += 4;

      // Energy balance
      sectionHeader('Energy Balance');
      row('Total useful solar gain', fmt(activePrimary.totalKwh, 2, ' kWh'));
      row('Total envelope heat loss', fmt(activePrimary.totalLossKwh, 2, ' kWh'));
      y += 4;

      // ANSYS FEA telemetry, when present
      if (result?.ansys_fea_details) {
        sectionHeader('ANSYS FEA Solver Telemetry');
        row('Solver formulation', result.ansys_fea_details.solver || 'MAPDL SOLID70 Transient');
        row('Mesh nodes', result.ansys_fea_details.total_nodes?.toLocaleString?.() ?? result.ansys_fea_details.total_nodes ?? '—');
        row('Peak nodal temperature', fmt(result.ansys_fea_details.peak_temp_any_C, 1, ' °C'));
        row('Min nodal temperature', fmt(result.ansys_fea_details.min_temp_any_C, 1, ' °C'));
        y += 4;
      }

      // Surface temperatures, when present
      const st = result?.surface_temperatures;
      if (st) {
        sectionHeader('Per-Surface Inner Temperatures');
        const surfaceRows = [
          ['South wall', st.south_wall_inner_C], ['North wall', st.north_wall_inner_C],
          ['East wall', st.east_wall_inner_C], ['West wall', st.west_wall_inner_C],
          ['Roof underside', st.roof_inner_C], ['Floor surface', st.floor_surface_C],
        ];
        surfaceRows.forEach(([label, v]) => { if (v != null) row(label, fmt(v, 1, ' °C')); });
        y += 4;
      }

      // Cost & feasibility, when present
      const ce = result?.cost_estimate;
      if (ce) {
        sectionHeader('Cost & Feasibility');
        row('Estimated build cost (materials + glazing)', `Rs ${Number(ce.material_cost_inr).toLocaleString('en-IN')}`);
        row('Annual heating energy', `${Number(ce.annual_heating_kwh).toLocaleString('en-IN')} kWh/yr`);
        row('Annual heating cost', `Rs ${Number(ce.annual_heating_cost_inr).toLocaleString('en-IN')}`);
        row('Heating cost saved vs baseline', `${ce.heating_cost_savings_pct}%`);
        row('Annual savings vs baseline', `Rs ${Number(ce.annual_savings_inr).toLocaleString('en-IN')}`);
        y += 4;
      }

      // Recommendation
      sectionHeader('Engineering Recommendation');
      pdf.setFontSize(10);
      pdf.setTextColor(30, 41, 59);
      const recLines = pdf.splitTextToSize(recText, pageW - 2 * marginX);
      recLines.forEach((line) => { ensureSpace(6); pdf.text(line, marginX, y); y += 5; });
      y += 2;
      recReasons.forEach((r) => {
        const bulletLines = pdf.splitTextToSize(`•  ${r}`, pageW - 2 * marginX);
        bulletLines.forEach((line) => { ensureSpace(6); pdf.text(line, marginX, y); y += 5; });
      });

      pdf.save('THERMA_LADAKH_Simulation_Report.pdf');
    } catch (e) {
      console.error('PDF export failed:', e);
      alert(`PDF export failed: ${e?.message || e}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportResearchPDF = async () => {
    setIsExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const marginX = 14;
      const resultData = isCompare && optimalVariant ? optimalVariant : (result || {});
      const reportInput = resultData.input_config || input || {};
      const reportSeries = {
        ambient: resultData.ambient_temperature_series || [],
        solarIrradiance: resultData.solar_irradiance_series || [],
        indoor: resultData.inside_temperature_series || [],
        solarGain: resultData.solar_gain_series || [],
      };
      const seriesAtHour = (series, hour) => {
        const point = series.find((item) => Math.abs(Number(item.hour) - hour) < 1e-6);
        return point?.value == null ? null : Number(point.value);
      };
      const heatLossAtHour = (hour) => {
        if (!Array.isArray(resultData.heat_flow_series) || resultData.heat_flow_series.length === 0) return null;
        return resultData.heat_flow_series.reduce((total, component) => {
          const point = component.heat_flow_series?.find((item) => Math.abs(Number(item.hour) - hour) < 1e-6);
          return total + (point?.value == null ? 0 : Math.max(0, -Number(point.value)));
        }, 0);
      };
      const fmt = (value, digits = 2) => (
        value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits)
      );
      let y = 18;

      const ensureSpace = (needed) => {
        if (y + needed > 278) {
          pdf.addPage();
          y = 18;
        }
      };
      const sectionHeader = (text) => {
        ensureSpace(12);
        pdf.setFontSize(12);
        pdf.setTextColor(2, 132, 199);
        pdf.text(text, marginX, y);
        y += 3;
        pdf.setDrawColor(203, 213, 225);
        pdf.line(marginX, y, pageW - marginX, y);
        y += 6;
      };
      const wrappedParagraph = (text) => {
        const lines = pdf.splitTextToSize(text, pageW - 2 * marginX);
        lines.forEach((line) => {
          ensureSpace(6);
          pdf.setFontSize(9);
          pdf.setTextColor(51, 65, 85);
          pdf.text(line, marginX, y);
          y += 4.5;
        });
        y += 2;
      };
      const drawCell = (text, x, width, align = 'left') => {
        const lines = pdf.splitTextToSize(String(text), width - 2);
        pdf.text(lines[0] || '', x + (align === 'right' ? width - 2 : 1), y, {
          align,
          maxWidth: width - 2,
        });
      };
      const addFooter = () => {
        const pageCount = pdf.getNumberOfPages();
        for (let page = 1; page <= pageCount; page += 1) {
          pdf.setPage(page);
          pdf.setFontSize(7);
          pdf.setTextColor(100, 116, 139);
          pdf.text(
            'Generated by THERMA-LADAKH | SIH26051 | For research use - not certified for structural design',
            pageW / 2,
            289,
            { align: 'center', maxWidth: pageW - 2 * marginX },
          );
        }
      };

      pdf.setFontSize(17);
      pdf.setTextColor(15, 23, 42);
      pdf.text('THERMA-LADAKH | Research Methodology Report', pageW / 2, y, { align: 'center' });
      y += 9;
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Generated: ${new Date().toISOString()}`, pageW / 2, y, { align: 'center' });
      y += 11;

      sectionHeader('Section 1: Simulation Parameters');
      const parameterEntries = Object.entries(reportInput);
      if (parameterEntries.length === 0) parameterEntries.push(['Parameters', 'Not available']);
      parameterEntries.forEach(([key, value]) => {
        const text = value == null
          ? '—'
          : typeof value === 'object' ? JSON.stringify(value) : String(value);
        const wrapped = pdf.splitTextToSize(text, pageW - 2 * marginX - 72);
        wrapped.forEach((line, index) => {
          ensureSpace(6);
          pdf.setFontSize(8);
          pdf.setTextColor(71, 85, 105);
          if (index === 0) pdf.text(String(key), marginX, y, { maxWidth: 68 });
          pdf.setTextColor(15, 23, 42);
          pdf.text(line, marginX + 70, y);
          y += 4.5;
        });
      });

      sectionHeader('Section 2: Physics Methodology');
      wrappedParagraph(
        'Thermal simulation uses a lumped-capacitance finite difference method over a 24-hour period. Hourly values in this report are sampled from solver output; the Python FDM internally integrates at 30-second steps.',
      );
      wrappedParagraph(
        'Solar gain is computed using orientation-weighted irradiance multipliers at the climate profile latitude (default Ladakh latitude 34°N). The implementation computes solar position but does not identify a separate empirical calibration dataset.',
      );
      wrappedParagraph(
        'Material thermal properties are stored in the project material database. The requested references are the ASHRAE Handbook of Fundamentals and IS 3792 (Indian Standard for heat insulation); the current dataset does not record per-material citations, so this provenance should be verified before publication.',
      );

      sectionHeader('Section 3: Hourly Results');
      const columns = [
        { label: 'Hour', width: 14 },
        { label: 'Ambient °C', width: 25 },
        { label: 'Solar W/m²', width: 25 },
        { label: 'Indoor °C', width: 24 },
        { label: 'Loss W', width: 24 },
        { label: 'Gain W', width: 24 },
        { label: 'Net W', width: 24 },
      ];
      const tableX = marginX;
      const tableWidth = columns.reduce((total, column) => total + column.width, 0);
      const drawTableHeader = () => {
        ensureSpace(9);
        pdf.setFillColor(15, 23, 42);
        pdf.rect(tableX, y - 4, tableWidth, 7, 'F');
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        let x = tableX;
        columns.forEach((column) => {
          pdf.text(column.label, x + 1, y, { maxWidth: column.width - 2 });
          x += column.width;
        });
        y += 5;
      };
      drawTableHeader();
      for (let hour = 0; hour < 24; hour += 1) {
        ensureSpace(6);
        if (y === 18) drawTableHeader();
        if (hour % 2 === 0) {
          pdf.setFillColor(241, 245, 249);
          pdf.rect(tableX, y - 3.5, tableWidth, 5, 'F');
        }
        const loss = heatLossAtHour(hour);
        const gain = seriesAtHour(reportSeries.solarGain, hour);
        const values = [
          String(hour).padStart(2, '0'),
          fmt(seriesAtHour(reportSeries.ambient, hour)),
          fmt(seriesAtHour(reportSeries.solarIrradiance, hour), 1),
          fmt(seriesAtHour(reportSeries.indoor, hour)),
          fmt(loss, 1),
          fmt(gain, 1),
          fmt(loss == null || gain == null ? null : gain - loss, 1),
        ];
        let x = tableX;
        pdf.setFontSize(7);
        pdf.setTextColor(15, 23, 42);
        values.forEach((value, index) => {
          drawCell(value, x, columns[index].width);
          x += columns[index].width;
        });
        y += 5;
      }

      sectionHeader('Section 4: Validation Status');
      if (validationResult) {
        const validationLine = `RMSE: ${fmt(validationResult.rmse, 4)} °C | MAE: ${fmt(validationResult.mae, 4)} °C | R²: ${fmt(validationResult.r_squared, 4)}`;
        wrappedParagraph(validationLine);
      } else {
        wrappedParagraph('Not validated against sensor data');
      }

      addFooter();
      pdf.save('THERMA_LADAKH_Research_Report.pdf');
    } catch (e) {
      console.error('Research PDF export failed:', e);
      alert(`Research PDF export failed: ${e?.message || e}`);
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
            <button
              onClick={handleExportResearchPDF}
              disabled={isExporting}
              className="px-4 py-1.5 bg-sky-700 hover:bg-sky-600 text-white border border-sky-600 rounded-lg text-xs font-mono font-bold transition-all shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? 'Generating PDF…' : 'Export Research Report (PDF)'}
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
              {activePrimary.maxDiff != null ? `${activePrimary.maxDiff >= 0 ? '+' : ''}${activePrimary.maxDiff.toFixed(1)}` : '—'}°C
            </div>
            <span className="text-[10px] text-emerald-500/80 block mt-0.5">Warmer than freezing outside</span>
          </div>

          {/* Average Temperature Difference */}
          <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Average ΔT Lift</span>
            <div className="text-xl font-bold text-sky-400 mt-1">
              {activePrimary.avgDiff != null ? `${activePrimary.avgDiff >= 0 ? '+' : ''}${activePrimary.avgDiff.toFixed(1)}` : '—'}°C
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

      {pipelineRecommendation && (
        <RecommendationCard recommendationSummary={pipelineRecommendation} bestLabel="Top-Ranked Shelter Design" />
      )}

      {pipelineCandidates.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
              Ranked Shelter Candidates
            </h2>
            <span className="text-xs font-mono text-slate-500">{pipelineCandidates.length} designs</span>
          </div>
          <div className="grid gap-3">
            {pipelineCandidates.map((candidate) => {
              const metrics = candidate.screening_results || {};
              const design = candidate.design || {};
              const wallMaterial = design.wall_system?.outer_layer?.material_id || '—';
              const comfortHours = metrics.comfort_hours_count ?? metrics.comfort_hours ?? '—';
              const comfortPercent = metrics.comfort_hours_pct ?? metrics.comfort_percentage;
              return (
                <article key={candidate.candidate_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">
                      #{candidate.rank} · {design.variant_label || candidate.candidate_id}
                    </h3>
                    <span className="text-xs font-mono text-slate-600">Score {candidate.score}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Chip label={`Wall: ${wallMaterial}`} />
                    <Chip label={`Comfort: ${comfortHours} h${comfortPercent != null ? ` (${comfortPercent}%)` : ''}`} />
                    <Chip label={`Min indoor: ${metrics.min_indoor_temperature_c ?? '—'}°C`} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 sm:px-6">
          <div>
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">Budget Optimizer</h2>
            <p className="mt-1 text-xs text-slate-500">Find lower-cost material combinations that meet your minimum temperature target.</p>
          </div>
          <span className="text-xs font-mono font-bold text-sky-700 group-open:rotate-180">▼</span>
        </summary>
        <div className="space-y-5 border-t border-slate-100 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-700">
              <span className="flex items-center justify-between">
                <span>Target minimum indoor temperature</span>
                <span className="text-sky-700">{budgetTargetTemp}°C</span>
              </span>
              <input
                type="range"
                min="10"
                max="20"
                step="0.5"
                value={budgetTargetTemp}
                onChange={(event) => setBudgetTargetTemp(Number(event.target.value))}
                disabled={isBudgetLoading}
                className="w-full accent-sky-600"
              />
              <span className="flex justify-between text-[10px] font-normal text-slate-400">
                <span>10°C</span><span>20°C</span>
              </span>
            </label>
            <label className="space-y-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-700">
              Maximum budget (INR)
              <input
                type="number"
                min="0"
                step="10000"
                value={budgetLimit}
                onChange={(event) => setBudgetLimit(event.target.value)}
                disabled={isBudgetLoading}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleBudgetOptimize}
            disabled={isBudgetLoading || budgetLimit === '' || !Number.isFinite(Number(budgetLimit)) || Number(budgetLimit) < 0}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-mono font-bold text-sky-400 shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBudgetLoading ? 'Searching material combinations…' : 'Find Cheapest Design'}
          </button>

          {isBudgetLoading && (
            <p role="status" className="text-xs font-mono text-slate-500">Screening candidate designs and estimating material costs…</p>
          )}
          {budgetError && (
            <p role="alert" className="whitespace-pre-line rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{budgetError}</p>
          )}
          {budgetResult && (
            <div className="space-y-3">
              <div className={`rounded-lg border px-3 py-2 text-xs font-mono ${
                budgetResult.feasible
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {budgetResult.feasible
                  ? `Budget target is feasible. Lowest qualifying estimate: ₹${Number(budgetResult.cheapest_cost_inr).toLocaleString('en-IN')}.`
                  : budgetResult.gap_if_infeasible}
              </div>
              {budgetResult.cheapest_designs?.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  {budgetResult.cheapest_designs.map((candidate) => {
                    const design = candidate.design || {};
                    const wall = design.wall_system || {};
                    const layers = [
                      wall.outer_layer && `${wall.outer_layer.material_id} ${Math.round(wall.outer_layer.thickness_m * 100)}cm`,
                      wall.insulation_layer && `${wall.insulation_layer.material_id} ${Math.round(wall.insulation_layer.thickness_m * 100)}cm`,
                      wall.inner_layer && `${wall.inner_layer.material_id} ${Math.round(wall.inner_layer.thickness_m * 100)}cm`,
                    ].filter(Boolean);
                    const metrics = candidate.screening_results || {};
                    return (
                      <article key={candidate.candidate_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-xs font-bold text-slate-900">{design.variant_label || `Design ${candidate.rank}`}</h3>
                          <span className="shrink-0 rounded bg-sky-100 px-2 py-0.5 text-[10px] font-mono font-bold text-sky-800">#{candidate.rank}</span>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-600">
                          Wall: {layers.join(' + ') || '—'}<br />
                          Roof: {design.roof?.material_id || '—'} · Floor: {design.floor_material_id || '—'}
                        </p>
                        <div className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-xs font-mono">
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500">Estimated cost</span>
                            <strong className="text-slate-900">₹{Number(candidate.estimated_cost_inr || 0).toLocaleString('en-IN')}</strong>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500">Minimum indoor</span>
                            <strong className="text-sky-700">{Number(metrics.min_indoor_temperature_c).toFixed(1)}°C</strong>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500">Comfort hours</span>
                            <strong className="text-emerald-700">{metrics.comfort_hours_count ?? metrics.comfort_hours ?? '—'} h</strong>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No candidate designs were returned for this temperature target.</p>
              )}
            </div>
          )}
        </div>
      </details>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
            Validate Against Real Data
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Upload one day of sensor readings to compare measured temperatures with the FDM simulation.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-700">
            Sensor temperature CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setSensorCsv(event.target.files?.[0] || null);
                setValidationResult(null);
                setValidationError('');
              }}
              disabled={isValidationLoading}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal normal-case tracking-normal text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-700"
            />
            <span className="block text-[10px] font-normal normal-case tracking-normal text-slate-400">
              Required columns: hour (0–23), measured_temp_c
            </span>
          </label>
          <button
            type="button"
            onClick={handleValidateModel}
            disabled={isValidationLoading || !sensorCsv}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-mono font-bold text-sky-400 shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isValidationLoading ? 'Validating…' : 'Validate Model'}
          </button>
        </div>
        {validationError && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {validationError}
          </p>
        )}
        {validationResult && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`rounded-full border px-3 py-1 text-xs font-mono font-bold ${
                validationResult.validation_grade === 'Excellent'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : validationResult.validation_grade === 'Good'
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                    : validationResult.validation_grade === 'Acceptable'
                      ? 'border-orange-200 bg-orange-50 text-orange-800'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}>
                {validationResult.validation_grade} validation
              </span>
              <span className="text-xs font-mono text-slate-500">
                Max deviation: {Number(validationResult.max_deviation_c).toFixed(2)}°C at hour {validationResult.max_deviation_hour}:00
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['RMSE', validationResult.rmse, '°C'],
                ['MAE', validationResult.mae, '°C'],
                ['R²', validationResult.r_squared, ''],
              ].map(([label, value, unit]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{label}</span>
                  <p className="mt-1 text-xl font-bold font-mono text-slate-900">
                    {Number(value).toFixed(3)}{unit}
                  </p>
                </div>
              ))}
            </div>
            <Suspense fallback={<div className="h-[320px] w-full animate-pulse rounded-xl bg-slate-100" />}>
              <ValidationChart data={validationResult.hourly_comparison || []} />
            </Suspense>
          </div>
        )}
      </section>

      {/* Cost & Feasibility Card */}
      {(() => {
        const ce = result?.cost_estimate || optimalVariant?.cost_estimate;
        if (!ce) return null;
        const inr = (v) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`;
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-800">
                Cost & Real-World Feasibility
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Estimated Build Cost</span>
                <div className="text-xl font-bold text-slate-900 mt-1">{inr(ce.material_cost_inr)}</div>
                <span className="text-[10px] text-slate-500 block mt-0.5">Materials + glazing</span>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Annual Heating Cost</span>
                <div className="text-xl font-bold text-amber-600 mt-1">{inr(ce.annual_heating_cost_inr)}</div>
                <span className="text-[10px] text-slate-500 block mt-0.5">{ce.annual_heating_kwh?.toLocaleString('en-IN')} kWh/yr @ ₹7/kWh</span>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                <span className="text-[10px] text-emerald-700 uppercase tracking-wider block">Heating Cost Saved</span>
                <div className="text-xl font-bold text-emerald-600 mt-1">{ce.heating_cost_savings_pct}%</div>
                <span className="text-[10px] text-emerald-700 block mt-0.5">vs uninsulated stone baseline</span>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                <span className="text-[10px] text-emerald-700 uppercase tracking-wider block">Annual Savings</span>
                <div className="text-xl font-bold text-emerald-600 mt-1">{inr(ce.annual_savings_inr)}</div>
                <span className="text-[10px] text-emerald-700 block mt-0.5">per year vs baseline</span>
              </div>
            </div>
            <div className="mt-3 text-[10px] font-mono text-slate-400">
              Assumptions: {ce.assumptions?.winter_heating_days} heating days/yr · {ce.assumptions?.comfort_setpoint_C}°C setpoint · Baseline: {ce.assumptions?.baseline}
            </div>
          </div>
        );
      })()}

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
              <Suspense fallback={<div className="h-[480px] w-full animate-pulse rounded-xl bg-slate-100" />}>
                <Shelter3DViewer
                  shelterData={currentInput}
                  ansysData={currentResult}
                  height="480px"
                />
              </Suspense>
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
            <Suspense fallback={<div className="h-[360px] w-full animate-pulse rounded-xl bg-slate-100" />}>
              <TemperatureChart
                insideSeriesData={activePrimary.insideTemp || []}
                ambientSeriesData={activePrimary.ambientTemp || []}
                variantSeries={variantSeries}
              />
            </Suspense>
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
            <Suspense fallback={<div className="h-[360px] w-full animate-pulse rounded-xl bg-slate-100" />}>
              <SolarGainChart
                solarGainSeries={activePrimary.solarGain || []}
                totalKwh={activePrimary.totalKwh}
              />
            </Suspense>
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
            <Suspense fallback={<div className="h-[360px] w-full animate-pulse rounded-xl bg-slate-100" />}>
              <HeatFlowChart heatFlowSeries={activePrimary.heatFlow || []} />
            </Suspense>
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
              recommendationSummary={pipelineRecommendation}
            />
          </div>
        )}
      </div>
    </div>
  );
}
