import { useState } from 'react';

const COLUMNS = [
  { key: 'label',          label: 'Design Name',           align: 'left'  },
  { key: 'avg_inside_temp',label: 'Avg Temp (?C)',         align: 'right' },
  { key: 'min_temp',       label: 'Min Temp (?C)',         align: 'right' },
  { key: 'total_solar_kwh',label: 'Solar Gain (kWh)',      align: 'right' },
  { key: 'total_heat_loss',label: 'Heat Loss (kWh)',       align: 'right' },
  { key: 'efficiency_score',label: 'Score / 100',          align: 'right' },
  { key: 'comfort_hours',  label: 'Comfort Hours',         align: 'right' },
];

function getValue(row, key) {
  return row[key] ?? row?.summary?.[key] ?? '-';
}

function formatCell(key, val) {
  if (val === null || val === undefined || val === '-') return '-';
  if (['avg_inside_temp', 'min_temp'].includes(key)) return `${Number(val).toFixed(1)}?C`;
  if (['total_solar_kwh', 'total_heat_loss'].includes(key)) return `${Number(val).toFixed(2)} kWh`;
  if (key === 'efficiency_score') return `${Number(val).toFixed(1)}`;
  if (key === 'comfort_hours') return `${Number(val).toFixed(0)} h`;
  return String(val);
}

export default function ComparisonTable({ results = [], bestVariantLabel }) {
  const [sortKey, setSortKey] = useState('efficiency_score');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sorted = [...results].sort((a, b) => {
    const va = getValue(a, sortKey);
    const vb = getValue(b, sortKey);
    const na = parseFloat(va);
    const nb = parseFloat(vb);
    const cmp = isNaN(na) || isNaN(nb) ? String(va).localeCompare(String(vb)) : na - nb;
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-primary text-white">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`px-4 py-3 font-semibold cursor-pointer select-none whitespace-nowrap hover:bg-primary-light transition-colors text-${col.align}`}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1 text-xs">{sortAsc ? '(ASC)' : '(DESC)'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const isBest = row.label === bestVariantLabel || row.design_name === bestVariantLabel;
            return (
              <tr
                key={i}
                className={`border-b border-gray-100 transition-colors ${
                  isBest
                    ? 'bg-green-50 font-bold'
                    : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                } hover:bg-blue-50`}
              >
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-${col.align} ${isBest && col.key === 'label' ? 'text-success' : 'text-gray-700'}`}
                  >
                    {col.key === 'label' && isBest && (
                      <span className="mr-2 px-1.5 py-0.5 bg-success text-white rounded text-xs font-bold">BEST</span>
                    )}
                    {formatCell(col.key, getValue(row, col.key))}
                  </td>
                ))}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="text-center py-8 text-gray-400">
                No comparison data available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
