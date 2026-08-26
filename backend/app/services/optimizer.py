"""
AI Auto-Optimizer for Ladakh Passive Shelter Design
"""
import asyncio, logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

WALL_CANDIDATES = [
    ("mud_brick",               "Mud Brick",               1.0),
    ("stone_masonry",           "Stone Masonry",           1.2),
    ("rammed_earth",            "Rammed Earth",            0.9),
    ("insulation_eps",          "Insulated EPS Assembly",  1.5),
]
ROOF_CANDIDATES = [
    ("mud_brick", "Mud Brick"),
]
THICKNESS_CANDIDATES = [0.20, 0.30, 0.40]
WINDOW_CANDIDATES = [1, 2, 3]
ORIENTATION_CANDIDATES = [180]  # South-facing is strictly optimal for Ladakh
GLAZING_DEFAULT = "double_glazing"
FLOOR_DEFAULT   = "rammed_earth"


def _score(result: dict, thickness: float) -> float:
    min_t   = float(result.get("min_inside_temp_C", -30))
    comfort = float(result.get("comfort_hours", 0))
    eff     = float(result.get("energy_efficiency_score", 50))
    warmth  = max(0.0, min(1.0, (min_t + 25.0) / 45.0))
    return round(0.40*warmth + 0.30*(comfort/24) + 0.20*(eff/100) - 0.10*(thickness/0.60), 4)


def _make_candidate(base, wall_id, wall_label, wall_cost, roof_id, thickness, n_win, orient):
    return {
        "shape":            getattr(base, "shape", "rectangular"),
        "length_m":         float(getattr(base, "length_m", 6.0)),
        "width_m":          float(getattr(base, "width_m", 4.0)),
        "height_m":         float(getattr(base, "height_m", 3.0)),
        "wall_material_id": wall_id,
        "wall_thickness_m": thickness,
        "roof_material_id": roof_id,
        "roof_thickness_m": 0.20,
        "floor_material_id": FLOOR_DEFAULT,
        "floor_thickness_m": 0.15,
        "openings": [
            {"type":"window","count":n_win,"width_m":1.2,"height_m":1.2,"glazing_material_id":GLAZING_DEFAULT},
            {"type":"door","count":1,"width_m":0.9,"height_m":2.1,"glazing_material_id":"single_glazing"},
        ],
        "orientation_deg":  orient,
        "climate_profile_id": getattr(base, "climate_profile_id", "ladakh_winter"),
        "min_ambient_temp_C": getattr(base, "min_ambient_temp_C", None),
        "max_ambient_temp_C": getattr(base, "max_ambient_temp_C", None),
        "peak_solar_radiation_W_m2": getattr(base, "peak_solar_radiation_W_m2", None),
        "duration_hours": 24,
        "engine": "fdm",
        "variant_label": f"{wall_label} | {thickness*100:.0f}cm | {n_win}W",
        "_wall_label": wall_label, "_wall_cost": wall_cost,
        "_thickness": thickness, "_n_win": n_win,
    }


def generate_candidates(base):
    out = []
    for wid, wlbl, wcost in WALL_CANDIDATES:
        for rid, _ in ROOF_CANDIDATES:
            for t in THICKNESS_CANDIDATES:
                for nw in WINDOW_CANDIDATES:
                    for ori in ORIENTATION_CANDIDATES:
                        out.append(_make_candidate(base, wid, wlbl, wcost, rid, t, nw, ori))
    return out


async def run_optimizer(base_input, materials_db, climate_profile, progress_callback=None):
    from app.services.fallback_engine import run_fdm_simulation
    from app.services.results_processor import process_raw_results
    from app.services.simulation_service import scale_climate_profile

    class _Inp:
        def __init__(self, d):
            self.__dict__.update(d)
            self.openings = [_Op(o) for o in d.get("openings", [])]
            self.wall_custom_material = None
            self.roof_custom_material = None

    class _Op:
        def __init__(self, d):
            self.type = d["type"]
            self.count = int(d["count"])
            self.width_m = float(d["width_m"])
            self.height_m = float(d["height_m"])
            self.glazing_material_id = d.get("glazing_material_id", "double_glazing")

    scaled_climate = scale_climate_profile(
        climate_profile,
        min_amb=getattr(base_input, "min_ambient_temp_C", None),
        max_amb=getattr(base_input, "max_ambient_temp_C", None),
        peak_solar=getattr(base_input, "peak_solar_radiation_W_m2", None),
    )

    candidates = generate_candidates(base_input)
    total = len(candidates)
    scored = []
    best = None

    logger.info(f"[Optimizer] Sweep: {total} designs")

    for i, cd in enumerate(candidates):
        try:
            raw_result = run_fdm_simulation(_Inp(cd), materials_db, scaled_climate)
            result = process_raw_results(raw_result)
            score  = _score(result, cd["_thickness"])
            entry  = {
                "rank": 0,
                "score": score,
                "inputs": cd,
                "result": result,
                "wall_material": cd["_wall_label"],
                "wall_thickness_m": cd["_thickness"],
                "n_windows": cd["_n_win"],
                "min_inside_temp_C":  float(result.get("min_inside_temp_C", -99)),
                "peak_inside_temp_C": float(result.get("peak_inside_temp_C", -99)),
                "avg_inside_temp_C":  float(result.get("avg_inside_temp_C", -99)),
                "comfort_hours":      float(result.get("comfort_hours", 0)),
                "energy_efficiency_score": float(result.get("energy_efficiency_score", 0)),
                "variant_label": cd["variant_label"],
            }
            scored.append(entry)
            if best is None or score > best["score"]:
                best = entry
            if progress_callback:
                progress_callback(i + 1, total, best)
        except Exception as e:
            logger.warning(f"[Optimizer] Candidate {i+1} failed: {e}")
        await asyncio.sleep(0)

    scored.sort(key=lambda x: -x["score"])
    for r, e in enumerate(scored):
        e["rank"] = r + 1
    top3 = scored[:3]
    logger.info(f"[Optimizer] Winner: {top3[0]['wall_material']} {top3[0]['wall_thickness_m']*100:.0f}cm score={top3[0]['score']:.3f}")
    return {"total_tested": len(scored), "winner": top3[0], "top_designs": top3, "all_results": scored}
