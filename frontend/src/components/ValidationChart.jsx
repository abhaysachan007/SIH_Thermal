import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

export default function ValidationChart({ data = [] }) {
  return (
    <div className="w-full pt-2">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="hour"
            ticks={[0, 3, 6, 9, 12, 15, 18, 21, 23]}
            tickFormatter={(hour) => `${String(hour).padStart(2, '0')}:00`}
            tick={{ fontSize: 11, fontFamily: 'monospace', fill: '#64748B' }}
            stroke="#CBD5E1"
          />
          <YAxis
            tick={{ fontSize: 11, fontFamily: 'monospace', fill: '#64748B' }}
            stroke="#CBD5E1"
            domain={['auto', 'auto']}
            unit="°C"
          />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(2)}°C`, name]}
            labelFormatter={(hour) => `${String(hour).padStart(2, '0')}:00`}
          />
          <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '12px', fontSize: '11px' }} />
          <Line
            type="monotone"
            dataKey="simulated_temp_c"
            name="Simulated"
            stroke="#0284C7"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="measured_temp_c"
            name="Measured"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
