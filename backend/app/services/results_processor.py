"""Post-processes raw FDM engine output into enriched SimulationResult fields."""

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))

def process_raw_results(raw: dict) -> dict:
    inside_series = raw.get('inside_temperature_series', [])
    solar_series = raw.get('solar_gain_series', [])
    heat_flow_series = raw.get('heat_flow_series', [])

    temps = [p['value'] for p in inside_series]
    peak_temp = max(temps) if temps else 0.0
    min_temp = min(temps) if temps else 0.0
    avg_temp = sum(temps) / len(temps) if temps else 0.0

    # Comfort hours: inside temperature >= 12?C (practical mountain comfort target)
    comfort_count = sum(1 for t in temps if t >= 12.0)
    comfort_hours = comfort_count * 0.5

    # Total useful solar gain into space (kWh)
    total_solar_wh = sum(max(0.0, p['value']) for p in solar_series) * 0.5
    total_solar_kwh = total_solar_wh / 1000.0

    # Total heat loss through envelope (kWh)
    total_loss_wh = 0.0
    for component in heat_flow_series:
        for p in component['heat_flow_series']:
            if p['value'] < 0:
                total_loss_wh += abs(p['value']) * 0.5
    total_loss_kwh = total_loss_wh / 1000.0

    # Thermal efficiency score (0-100 composite):
    # 1. Warmth retention / minimum overnight inside temp (-20C to +15C mapped to 0-100)
    temp_score = _clamp((min_temp - (-20.0)) / (15.0 - (-20.0)) * 100.0, 0.0, 100.0)
    # 2. Average inside temperature (-15C to +20C mapped to 0-100)
    avg_score = _clamp((avg_temp - (-15.0)) / (20.0 - (-15.0)) * 100.0, 0.0, 100.0)
    # 3. Solar capture (0 to 30 kWh/day mapped to 0-100)
    gain_score = _clamp(total_solar_kwh / 25.0 * 100.0, 0.0, 100.0)
    # 4. Low heat loss (lower loss = higher score, e.g. 50 kWh loss -> 0, 0 loss -> 100)
    loss_score = _clamp((1.0 - total_loss_kwh / 40.0) * 100.0, 0.0, 100.0)
    # 5. Diurnal temperature swing stability (swing < 10C is ideal)
    swing = max(0.1, peak_temp - min_temp)
    stability_score = _clamp((1.0 - swing / 30.0) * 100.0, 0.0, 100.0)

    efficiency_score = round(
        0.30 * temp_score +
        0.25 * avg_score +
        0.20 * gain_score +
        0.15 * loss_score +
        0.10 * stability_score,
        1
    )

    ambient_series = raw.get('ambient_temperature_series', [])
    amb_temps = [p['value'] for p in ambient_series]
    min_amb = min(amb_temps) if amb_temps else -20.0
    max_amb = max(amb_temps) if amb_temps else 3.5
    avg_amb = sum(amb_temps) / len(amb_temps) if amb_temps else -10.0

    # Temperature difference (Inside vs Outside) and Temperature Drop metrics
    inside_temp_drop = round(peak_temp - min_temp, 2)
    outside_temp_drop = round(max_amb - min_amb, 2)

    diffs = [temps[i] - amb_temps[i] for i in range(min(len(temps), len(amb_temps)))]
    max_temp_diff = round(max(diffs), 2) if diffs else round(peak_temp - min_amb, 2)
    min_temp_diff = round(min(diffs), 2) if diffs else round(min_temp - max_amb, 2)
    avg_temp_diff = round(sum(diffs) / len(diffs), 2) if diffs else round(avg_temp - avg_amb, 2)

    # Thermal damping ratio (% of outside freeze fluctuation eliminated)
    thermal_damping_ratio = round(
        max(0.0, min(100.0, (1.0 - inside_temp_drop / max(0.1, outside_temp_drop)) * 100.0)),
        1
    )

    raw.update({
        'peak_inside_temp_C': round(peak_temp, 2),
        'min_inside_temp_C': round(min_temp, 2),
        'avg_inside_temp_C': round(avg_temp, 2),
        'min_ambient_temp_C': round(min_amb, 2),
        'max_ambient_temp_C': round(max_amb, 2),
        'avg_ambient_temp_C': round(avg_amb, 2),
        'inside_temp_drop_C': inside_temp_drop,
        'outside_temp_drop_C': outside_temp_drop,
        'max_temp_diff_C': max_temp_diff,
        'min_temp_diff_C': min_temp_diff,
        'avg_temp_diff_C': avg_temp_diff,
        'thermal_damping_ratio_pct': thermal_damping_ratio,
        'comfort_hours': int(comfort_hours),
        'total_solar_gain_kwh': round(total_solar_kwh, 3),
        'total_heat_loss_kwh': round(total_loss_kwh, 3),
        'efficiency_score': efficiency_score,
    })
    return raw

