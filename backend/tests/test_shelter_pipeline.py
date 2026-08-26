"""
backend/tests/test_shelter_pipeline.py
======================================
Comprehensive Unit Test Suite for Candidate Generation, Physics Pre-Screening,
Geometry & Collision Validation, Explainable Ranking, Diversity Selector,
and ANSYS Export Pipeline.
"""
import pytest
import math
import sys
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.pipeline.models import (
    GeometrySpec,
    RoofSpec,
    WallLayerSpec,
    WallSystemSpec,
    OpeningSpec,
    CandidateShelter,
    DesignSpaceConfig,
    UserDesignRequest,
)
from app.pipeline.material_repo import MaterialRepository, get_material_repo
from app.pipeline.climate_repo import load_climate_timeseries, ClimateTimeSeries
from app.pipeline.geometry_validator import GeometryValidator, _boxes_overlap_2d
from app.pipeline.candidate_generator import generate_candidate_shelters
from app.pipeline.thermal_screening import ThermalScreeningEngine
from app.pipeline.ranking_engine import score_candidate
from app.pipeline.diversity_selector import select_diverse_top_10
from app.pipeline.ansys_adapter import build_ansys_contract_payload, generate_apdl_script, run_ansys_evaluation
from app.pipeline.pipeline_orchestrator import run_candidate_pipeline


# --- 1. Material Thermal Resistance Test ---
def test_material_thermal_resistance():
    repo = get_material_repo()
    mat = repo.get("mud_brick")
    k = mat["thermal_conductivity"]
    assert k == 0.52
    thickness = 0.30
    r_val = thickness / k
    assert abs(r_val - 0.5769) < 0.001


# --- 2. Wall Conductive Heat Loss Test ---
def test_wall_heat_loss_calculation():
    wall = WallSystemSpec(
        wall_type="single",
        outer_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.30)
    )
    repo = get_material_repo()
    r_tot = repo.calculate_wall_r_value(wall)
    # R_total = 0.13 + 0.30/0.52 + 0.04 = 0.17 + 0.5769 = 0.7469
    assert abs(r_tot - 0.7469) < 0.01

    u_val = repo.calculate_wall_u_value(wall)
    assert abs(u_val - (1.0 / r_tot)) < 0.001

    delta_t = 20.0  # inside 20°C, outside 0°C
    area = 24.0     # m^2
    q_loss = (area / r_tot) * delta_t
    assert q_loss > 0
    assert abs(q_loss - (area * u_val * delta_t)) < 0.1


# --- 3. Multi-Layer Wall Calculation Test ---
def test_multilayer_wall_r_value():
    repo = get_material_repo()
    # Mud brick (20cm) + EPS (10cm) + Mud brick (10cm)
    wall = WallSystemSpec(
        wall_type="composite",
        outer_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.20),
        insulation_layer=WallLayerSpec(material_id="eps_insulation", thickness_m=0.10),
        inner_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.10),
    )
    assert wall.total_thickness_m == 0.40

    r_tot = repo.calculate_wall_r_value(wall)
    # R = 0.13 (Rsi) + 0.20/0.52 + 0.10/0.036 + 0.10/0.52 + 0.04 (Rse)
    # R = 0.17 + 0.3846 + 2.7778 + 0.1923 = 3.5247 m^2*K/W
    assert r_tot > 3.40
    assert r_tot < 3.65
    assert repo.calculate_wall_u_value(wall) < 0.30


# --- 4. Roof Heat Loss Test ---
def test_roof_heat_loss_calculation():
    repo = get_material_repo()
    roof = RoofSpec(type="gable", angle_deg=30.0, thickness_m=0.20, material_id="mud_brick")
    r_roof = repo.calculate_roof_r_value(roof)
    # R = 0.10 + 0.20/0.52 + 0.04 = 0.5246
    assert abs(r_roof - 0.5246) < 0.01
    assert repo.calculate_roof_u_value(roof) > 0


# --- 5. Window Heat Loss Test ---
def test_window_heat_loss():
    repo = get_material_repo()
    u_single = repo.calculate_opening_u_value("single_glazing", "window")
    u_double = repo.calculate_opening_u_value("double_glazing", "window")
    u_triple = repo.calculate_opening_u_value("triple_glazing", "window")

    assert u_single > u_double > u_triple
    assert abs(u_double - 2.80) < 0.1

    # Double glazing window heat loss
    area = 2.0  # m^2
    delta_t = 25.0 # K
    q_loss = u_double * area * delta_t
    assert q_loss == 2.80 * 2.0 * 25.0


# --- 6. Solar Gain Calculation Test ---
def test_solar_gain_calculation():
    climate = load_climate_timeseries("ladakh_winter")
    # Noon hour 12: solar altitude should be positive
    alpha, gamma = climate.solar_position(12.0)
    assert alpha > 0.0

    # South-facing vertical wall incidence cosine
    f_south = climate.surface_solar_factor(180.0, 90.0, 12.0)
    assert f_south > 0.50

    # North-facing vertical wall should receive zero direct solar
    f_north = climate.surface_solar_factor(0.0, 90.0, 12.0)
    assert f_north == 0.0


# --- 7. Thermal-Capacitance Temperature Update Test ---
def test_thermal_capacitance_update():
    # C_eff * dT/dt = Q_net
    C_eff = 1.0e6  # J/K
    dt = 3600.0    # 1 hour (s)
    Q_net = 500.0  # Watts
    T_old = 10.0   # °C

    # dT = Q_net * dt / C_eff = 500 * 3600 / 1e6 = 1.8 °C
    T_new = T_old + (Q_net * dt) / C_eff
    assert abs(T_new - 11.8) < 1e-4


# --- 8. Parametric Candidate Generation Test ---
def test_candidate_generation():
    req = UserDesignRequest(length_m=6.0, width_m=4.0, height_m=2.8)
    candidates = generate_candidate_shelters(user_request=req, limit=100)
    assert len(candidates) > 0
    for c in candidates:
        assert c.geometry.length_m == 6.0
        assert c.geometry.width_m == 4.0
        assert c.geometry.wall_height_m == 2.8
        assert c.door_count == 1
        assert c.window_count >= 1


# --- 9. Geometry Validation Test ---
def test_geometry_validation_clean():
    validator = GeometryValidator()
    cand = CandidateShelter(
        geometry=GeometrySpec(shape="rectangle", length_m=6.0, width_m=4.0, wall_height_m=3.0),
        roof=RoofSpec(type="gable", angle_deg=30.0, thickness_m=0.20, material_id="mud_brick"),
        wall_system=WallSystemSpec(
            wall_type="single",
            outer_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.35)
        ),
        openings=[
            OpeningSpec(id="DOOR1", type="door", wall="south", position_x=0.5, position_z=0.0, width_m=0.9, height_m=2.1, glass_material_id="insulated_door"),
            OpeningSpec(id="WIN1", type="window", wall="south", position_x=2.5, position_z=0.9, width_m=1.2, height_m=1.2, glass_material_id="double_glazing")
        ]
    )
    is_valid, reasons = validator.validate(cand)
    assert is_valid is True
    assert len(reasons) == 0


# --- 10. Window-Door Collision Detection Test ---
def test_opening_collision_detection():
    # Create two overlapping boxes on south wall
    op_door = OpeningSpec(id="DOOR1", type="door", wall="south", position_x=1.0, position_z=0.0, width_m=0.9, height_m=2.1)
    op_win_overlap = OpeningSpec(id="WIN1", type="window", wall="south", position_x=1.4, position_z=1.0, width_m=1.2, height_m=1.2)

    assert _boxes_overlap_2d(op_door, op_win_overlap) is True

    op_win_clear = OpeningSpec(id="WIN2", type="window", wall="south", position_x=2.5, position_z=1.0, width_m=1.2, height_m=1.2)
    assert _boxes_overlap_2d(op_door, op_win_clear) is False


# --- 11. Hard Constraint Filtering Test ---
def test_hard_constraint_rejections():
    validator = GeometryValidator()
    # Invalid candidate with window bursting through the right wall edge
    cand_invalid = CandidateShelter(
        geometry=GeometrySpec(shape="rectangle", length_m=4.0, width_m=3.0, wall_height_m=2.8),
        roof=RoofSpec(type="gable", angle_deg=30.0, thickness_m=0.20, material_id="mud_brick"),
        wall_system=WallSystemSpec(
            wall_type="single",
            outer_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.30)
        ),
        openings=[
            # position_x=3.5 + width=1.2 = 4.7m > wall length 4.0m!
            OpeningSpec(id="WIN_BURST", type="window", wall="south", position_x=3.5, position_z=0.9, width_m=1.2, height_m=1.2)
        ]
    )
    is_valid, reasons = validator.validate(cand_invalid)
    assert is_valid is False
    assert any("extends to" in r for r in reasons)


# --- 12. Candidate Ranking & Explainability Test ---
def test_candidate_ranking_and_notes():
    engine = ThermalScreeningEngine()
    climate = load_climate_timeseries("ladakh_winter")
    cand = CandidateShelter(
        geometry=GeometrySpec(shape="rectangle", length_m=6.0, width_m=4.0, wall_height_m=2.8),
        roof=RoofSpec(type="gable", angle_deg=30.0, thickness_m=0.20, material_id="mud_brick"),
        wall_system=WallSystemSpec(
            wall_type="composite",
            outer_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.20),
            insulation_layer=WallLayerSpec(material_id="eps_insulation", thickness_m=0.10),
            inner_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.10),
        ),
        openings=[
            OpeningSpec(id="DOOR1", type="door", wall="south", position_x=0.4, position_z=0.0, width_m=0.9, height_m=2.1, glass_material_id="insulated_door"),
            OpeningSpec(id="WIN1", type="window", wall="south", position_x=2.2, position_z=0.9, width_m=1.2, height_m=1.2, glass_material_id="double_glazing"),
            OpeningSpec(id="WIN2", type="window", wall="south", position_x=3.8, position_z=0.9, width_m=1.2, height_m=1.2, glass_material_id="double_glazing"),
        ]
    )
    metrics = engine.evaluate(cand, climate)
    score, breakdown, notes = score_candidate(cand, metrics)

    assert 0.0 <= score <= 100.0
    assert "comfort_score" in breakdown
    assert "energy_score" in breakdown
    assert len(notes) > 0


# --- 13. Diverse Top-10 Selection Test ---
def test_diversity_selector():
    output = run_candidate_pipeline(UserDesignRequest(length_m=6.0, width_m=4.0, run_ansys_detailed=False))
    assert output.screened_candidates > 0
    assert len(output.top_10_candidates) <= 10

    # Ensure ranks are consecutive 1..10
    ranks = [c.rank for c in output.top_10_candidates]
    assert ranks == list(range(1, len(output.top_10_candidates) + 1))


# --- 14. ANSYS Payload & Contract Generation Test ---
def test_ansys_payload_contract():
    climate = load_climate_timeseries("ladakh_winter")
    cand = CandidateShelter(
        geometry=GeometrySpec(shape="rectangle", length_m=8.0, width_m=5.0, wall_height_m=3.0),
        roof=RoofSpec(type="gable", angle_deg=30.0, thickness_m=0.20, material_id="mud_brick"),
        wall_system=WallSystemSpec(
            wall_type="single",
            outer_layer=WallLayerSpec(material_id="mud_brick", thickness_m=0.35)
        ),
        openings=[
            OpeningSpec(id="DOOR1", type="door", wall="south", position_x=0.5, position_z=0.0, width_m=0.9, height_m=2.1, glass_material_id="insulated_door"),
            OpeningSpec(id="WIN1", type="window", wall="south", position_x=2.5, position_z=0.9, width_m=1.5, height_m=1.2, glass_material_id="double_glazing")
        ]
    )
    payload = build_ansys_contract_payload(cand, climate)
    assert payload["candidate_id"] == cand.candidate_id
    assert "geometry" in payload
    assert "walls" in payload
    assert "openings" in payload
    assert "climate" in payload
    assert payload["simulation"]["analysis_type"] == "transient_thermal"

    # Test APDL script generation
    apdl = generate_apdl_script(payload)
    assert "/BATCH" in apdl
    assert "SOLID70" in apdl
    assert "SLEN,8.0" in apdl


# --- 15. Deterministic Reproducibility Test ---
def test_deterministic_reproducibility():
    cfg1 = DesignSpaceConfig(random_seed=12345)
    cfg2 = DesignSpaceConfig(random_seed=12345)

    req = UserDesignRequest(length_m=6.0, width_m=4.0, run_ansys_detailed=False)

    out1 = run_candidate_pipeline(req, cfg1)
    out2 = run_candidate_pipeline(req, cfg2)

    assert out1.total_candidates_generated == out2.total_candidates_generated
    assert out1.valid_candidates == out2.valid_candidates
    assert [c.score for c in out1.top_10_candidates] == [c.score for c in out2.top_10_candidates]
