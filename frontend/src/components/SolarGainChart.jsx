import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const formatHour = (h) => {
  const rounded = Math.round(h);
  if (rounded === 0 || rounded === 24) return '12 AM';
  if (rounded === 6) return '6 AM';
  if (rounded === 12) return '12 PM';
  if (rounded === 18) return '6 PM';
  return '';
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const hourNum = typeof label === 'number' ? label : parseFloat(label);
  const hourInt = Math.floor(hourNum);
  const minInt = Math.round((hourNum - hourInt) * 60);
  const timeStr = `${hourInt % 12 === 0 ? 12 : hourInt % 12}:${minInt === 0 ? '00' : minInt} ${hourInt < 12 ? 'AM' : 'PM'}`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow p-3 text-sm">
      <p className="font-semibold text-gray-700">Time: {timeStr}</p>
      <p className="text-orange-600 font-bold">{payload[0]?.value?.toFixed(1)} W</p>
    </div>
  );
};

export default function SolarGainChart({ solarGainSeries = [], totalKwh }) {
  const data = solarGainSeries.map((pt) => ({ hour: pt.hour, solar: pt.value }));

  return (
    <div className="w-full">
      <div className="text-center mb-4">
        <span className="text-4xl font-bold text-accent">
          {totalKwh != null ? `${Number(totalKwh).toFixed(2)} kWh` : '- kWh'}
        </span>
        <p className="text-sm text-gray-500 mt-1 font-medium">Total useful solar energy captured today</p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
          <defs>
            <linearGradient id="solarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F39C12" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#F39C12" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="hour"
            tickFormatter={formatHour}
            ticks={[0, 6, 12, 18, 24]}
            label={{ value: 'Hour of Day', position: 'insideBottom', offset: -5, fontSize: 12 }}
          />
          <YAxis
            label={{ value: 'Solar Gain (W)', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="solar"
            name="Solar Gain"
            stroke="#E67E22"
            strokeWidth={2}
            fill="url(#solarGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
