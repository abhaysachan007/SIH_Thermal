const DIRECTIONS = [
  { label: 'N',  deg: 0,   x: 50,  y: 8  },
  { label: 'NE', deg: 45,  x: 82,  y: 18 },
  { label: 'E',  deg: 90,  x: 92,  y: 50 },
  { label: 'SE', deg: 135, x: 82,  y: 82 },
  { label: 'S',  deg: 180, x: 50,  y: 92 },
  { label: 'SW', deg: 225, x: 18,  y: 82 },
  { label: 'W',  deg: 270, x: 8,   y: 50 },
  { label: 'NW', deg: 315, x: 18,  y: 18 },
];

function degToLabel(deg) {
  const d = DIRECTIONS.find(d => d.deg === deg);
  if (d) {
    const names = { N: 'North', NE: 'North-East', E: 'East', SE: 'South-East',
                    S: 'South', SW: 'South-West', W: 'West', NW: 'North-West' };
    return `${names[d.label]}-facing (${deg} deg)`;
  }
  return `${deg} deg`;
}

export default function CompassSelector({ value = 180, onChange }) {
  const rad = (deg) => (deg - 90) * (Math.PI / 180);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-44 h-44">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {/* Outer ring */}
          <circle cx="50" cy="50" r="46" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1.5" />
          {/* Inner ring */}
          <circle cx="50" cy="50" r="30" fill="white" stroke="#e2e8f0" strokeWidth="1" />

          {/* Sector highlights */}
          {DIRECTIONS.map(({ deg }) => {
            const startAngle = deg - 22.5;
            const endAngle = deg + 22.5;
            const r1 = 30, r2 = 46;
            const x1 = 50 + r2 * Math.cos(rad(startAngle));
            const y1 = 50 + r2 * Math.sin(rad(startAngle));
            const x2 = 50 + r2 * Math.cos(rad(endAngle));
            const y2 = 50 + r2 * Math.sin(rad(endAngle));
            const x3 = 50 + r1 * Math.cos(rad(endAngle));
            const y3 = 50 + r1 * Math.sin(rad(endAngle));
            const x4 = 50 + r1 * Math.cos(rad(startAngle));
            const y4 = 50 + r1 * Math.sin(rad(startAngle));
            const isSelected = value === deg;
            return (
              <path
                key={deg}
                d={`M ${x1} ${y1} A ${r2} ${r2} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${r1} ${r1} 0 0 0 ${x4} ${y4} Z`}
                fill={isSelected ? '#E67E22' : 'transparent'}
                stroke={isSelected ? '#E67E22' : 'transparent'}
                className="cursor-pointer hover:fill-accent/30 transition-colors"
                onClick={() => onChange(deg)}
              />
            );
          })}

          {/* Direction labels */}
          {DIRECTIONS.map(({ label, deg, x, y }) => (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={label.length === 1 ? '8' : '6'}
              fontWeight={value === deg ? 'bold' : 'normal'}
              fill={value === deg ? 'white' : label === 'N' ? '#ef4444' : '#475569'}
              className="cursor-pointer select-none"
              onClick={() => onChange(deg)}
            >
              {label}
            </text>
          ))}

          {/* Arrow pointing to selected direction */}
          {(() => {
            const angle = rad(value);
            const arrowLen = 22;
            const ex = 50 + arrowLen * Math.cos(angle);
            const ey = 50 + arrowLen * Math.sin(angle);
            return (
              <line
                x1="50" y1="50"
                x2={ex} y2={ey}
                stroke="#1B5E7B"
                strokeWidth="2"
                strokeLinecap="round"
                markerEnd="url(#arrowhead)"
              />
            );
          })()}

          {/* Center dot */}
          <circle cx="50" cy="50" r="3" fill="#1B5E7B" />

          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <polygon points="0 0, 6 3, 0 6" fill="#1B5E7B" />
            </marker>
          </defs>
        </svg>
      </div>
      <p className="text-sm font-bold text-primary">{degToLabel(value)}</p>
      <p className="text-xs text-gray-500">Click a sector to select orientation</p>
      <p className="text-xs text-accent font-semibold">Tip: South-facing orientation provides maximum passive solar gain</p>
    </div>
  );
}
