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
  0: 'North', 45: 'NE', 90: 'East', 135: 'SE',
  180: 'South', 225: 'SW', 270: 'West', 315: 'NW',
};

function extract(r) {
  if (!r) return {};
  const data = r.result || r;
  return {
    insideTemp:    data.inside_temperature_series || data.inside_temperature || [],
    ambientTemp:   data.ambient_temperature_series || data.ambient_temperature || [],
    solarGain:     data.solar_gain_series || [],
    totalKwh:      data.total_solar_gain_kwh ?? data.total_solar_kwh ?? null,
    heatFlow:      data.heat_flow_series || [],
    minTemp:       data.min_inside_temp_C,
    peakTemp:      data.peak_inside_temp_C,
    avgTemp:       data.avg_inside_temp_C,
    efficiencyScore: data.efficiency_score,
    comfortHours:  data.comfort_hours,
    totalLossKwh:  data.total_heat_loss_kwh,
    variantLabel:  data.variant_label || 'Design',
  };
}

function Chip({ label }) {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
      {label}
    </span>
  );
}

function TabBar({ tabs, active, onSelect }) {
  return (
    <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            active === tab
              ? 'border-primary text-primary font-bold'
              : 'border-transparent text-gray-500 hover:text-primary hover:border-primary/30'
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

  if (!state) return null;

  const { result, compareResult, input, isCompare } = state;
  const tabs = isCompare ? TABS_COMPARE : TABS_BASE;

  const single = extract(result);
  const compareList = compareResult?.results || [];
  const bestLabel = compareResult?.best_variant_label || 'Optimal Design';
  const recText = compareResult?.recommendation_text || result?.recommendation_text ||
    `Simulation completed for ${input?.variant_label || 'your shelter'}. Peak inside temperature reached ${single.peakTemp ?? '-'}?C with minimum overnight temperature of ${single.minTemp ?? '-'}?C.`;
  const recReasons = compareResult?.recommendation_reasons || result?.recommendation_reasons || [
    `Thermal efficiency score: ${single.efficiencyScore ?? '-'}/100`,
    `Overnight minimum inside temperature: ${single.minTemp ?? '-'}?C`,
    `Total useful solar gain: ${single.totalKwh != null ? `${single.totalKwh.toFixed(2)} kWh` : '-'}`,
    `Total envelope heat loss: ${single.totalLossKwh != null ? `${single.totalLossKwh.toFixed(2)} kWh` : '-'}`,
    `Comfort hours above threshold: ${single.comfortHours ?? '-'} hours`,
  ];

  const activePrimary = isCompare && compareList.length > 0 ? extract(compareList[0]) : single;

  const variantSeries = isCompare
    ? compareList.slice(1).map((v, i) => ({
        label: v.variant_label || `Variant ${i + 2}`,
        data: extract(v).insideTemp,
      }))
    : [];

  const orientDeg = input?.orientation_deg ?? input?.orientation ?? 180;
  const dirLabel = DIR_LABELS[orientDeg] || `${orientDeg}?`;
  const climateName = input?.climate_profile_id || 'Ladakh Winter';

  const handleExportPDF = async () => {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    let y = 15;

    pdf.setFontSize(18);
    pdf.setTextColor(27, 94, 123);
    pdf.text('ThermalShelter - Ladakh Thermal Analysis Report', pageW / 2, y, { align: 'center' });
    y += 8;

    pdf.setFontSize(10);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Climate: ${climateName}  |  Orientation: ${dirLabel}  |  Duration: ${input?.duration_hours || 24}h`, pageW / 2, y, { align: 'center' });
    y += 6;
    pdf.text(`Generated: ${new Date().toLocaleString()}`, pageW / 2, y, { align: 'center' });
    y += 10;

    const refEntries = [
      ['Temperature Analysis', chartRefs.temperature],
      ['Solar Energy Capture', chartRefs.solar],
      ['Heat Flow Breakdown', chartRefs.heatflow],
    ];
    if (isCompare) refEntries.push(['Comparative Analysis', chartRefs.comparison]);
    refEntries.push(['Recommendation', chartRefs.recommendation]);

    for (const [title, ref] of refEntries) {
      if (!ref.current) continue;
      const canvas = await html2canvas(ref.current, { scale: 1.5, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const imgW = pageW - 20;
      const imgH = (canvas.height / canvas.width) * imgW;

      if (y + imgH + 15 > 280) { pdf.addPage(); y = 15; }
      pdf.setFontSize(13);
      pdf.setTextColor(27, 94, 123);
      pdf.text(title, 10, y);
      y += 5;
      pdf.addImage(imgData, 'PNG', 10, y, imgW, imgH);
      y += imgH + 10;
    }

    pdf.save('ThermalShelter_Report.pdf');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h1 className="text-2xl font-bold text-primary mb-3">Thermal Analysis Results</h1>
        <div className="flex flex-wrap gap-2">
          <Chip label={`Climate: ${climateName}`} />
          <Chip label={`Orientation: ${dirLabel}`} />
          <Chip label={`Duration: ${input?.duration_hours || 24}h`} />
          {isCompare && <Chip label={`${compareList.length} variants compared`} />}
          {(() => {
            const eng = result?.engine_used || compareList?.[0]?.engine_used;
            if (!eng) return null;
            const label = eng.includes('ansys_geometry')
              ? 'ANSYS Design + FDM Thermal'
              : eng.includes('ansys')
              ? 'ANSYS MAPDL'
              : 'Fast Mode (FDM)';
            const color = eng.includes('ansys')
              ? 'bg-accent/10 text-accent'
              : 'bg-gray-100 text-gray-600';
            return (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${color}`}>
                Engine: {label}
              </span>
            );
          })()}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
          <p className="text-xs text-gray-500 font-semibold mb-1">Min Inside Temp</p>
          <p className="text-2xl font-bold text-primary">{activePrimary.minTemp != null ? `${activePrimary.minTemp.toFixed(1)}?C` : '-'}</p>
          <p className="text-xs text-gray-400 mt-1">Overnight retention</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
          <p className="text-xs text-gray-500 font-semibold mb-1">Peak Inside Temp</p>
          <p className="text-2xl font-bold text-accent">{activePrimary.peakTemp != null ? `${activePrimary.peakTemp.toFixed(1)}?C` : '-'}</p>
          <p className="text-xs text-gray-400 mt-1">Daytime solar peak</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
          <p className="text-xs text-gray-500 font-semibold mb-1">Solar Captured</p>
          <p className="text-2xl font-bold text-accent-light">{activePrimary.totalKwh != null ? `${activePrimary.totalKwh.toFixed(2)} kWh` : '-'}</p>
          <p className="text-xs text-gray-400 mt-1">Total daily gain</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
          <p className="text-xs text-gray-500 font-semibold mb-1">Efficiency Score</p>
          <p className="text-2xl font-bold text-success">{activePrimary.efficiencyScore != null ? `${activePrimary.efficiencyScore.toFixed(0)}/100` : '-'}</p>
          <p className="text-xs text-gray-400 mt-1">Overall rating</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <TabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        {activeTab === '3D Model & ANSYS' && (
          <div className="space-y-4">
            <Shelter3DViewer
              shelterData={input}
              ansysData={result || compareList[0]}
              height="480px"
              allowLaunchGui={true}
            />
          </div>
        )}

        {activeTab === 'Temperature' && (
          <div ref={chartRefs.temperature}>
            <h2 className="text-lg font-semibold text-primary mb-4">Indoor vs Ambient Temperature (24h)</h2>
            <TemperatureChart
              insideSeriesData={activePrimary.insideTemp || []}
              ambientSeriesData={activePrimary.ambientTemp || []}
              variantSeries={variantSeries}
            />
          </div>
        )}

        {activeTab === 'Solar Gain' && (
          <div ref={chartRefs.solar}>
            <h2 className="text-lg font-semibold text-primary mb-4">Solar Gain Throughout the Day</h2>
            <SolarGainChart
              solarGainSeries={activePrimary.solarGain || []}
              totalKwh={activePrimary.totalKwh}
            />
          </div>
        )}

        {activeTab === 'Heat Flow' && (
          <div ref={chartRefs.heatflow}>
            <h2 className="text-lg font-semibold text-primary mb-4">Heat Flow by Component</h2>
            <HeatFlowChart heatFlowSeries={activePrimary.heatFlow || []} />
          </div>
        )}

        {activeTab === 'Comparison' && isCompare && (
          <div ref={chartRefs.comparison}>
            <h2 className="text-lg font-semibold text-primary mb-4">Design Comparison</h2>
            <ComparisonTable
              results={compareList.map((v) => ({
                label: v.variant_label || 'Design',
                avg_inside_temp: v.avg_inside_temp_C,
                min_temp: v.min_inside_temp_C,
                total_solar_kwh: v.total_solar_gain_kwh,
                total_heat_loss: v.total_heat_loss_kwh,
                efficiency_score: v.efficiency_score,
                comfort_hours: v.comfort_hours,
              }))}
              bestVariantLabel={bestLabel}
            />
          </div>
        )}

        {activeTab === 'Recommendation' && (
          <div ref={chartRefs.recommendation}>
            <h2 className="text-lg font-semibold text-primary mb-4">Design Recommendation</h2>
            <RecommendationCard
              recommendationText={recText}
              reasons={recReasons}
              bestLabel={isCompare ? bestLabel : (input?.variant_label || 'Your Design')}
            />
          </div>
        )}
      </div>

      <div className="flex justify-between items-center pt-2">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-primary font-semibold hover:underline"
        >
          Run another simulation
        </button>
        <button
          onClick={handleExportPDF}
          className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-colors shadow-md text-sm"
        >
          Download PDF Report
        </button>
      </div>
    </div>
  );
}
