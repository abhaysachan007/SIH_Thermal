import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const formatHour = (h) => {
  const rounded = Math.round(h);
  if (rounded === 0 || rounded === 24) return '12 AM';
  if (rounded === 6) return '6 AM';
  if (rounded === 12) return '12 PM';
  if (rounded === 18) return '6 PM';
  if (rounded === 23) return '11 PM';
  return '';
};

const VARIANT_COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

function buildChartData(insideSeriesData = [], ambientSeriesData = [], variantSeries = []) {
  if (!insideSeriesData.length && !ambientSeriesData.length) return [];

  const basePoints = insideSeriesData.length ? insideSeriesData : ambientSeriesData;
  return basePoints.map((pt, idx) => {
    const h = pt.hour;
    const ambPt = ambientSeriesData[idx] || ambientSeriesData.find((d) => Math.abs(d.hour - h) < 0.25);
    const row = {
      hour: h,
      inside: pt.value,
      ambient: ambPt ? ambPt.value : null,
    };
    variantSeries.forEach((vs, i) => {
      const vPt = vs.data?.[idx] || vs.data?.find((d) => Math.abs(d.hour - h) < 0.25);
      row[`variant_${i}`] = vPt ? vPt.value : null;
    });
    return row;
  });
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const hourNum = typeof label === 'number' ? label : parseFloat(label);
  const hourInt = Math.floor(hourNum);
  const minInt = Math.round((hourNum - hourInt) * 60);
  const timeStr = `${hourInt % 12 === 0 ? 12 : hourInt % 12}:${minInt === 0 ? '00' : minInt} ${hourInt < 12 ? 'AM' : 'PM'}`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">?? {timeStr}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-mono font-bold">{p.value != null ? `${Number(p.value).toFixed(1)}?C` : '?'}</span>
        </p>
      ))}
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
    <div className="w-full">
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="hour"
            tickFormatter={formatHour}
            ticks={[0, 6, 12, 18, 24]}
            label={{ value: 'Hour of Day', position: 'insideBottom', offset: -5, fontSize: 12 }}
          />
          <YAxis
            label={{ value: 'Temperature (?C)', angle: -90, position: 'insideLeft', fontSize: 12 }}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend verticalAlign="top" />
          <ReferenceLine
            y={15}
            stroke="#27AE60"
            strokeDasharray="6 3"
            label={{ value: 'Comfort Threshold (15?C)', position: 'insideTopRight', fill: '#27AE60', fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="inside"
            name="Inside Temp"
            stroke="#1B5E7B"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="ambient"
            name="Ambient Temp"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            activeDot={{ r: 5 }}
          />
          {variantSeries.map((vs, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`variant_${i}`}
              name={vs.label || `Variant ${i + 2}`}
              stroke={VARIANT_COLORS[i % VARIANT_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
