import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
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

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const hourNum = typeof label === 'number' ? label : parseFloat(label);
  const hourInt = Math.floor(hourNum);
  const minInt = Math.round((hourNum - hourInt) * 60);
  const timeStr = `${String(hourInt).padStart(2, '0')}:${String(minInt).padStart(2, '0')}`;

  return (
    <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-2.5 text-xs font-mono text-white min-w-[150px]">
      <p className="text-slate-400 text-[10px]">TIME: {timeStr}h</p>
      <p className="text-amber-400 font-bold text-sm mt-0.5">
        +{payload[0]?.value?.toFixed(1)} W <span className="text-[10px] text-slate-400 font-normal">Flux</span>
      </p>
    </div>
  );
};

export default function SolarGainChart({ solarGainSeries = [], totalKwh }) {
  const data = solarGainSeries.map((pt) => ({ hour: pt.hour, solar: pt.value }));

  return (
    <div className="w-full space-y-3">
      {/* Header Metric Pill */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
        <div>
          <span className="text-xs font-mono font-bold text-slate-700 uppercase">Daily Solar Irradiation Capture</span>
          <p className="text-[11px] text-slate-500">Direct beam + sky diffuse flux entering south fenestrations</p>
        </div>
        <div className="text-right">
          <span className="text-xl font-bold font-mono text-amber-600">
            {totalKwh != null ? `${Number(totalKwh).toFixed(2)} kWh` : '— kWh'}
          </span>
          <span className="text-[10px] font-mono text-slate-400 block -mt-0.5">Cumulative Daily Yield</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 10, right: 25, left: 0, bottom: 10 }}>
          <defs>
            <linearGradient id="solarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#EA580C" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#EA580C" stopOpacity={0.02} />
            </linearGradient>
          </defs>
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
          <Area
            type="monotone"
            dataKey="solar"
            name="Solar Radiation Flux"
            stroke="#EA580C"
            strokeWidth={2}
            fill="url(#solarGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
