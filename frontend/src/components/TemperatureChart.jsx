import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const formatHour = (h) => {
  const rounded = Math.round(h);
  if (rounded === 0 || rounded === 24) return '00:00';
  if (rounded === 6) return '06:00';
  if (rounded === 12) return '12:00';
  if (rounded === 18) return '18:00';
  if (rounded === 23) return '23:00';
  return '';
};

const VARIANT_COLORS = ['#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

function buildChartData(insideSeriesData = [], ambientSeriesData = [], variantSeries = []) {
  if (!insideSeriesData.length && !ambientSeriesData.length) return [];

  const basePoints = insideSeriesData.length ? insideSeriesData : ambientSeriesData;
  return basePoints.map((pt, idx) => {
    const h = pt.hour;
    const ambPt = ambientSeriesData[idx] || ambientSeriesData.find((d) => Math.abs(d.hour - h) < 0.25);
    const inVal = pt.value != null ? parseFloat(pt.value) : null;
    const ambVal = ambPt && ambPt.value != null ? parseFloat(ambPt.value) : null;
    const deltaT = inVal != null && ambVal != null ? roundNum(inVal - ambVal, 2) : null;

    const row = {
      hour: h,
      inside: inVal,
      ambient: ambVal,
      delta_t: deltaT,
    };
    variantSeries.forEach((vs, i) => {
      const vPt = vs.data?.[idx] || vs.data?.find((d) => Math.abs(d.hour - h) < 0.25);
      row[`variant_${i}`] = vPt ? vPt.value : null;
    });
    return row;
  });
}

function roundNum(val, dec = 1) {
  return Number(Math.round(val + 'e' + dec) + 'e-' + dec);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const hourNum = typeof label === 'number' ? label : parseFloat(label);
  const hourInt = Math.floor(hourNum);
  const minInt = Math.round((hourNum - hourInt) * 60);
  const timeStr = `${String(hourInt).padStart(2, '0')}:${String(minInt).padStart(2, '0')}`;

  const inItem = payload.find((p) => p.dataKey === 'inside');
  const ambItem = payload.find((p) => p.dataKey === 'ambient');
  const delta = (inItem?.value != null && ambItem?.value != null)
    ? (inItem.value - ambItem.value).toFixed(1)
    : null;

  return (
    <div className="bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-3 text-xs font-mono text-white min-w-[200px]">
      <p className="font-bold text-slate-400 border-b border-slate-800 pb-1 mb-1.5 flex items-center justify-between">
        <span>TIME:</span>
        <span className="text-sky-400 font-bold">{timeStr}h</span>
      </p>
      <div className="space-y-1.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3">
            <span className="text-slate-300 text-[11px] truncate">{p.name}:</span>
            <strong style={{ color: p.color }} className="font-bold">
              {p.value != null ? `${Number(p.value).toFixed(1)}°C` : '—'}
            </strong>
          </div>
        ))}
        {delta != null && (
          <div className="pt-1 mt-1 border-t border-slate-800 flex items-center justify-between text-emerald-400 font-bold">
            <span className="text-[10px] text-emerald-500 uppercase tracking-wider">ΔT Thermal Lift:</span>
            <span>+{delta}°C</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default function TemperatureChart({
  insideSeriesData = [],
  ambientSeriesData = [],
  variantSeries = [],
}) {
  const data = buildChartData(insideSeriesData, ambientSeriesData, variantSeries);

  return (
    <div className="w-full pt-2">
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={data} margin={{ top: 15, right: 25, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={formatHour}
            ticks={[0, 6, 12, 18, 24]}
            tick={{ fontSize: 11, fontFamily: 'monospace', fill: '#64748B' }}
            stroke="#CBD5E1"
          />
          <YAxis
            tick={{ fontSize: 11, fontFamily: 'monospace', fill: '#64748B' }}
            stroke="#CBD5E1"
            domain={['auto', 'auto']}
            unit="°C"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontFamily: 'monospace' }}
          />
          <ReferenceLine
            y={15}
            stroke="#059669"
            strokeDasharray="4 3"
            label={{ value: 'Comfort Target (+15°C)', position: 'insideTopRight', fill: '#059669', fontSize: 10, fontFamily: 'monospace' }}
          />
          <Line
            type="monotone"
            dataKey="inside"
            name="Inside Interior"
            stroke="#0284C7"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: '#0284C7', stroke: '#BAE6FD', strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="ambient"
            name="Ambient Outdoor"
            stroke="#94A3B8"
            strokeWidth={1.8}
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 4, fill: '#94A3B8' }}
          />
          {variantSeries.map((vs, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`variant_${i}`}
              name={vs.label || `Variant ${i + 2}`}
              stroke={VARIANT_COLORS[i % VARIANT_COLORS.length]}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
