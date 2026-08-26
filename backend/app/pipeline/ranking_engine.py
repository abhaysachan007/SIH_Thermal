"""
app.pipeline.ranking_engine
===========================
Transparent, Explainable Multi-Objective Candidate Ranking.
Objectives:
  1. Maximize Thermal Comfort (Comfort hours + Min Indoor Temp protection)
  2. Minimize External Energy Requirement (Heating kWh)
  3. Minimize Relative Material Construction Cost
"""
from typing import List, Dict, Any, Tuple
from app.pipeline.models import CandidateShelter, ThermalMetrics, CandidateRankingResult, DesignSpaceConfig
from app.pipeline.material_repo import get_material_repo


def score_candidate(
    candidate: CandidateShelter,
    metrics: ThermalMetrics,
    config: DesignSpaceConfig = None
) -> Tuple[float, Dict[str, float], List[str]]:
    cfg = config or DesignSpaceConfig()
    w_comf = cfg.comfort_weight
    w_ene  = cfg.energy_weight
    w_cost = cfg.cost_weight

    notes = []

    # 1. Thermal Comfort Score (0-100)
    # Rewards comfort hours + maintains safe nighttime temperature above -5°C
    comfort_ratio = metrics.comfort_hours / 24.0
    min_t_norm = max(0.0, min(1.0, (metrics.min_indoor_temperature_c + 20.0) / 35.0)) # -20°C -> 0, +15°C -> 1
    s_comfort = 100.0 * (0.60 * comfort_ratio + 0.40 * min_t_norm)

    if metrics.comfort_hours >= 18.0:
        notes.append(f"Outstanding comfort: {metrics.comfort_hours:.0f}h ({metrics.comfort_percentage:.0f}%) inside 15-25°C range.")
    elif metrics.comfort_hours >= 10.0:
        notes.append(f"Moderate comfort: {metrics.comfort_hours:.0f}h inside comfort zone; nighttime low {metrics.min_indoor_temperature_c:.1f}°C.")
    else:
        notes.append(f"Low comfort hours ({metrics.comfort_hours:.0f}h); overnight dip to {metrics.min_indoor_temperature_c:.1f}°C.")

    # 2. Energy Efficiency Score (0-100)
    # Lower auxiliary heating kWh gives higher score
    energy_kwh = metrics.estimated_energy_requirement_kwh
    s_energy = max(0.0, 100.0 - (energy_kwh / max(1.0, candidate.geometry.floor_area_m2)) * 25.0)

    if energy_kwh < 15.0:
        notes.append(f"High passive retention: only {energy_kwh:.1f} kWh/day auxiliary heating needed.")
    else:
        notes.append(f"Requires ~{energy_kwh:.1f} kWh/day supplementary heating during extreme cold hours.")

    # 3. Material / Cost Index Score (0-100)
    mat_repo = get_material_repo()
    wall_vol = (candidate.geometry.length_m + candidate.geometry.width_m) * 2.0 * candidate.geometry.wall_height_m * candidate.wall_system.total_thickness_m
    m_out = mat_repo.get(candidate.wall_system.outer_layer.material_id)
    cost_index = wall_vol * float(m_out.get("cost_index_per_m3", 120.0))
    s_cost = max(10.0, min(100.0, 100.0 - (cost_index / 1000.0) * 15.0))

    # Overall Weighted Score
    total_score = round(w_comf * s_comfort + w_ene * s_energy + w_cost * s_cost, 2)

    breakdown = {
        "comfort_score": round(s_comfort, 2),
        "energy_score": round(s_energy, 2),
        "cost_score": round(s_cost, 2),
        "composite_score": total_score,
    }

    return total_score, breakdown, notes
