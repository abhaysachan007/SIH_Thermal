import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const COMPONENT_COLORS = {
  'South Wall': '#1B5E7B',
  'North Wall': '#0D3349',
  'East Wall':  '#2980B9',
  'West Wall':  '#3498DB',
  'Roof':       '#E67E22',
  'Floor':      '#8b5cf6',
  'Openings':   '#10b981',
};

const formatHour = (h) => {
  const rounded = Math.round(h);
  if (rounded === 0 || rounded === 24) return '12 AM';
  if (rounded === 6) return '6 AM';
  if (rounded === 12) return '12 PM';
  if (rounded === 18) return '6 PM';
  return '';
};

function buildData(heatFlowSeries = []) {
  if (!heatFlowSeries.length) return [];
  const hoursMap = {};

  heatFlowSeries.forEach((comp) => {
    const compName = comp.component || comp.key || 'Unknown';
    const series = comp.heat_flow_series || comp.data || [];
    series.forEach((pt) => {
      if (!hoursMap[pt.hour]) {
        hoursMap[pt.hour] = { hour: pt.hour };
      }
      hoursMap[pt.hour][compName] = pt.value;
    });
  });

  return Object.values(hoursMap).sort((a, b) => a.hour - b.hour);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const hourNum = typeof label === 'number' ? label : parseFloat(label);
  const hourInt = Math.floor(hourNum);
  const minInt = Math.round((hourNum - hourInt) * 60);
  const timeStr = `${hourInt % 12 === 0 ? 12 : hourInt % 12}:${minInt === 0 ? '00' : minInt} ${hourInt < 12 ? 'AM' : 'PM'}`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">Time: {timeStr}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}:{' '}
          <span className="font-mono font-bold">
            {p.value > 0 ? '+' : ''}{p.value?.toFixed(1)} W
          </span>
          <span className="text-xs text-gray-400"> {p.value >= 0 ? '(gain)' : '(loss)'}</span>
        </p>
      ))}
    </div>
  );
};

export default function HeatFlowChart({ heatFlowSeries = [] }) {
  const data = buildData(heatFlowSeries);
  const compNames = heatFlowSeries.map((s) => s.component || s.key);

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="hour"
            tickFormatter={formatHour}
            ticks={[0, 6, 12, 18, 24]}
            label={{ value: 'Hour of Day', position: 'insideBottom', offset: -5, fontSize: 12 }}
          />
          <YAxis
            label={{ value: 'Heat Flow (W)', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend verticalAlign="top" />
          <ReferenceLine
            y={0}
            stroke="#64748b"
            strokeDasharray="4 2"
            label={{ value: 'Heat Loss / Gain (W)', position: 'insideTopLeft', fill: '#64748b', fontSize: 11 }}
          />
          {compNames.map((name) => {
            const color = COMPONENT_COLORS[name] || '#64748b';
            return (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={color}
                fill={color}
                fillOpacity={0.25}
                strokeWidth={2}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
