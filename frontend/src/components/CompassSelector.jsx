const DIRECTIONS = [
  { label: 'N',  deg: 0,   name: 'North' },
  { label: 'NE', deg: 45,  name: 'North-East' },
  { label: 'E',  deg: 90,  name: 'East' },
  { label: 'SE', deg: 135, name: 'South-East' },
  { label: 'S',  deg: 180, name: 'South' },
  { label: 'SW', deg: 225, name: 'South-West' },
  { label: 'W',  deg: 270, name: 'West' },
  { label: 'NW', deg: 315, name: 'North-West' },
];

export default function CompassSelector({ value = 180, onChange }) {
  const rad = (deg) => (deg - 90) * (Math.PI / 180);

  const selectedDir = DIRECTIONS.find(d => d.deg === value) || { label: `${value}°`, name: 'Custom Azimuth' };
  const isSouthOptimal = value === 180;

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {/* Precision Circular CAD Compass Gauge */}
      <div className="relative w-52 h-52 select-none">
        <svg viewBox="0 0 120 120" className="w-full h-full">
          {/* Subtle Outer CAD Dial */}
          <circle cx="60" cy="60" r="54" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />
          <circle cx="60" cy="60" r="48" fill="none" stroke="#1E293B" strokeWidth="1" strokeDasharray="2 3" />
          <circle cx="60" cy="60" r="32" fill="#1E293B" stroke="#334155" strokeWidth="1" />

          {/* Tick marks every 30 degrees */}
          {Array.from({ length: 24 }).map((_, i) => {
            const deg = i * 15;
            const isMajor = deg % 45 === 0;
            const rOuter = 53;
            const rInner = isMajor ? 46 : 50;
            const angle = rad(deg);
            const x1 = 60 + rOuter * Math.cos(angle);
            const y1 = 60 + rOuter * Math.sin(angle);
            const x2 = 60 + rInner * Math.cos(angle);
            const y2 = 60 + rInner * Math.sin(angle);
            return (
              <line
                key={deg}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isMajor ? (deg === 180 ? '#F97316' : '#94A3B8') : '#475569'}
                strokeWidth={isMajor ? 1.5 : 0.8}
              />
            );
          })}

          {/* Interactive Sectors */}
          {DIRECTIONS.map(({ deg }) => {
            const startAngle = deg - 22.5;
            const endAngle = deg + 22.5;
            const r1 = 32, r2 = 53;
            const x1 = 60 + r2 * Math.cos(rad(startAngle));
            const y1 = 60 + r2 * Math.sin(rad(startAngle));
            const x2 = 60 + r2 * Math.cos(rad(endAngle));
            const y2 = 60 + r2 * Math.sin(rad(endAngle));
            const x3 = 60 + r1 * Math.cos(rad(endAngle));
            const y3 = 60 + r1 * Math.sin(rad(endAngle));
            const x4 = 60 + r1 * Math.cos(rad(startAngle));
            const y4 = 60 + r1 * Math.sin(rad(startAngle));
            const isSelected = value === deg;

            return (
              <path
                key={deg}
                d={`M ${x1} ${y1} A ${r2} ${r2} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${r1} ${r1} 0 0 0 ${x4} ${y4} Z`}
                fill={isSelected ? 'rgba(2, 132, 199, 0.45)' : 'transparent'}
                stroke={isSelected ? '#38BDF8' : 'transparent'}
                strokeWidth="1"
                className="cursor-pointer hover:fill-sky-500/20 transition-all"
                onClick={() => onChange(deg)}
              />
            );
          })}

          {/* Cardinal Direction Text Labels */}
          {DIRECTIONS.map(({ label, deg }) => {
            const angle = rad(deg);
            const rText = 40;
            const tx = 60 + rText * Math.cos(angle);
            const ty = 60 + rText * Math.sin(angle);
            const isSelected = value === deg;

            return (
              <text
                key={label}
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={label.length === 1 ? '7.5' : '5.5'}
                fontFamily="JetBrains Mono, monospace"
                fontWeight={isSelected ? 'bold' : '600'}
                fill={isSelected ? '#38BDF8' : label === 'N' ? '#F43F5E' : label === 'S' ? '#F97316' : '#94A3B8'}
                className="cursor-pointer select-none"
                onClick={() => onChange(deg)}
              >
                {label}
              </text>
            );
          })}

          {/* Precision Needle pointing to active azimuth */}
          {(() => {
            const angle = rad(value);
            const needleLen = 30;
            const nx = 60 + needleLen * Math.cos(angle);
            const ny = 60 + needleLen * Math.sin(angle);

            // Tail pointing opposite
            const oppAngle = angle + Math.PI;
            const tx = 60 + 10 * Math.cos(oppAngle);
            const ty = 60 + 10 * Math.sin(oppAngle);

            return (
              <g>
                <line x1={tx} y1={ty} x2={nx} y2={ny} stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" />
                <circle cx={nx} cy={ny} r="3" fill="#0284C7" stroke="#BAE6FD" strokeWidth="1.5" />
              </g>
            );
          })()}

          {/* Center Hub */}
          <circle cx="60" cy="60" r="5" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
          <circle cx="60" cy="60" r="2" fill="#38BDF8" />
        </svg>
      </div>

      {/* Selected Azimuth Telemetry Pill */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white font-mono text-sm border border-slate-800 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          <span className="font-bold">{value}° {selectedDir.name}</span>
          <span className="text-xs text-slate-400 font-sans">Primary Facade</span>
        </div>

        {isSouthOptimal ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-medium">
            <svg className="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Optimal solar orientation for Ladakh winter peak gain
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Click azimuth sector or select presets below
          </p>
        )}
      </div>

      {/* Preset Quick-Buttons */}
      <div className="flex flex-wrap justify-center gap-1.5 pt-1">
        {DIRECTIONS.map(({ label, deg, name }) => (
          <button
            key={deg}
            type="button"
            onClick={() => onChange(deg)}
            className={`px-2.5 py-1 rounded-md font-mono text-xs transition-all border ${
              value === deg
                ? 'bg-slate-900 text-sky-400 border-slate-700 shadow-sm font-bold'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {label} ({deg}°)
          </button>
        ))}
      </div>
    </div>
  );
}
