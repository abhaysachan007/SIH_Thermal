import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const COMPONENT_COLORS = {
  'South Wall': '#0284C7',
  'North Wall': '#1E293B',
  'East Wall':  '#38BDF8',
  'West Wall':  '#0EA5E9',
  'Roof':       '#EA580C',
  'Floor':      '#8B5CF6',
  'Openings':   '#059669',
};

const formatHour = (h) => {
  const rounded = Math.round(h);
  if (rounded === 0 || rounded === 24) return '00:00';
  if (rounded === 6) return '06:00';
  if (rounded === 12) return '12:00';
  if (rounded === 18) return '18:00';
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
  const timeStr = `${String(hourInt).padStart(2, '0')}:${String(minInt).padStart(2, '0')}`;

  return (
    <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-3 text-xs font-mono text-white min-w-[200px]">
      <p className="text-slate-400 border-b border-slate-800 pb-1 mb-1.5 font-bold flex justify-between">
        <span>TIME:</span>
        <span className="text-sky-400">{timeStr}h</span>
      </p>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">{p.name}:</span>
            <span className="font-bold font-mono" style={{ color: p.color }}>
              {p.value > 0 ? '+' : ''}{p.value?.toFixed(1)} W
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function HeatFlowChart({ heatFlowSeries = [] }) {
  const data = buildData(heatFlowSeries);
  const compNames = heatFlowSeries.map((s) => s.component || s.key);

  return (
    <div className="w-full pt-2">
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={data} margin={{ top: 15, right: 25, left: 0, bottom: 10 }}>
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
            unit=" W"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontFamily: 'monospace' }}
          />
          <ReferenceLine
            y={0}
            stroke="#64748B"
            strokeWidth={1.5}
            label={{ value: 'Equilibrium (0 W)', position: 'insideTopLeft', fill: '#64748B', fontSize: 10, fontFamily: 'monospace' }}
          />
          {compNames.map((name) => {
            const color = COMPONENT_COLORS[name] || '#64748B';
            return (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={color}
                fill={color}
                fillOpacity={0.25}
                strokeWidth={1.8}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
