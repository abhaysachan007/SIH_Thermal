import { useState } from 'react';

function deriveInsights(reasons = []) {
  const insights = [];
  reasons.forEach((r) => {
    const lower = String(r).toLowerCase();
    if (lower.includes('temp') || lower.includes('deg') || lower.includes('celsius') || lower.includes('°c')) {
      insights.push('Nighttime thermal inertia significantly minimizes supplementary heating energy demand.');
    }
    if (lower.includes('solar') || lower.includes('kwh') || lower.includes('gain')) {
      insights.push('High solar aperture passively charges internal thermal mass without mechanical equipment.');
    }
    if (lower.includes('loss') || lower.includes('insul') || lower.includes('heat')) {
      insights.push('Low envelope U-value prevents thermal bridge dissipation during sub-zero overnight conditions.');
    }
  });

  if (insights.length === 0) {
    insights.push('High-thermal-mass building envelope retains heat during -20°C high-altitude winter conditions.');
    insights.push('Low envelope transmission loss substantially reduces auxiliary heating fuel requirements.');
    insights.push('South solar direct gain provides natural daytime thermal recharge.');
  }

  return [...new Set(insights)].slice(0, 3);
}

export default function RecommendationCard({
  recommendationText,
  reasons = [],
  bestLabel,
  recommendationSummary,
}) {
  const [showWhy, setShowWhy] = useState(false);
  const insights = deriveInsights(reasons);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden space-y-0">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="inline-block px-2 py-0.5 rounded bg-sky-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider mb-1">
            ARCHITECTURAL SPECIFICATION
          </span>
          <h3 className="text-xl font-bold font-sans tracking-tight text-white">
            {bestLabel || 'Recommended Optimal Envelope'}
          </h3>
        </div>
        <div className="text-left sm:text-right text-xs font-mono text-slate-400">
          <span>Passivhaus Standard</span>
          <span className="block text-sky-400 font-semibold">High Altitude Certified</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {recommendationSummary && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 space-y-3">
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-sky-950">
              Best Candidate Design
            </h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm text-slate-800">
              <div><span className="text-slate-500">Wall material:</span> {recommendationSummary.wall_material}</div>
              <div><span className="text-slate-500">Roof material:</span> {recommendationSummary.roof_material}</div>
              <div><span className="text-slate-500">Orientation:</span> {recommendationSummary.orientation}</div>
              <div><span className="text-slate-500">Comfort hours:</span> {recommendationSummary.comfort_hours} h</div>
              <div><span className="text-slate-500">Minimum indoor:</span> {Number(recommendationSummary.min_indoor_temp_c).toFixed(1)}°C</div>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{recommendationSummary.reason}</p>
            <div className="border-t border-sky-200 pt-3">
              <button
                type="button"
                onClick={() => setShowWhy((shown) => !shown)}
                aria-expanded={showWhy}
                className="text-sm font-semibold text-sky-800 hover:text-sky-950"
              >
                {showWhy ? 'Hide' : 'Why this design?'}
              </button>
              {showWhy && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  <li>{recommendationSummary.wall_material} walls retain heat longer due to high thermal mass.</li>
                  <li>{recommendationSummary.orientation}-facing glazing maximizes winter solar capture.</li>
                  <li>This configuration provides {recommendationSummary.comfort_hours} hours of comfortable indoor temperature per day.</li>
                </ul>
              )}
            </div>
          </div>
        )}

        {recommendationText && (
          <p className="text-sm text-slate-700 leading-relaxed font-sans">
            {recommendationText}
          </p>
        )}

        {reasons.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-mono text-xs font-bold text-slate-900 uppercase tracking-wider">
              Key Thermodynamic Rationale:
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-600 mt-1.5 shrink-0" />
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-sky-50/60 rounded-xl p-4 border border-sky-200/80 space-y-2">
          <h4 className="font-mono text-xs font-bold text-sky-950 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-600" />
            Field Implementation Takeaways:
          </h4>
          <ul className="space-y-1.5 pl-1">
            {insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                <span className="text-sky-600 font-bold mt-0.5 font-mono">→</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
