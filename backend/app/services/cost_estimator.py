"""
cost_estimator.py — Material cost and heating-cost-savings estimation.

Adds real-world feasibility numbers on top of the thermal result:
  * Bill of materials cost (INR) from the shelter geometry and chosen
    materials, using representative Ladakh/Indian construction rates.
  * Annual space-heating energy and cost to hold a comfort setpoint,
    derived from the simulated envelope heat loss.
  * Percentage heating-cost reduction versus an uninsulated single-skin
    stone baseline, i.e. what the passive design actually saves.

All rates are transparent, documented constants — adjust in one place.
"""
from typing import Optional

# Representative delivered+placed material cost, INR per cubic metre of
# finished construction (labour + material, rough Ladakh/high-altitude rates).
MATERIAL_COST_INR_PER_M3 = {
    "mud_brick": 3000,
    "rammed_earth": 2500,
    "dense_concrete": 8000,
    "granite_stone": 6000,
    "limestone_stone": 5000,
    "eps_insulation": 4000,
    "mineral_wool": 5000,
    "mud_eps_composite": 5500,
    "concrete_wool_composite": 9000,
    "trombe_wall": 8500,
    "softwood_timber": 12000,
    "compressed_earth_block": 3500,
}
DEFAULT_COST_INR_PER_M3 = 4000

# Glazing cost, INR per square metre (supply + fitting).
GLAZING_COST_INR_PER_M2 = {
    "single_glazing": 800,
    "double_glazing": 2500,
    "polycarbonate": 1500,
}
DEFAULT_GLAZING_COST_INR_PER_M2 = 1200

# Economics of heating.
ELECTRICITY_INR_PER_KWH = 7.0      # grid/diesel-backed rate, high-altitude
WINTER_HEATING_DAYS = 150          # Ladakh cold-season heating days per year
COMFORT_SETPOINT_C = 18.0
BASELINE_U_VALUE = 2.2             # uninsulated single-skin stone (W/m^2K)


def _material_cost(mat_id: str) -> float:
    return MATERIAL_COST_INR_PER_M3.get(mat_id, DEFAULT_COST_INR_PER_M3)


def estimate_costs(shelter_input, raw_result: dict) -> dict:
    """Return a cost/feasibility summary dict to merge into the result."""
    L = float(getattr(shelter_input, "length_m", 6.0))
    W = float(getattr(shelter_input, "width_m", 4.0))
    H = float(getattr(shelter_input, "height_m", 3.0))
    wthk = float(getattr(shelter_input, "wall_thickness_m", 0.30))
    rthk = float(getattr(shelter_input, "roof_thickness_m", 0.20))
    fthk = float(getattr(shelter_input, "floor_thickness_m", 0.15))

    wall_mat = getattr(shelter_input, "wall_material_id", "mud_brick")
    roof_mat = getattr(shelter_input, "roof_material_id", "mud_brick")
    floor_mat = getattr(shelter_input, "floor_material_id", "rammed_earth")

    # Envelope solid volumes (m^3).
    wall_volume = 2.0 * (L + W) * H * wthk
    roof_volume = (L + 2 * wthk) * (W + 2 * wthk) * rthk
    floor_volume = L * W * fthk

    wall_cost = wall_volume * _material_cost(wall_mat)
    roof_cost = roof_volume * _material_cost(roof_mat)
    floor_cost = floor_volume * _material_cost(floor_mat)

    # Glazing cost from openings.
    glazing_cost = 0.0
    glazing_area = 0.0
    for op in (getattr(shelter_input, "openings", []) or []):
        is_window = (op.get("type") if isinstance(op, dict) else getattr(op, "type", "")) == "window"
        if not is_window:
            continue
        w = float(op.get("width_m", 1.0) if isinstance(op, dict) else getattr(op, "width_m", 1.0))
        h = float(op.get("height_m", 1.2) if isinstance(op, dict) else getattr(op, "height_m", 1.2))
        cnt = int(op.get("count", 1) if isinstance(op, dict) else getattr(op, "count", 1))
        gid = (op.get("glazing_material_id", "single_glazing") if isinstance(op, dict)
               else getattr(op, "glazing_material_id", "single_glazing"))
        area = w * h * cnt
        glazing_area += area
        glazing_cost += area * GLAZING_COST_INR_PER_M2.get(gid, DEFAULT_GLAZING_COST_INR_PER_M2)

    material_cost = wall_cost + roof_cost + floor_cost + glazing_cost

    # Annual heating: energy to replace envelope loss over the heating season.
    # Prefer the simulated daily envelope loss; fall back to a U-value estimate.
    daily_loss_kwh = raw_result.get("total_heat_loss_kwh")
    envelope_area = 2.0 * (L + W) * H + L * W  # walls + roof footprint
    if daily_loss_kwh is None or daily_loss_kwh <= 0:
        avg_amb = raw_result.get("avg_ambient_temp_C", -10.0)
        u_design = 1.0 / max(0.05, wthk / 0.6)  # crude fallback U from thickness
        daily_loss_kwh = u_design * envelope_area * max(0.0, COMFORT_SETPOINT_C - avg_amb) * 24 / 1000.0

    annual_heating_kwh = daily_loss_kwh * WINTER_HEATING_DAYS
    annual_heating_cost = annual_heating_kwh * ELECTRICITY_INR_PER_KWH

    # Savings vs an uninsulated single-skin stone baseline of the same size.
    avg_amb = raw_result.get("avg_ambient_temp_C", -10.0)
    baseline_daily_kwh = (BASELINE_U_VALUE * envelope_area
                          * max(0.0, COMFORT_SETPOINT_C - avg_amb) * 24 / 1000.0)
    baseline_annual_cost = baseline_daily_kwh * WINTER_HEATING_DAYS * ELECTRICITY_INR_PER_KWH
    if baseline_annual_cost > 0:
        savings_pct = max(0.0, min(95.0, (1.0 - annual_heating_cost / baseline_annual_cost) * 100.0))
        annual_savings_inr = max(0.0, baseline_annual_cost - annual_heating_cost)
    else:
        savings_pct = 0.0
        annual_savings_inr = 0.0

    return {
        "cost_estimate": {
            "material_cost_inr": round(material_cost),
            "wall_cost_inr": round(wall_cost),
            "roof_cost_inr": round(roof_cost),
            "floor_cost_inr": round(floor_cost),
            "glazing_cost_inr": round(glazing_cost),
            "glazing_area_m2": round(glazing_area, 2),
            "annual_heating_kwh": round(annual_heating_kwh),
            "annual_heating_cost_inr": round(annual_heating_cost),
            "baseline_annual_cost_inr": round(baseline_annual_cost),
            "annual_savings_inr": round(annual_savings_inr),
            "heating_cost_savings_pct": round(savings_pct, 1),
            "assumptions": {
                "electricity_inr_per_kwh": ELECTRICITY_INR_PER_KWH,
                "winter_heating_days": WINTER_HEATING_DAYS,
                "comfort_setpoint_C": COMFORT_SETPOINT_C,
                "baseline": "Uninsulated single-skin stone (U=2.2 W/m^2K)",
            },
        }
    }
