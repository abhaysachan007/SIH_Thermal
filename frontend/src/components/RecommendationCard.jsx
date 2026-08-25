function deriveInsights(reasons = []) {
  const insights = [];
  reasons.forEach((r) => {
    const lower = String(r).toLowerCase();
    if (lower.includes('temp') || lower.includes('deg') || lower.includes('celsius') || lower.includes('°c')) {
      insights.push('Warmer nights mean you can reduce firewood consumption significantly.');
    }
    if (lower.includes('solar') || lower.includes('kwh') || lower.includes('gain')) {
      insights.push('Better solar gain passively heats the shelter without active heating systems.');
    }
    if (lower.includes('loss') || lower.includes('insul') || lower.includes('heat')) {
      insights.push('Reduced heat loss means less energy needed to maintain comfortable temperatures.');
    }
  });

  if (insights.length === 0) {
    insights.push('This design keeps interior temperatures significantly higher than outside on cold Ladakh nights.');
    insights.push('Lower heat loss means you will need less firewood or active heating.');
    insights.push('Improved solar gain passively warms the shelter during the day, reducing energy costs.');
  }

  return [...new Set(insights)].slice(0, 3);
}

export default function RecommendationCard({ recommendationText, reasons = [], bestLabel }) {
  const insights = deriveInsights(reasons);

  return (
    <div className="border-l-4 border-accent rounded-xl bg-white shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-accent/10 to-primary/10 px-6 py-5">
        <span className="inline-block px-2.5 py-0.5 rounded bg-accent text-white text-xs font-bold uppercase tracking-wider mb-2">
          RECOMMENDED DESIGN
        </span>
        <h3 className="text-2xl font-bold text-primary">
          {bestLabel || 'Recommended Design'}
        </h3>
      </div>

      <div className="px-6 py-5 space-y-5">
        {recommendationText && (
          <p className="text-gray-700 leading-relaxed font-medium">{recommendationText}</p>
        )}

        {reasons.length > 0 && (
          <div>
            <h4 className="font-bold text-primary mb-2 text-sm uppercase tracking-wide">
              Why this design performs best:
            </h4>
            <ul className="space-y-1.5">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-success font-bold mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-primary/5 rounded-lg p-4 border border-primary/10">
          <h4 className="font-bold text-primary mb-2 text-sm uppercase tracking-wide">
            Practical Takeaways:
          </h4>
          <ul className="space-y-1.5">
            {insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-accent font-bold mt-0.5">-</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
