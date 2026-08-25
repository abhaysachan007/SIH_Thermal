"""Recommendation engine: ranks simulation results and generates plain-language advice."""

def generate_recommendation(results: list) -> dict:
    if not results:
        return {
            'best_variant_label': None,
            'recommendation_text': 'No results to compare.',
            'recommendation_reasons': [],
        }

    sorted_results = sorted(results, key=lambda r: r.get('efficiency_score', 0), reverse=True)
    best = sorted_results[0]
    second = sorted_results[1] if len(sorted_results) > 1 else None

    best_label = best.get('variant_label', 'Best Design')
    best_score = best.get('efficiency_score', 0)
    best_min_temp = best.get('min_inside_temp_C', 0)
    best_solar = best.get('total_solar_gain_kwh', 0)
    best_loss = best.get('total_heat_loss_kwh', 0)
    best_comfort = best.get('comfort_hours', 0)

    rec_text = (
        f"The **{best_label}** design achieves the best overall thermal performance "
        f"with an efficiency score of {best_score:.0f}/100. "
        f"It maintains a minimum overnight temperature of {best_min_temp:.1f}\u00b0C, "
        f"captures {best_solar:.1f} kWh of solar energy, and provides "
        f"{best_comfort} hours above the 15\u00b0C comfort threshold."
    )

    reasons = [
        f"Highest thermal efficiency score: {best_score:.0f}/100",
        f"Minimum overnight inside temperature: {best_min_temp:.1f}\u00b0C",
        f"Total solar energy captured: {best_solar:.2f} kWh",
        f"Total heat loss: {best_loss:.2f} kWh",
        f"Comfort hours (above 15\u00b0C): {best_comfort:.0f} hours",
    ]

    if second:
        second_label = second.get('variant_label', 'Next Design')
        second_min = second.get('min_inside_temp_C', 0)
        second_score = second.get('efficiency_score', 0)
        temp_diff = best_min_temp - second_min
        score_diff = best_score - second_score
        if temp_diff != 0:
            direction = 'warmer' if temp_diff > 0 else 'cooler'
            reasons.append(
                f"{abs(temp_diff):.1f}\u00b0C {direction} overnight than {second_label} (score: {second_score:.0f})"
            )
        if score_diff > 0:
            reasons.append(
                f"{score_diff:.0f} points higher efficiency than {second_label}"
            )

    return {
        'best_variant_label': best_label,
        'recommendation_text': rec_text,
        'recommendation_reasons': reasons,
    }
