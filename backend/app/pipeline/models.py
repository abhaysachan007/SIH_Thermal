"""
app.pipeline.models
===================
Strict Pydantic data contracts for Parametric Shelter Specifications,
Design Space Constraints, Thermal Screening Results, and ANSYS Payloads.
"""
import uuid
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field, model_validator


class GeometrySpec(BaseModel):
    shape: Literal["rectangle", "square"] = "rectangle"
    length_m: float = Field(gt=1.0, le=30.0, description="Exterior length in meters")
    width_m: float = Field(gt=1.0, le=30.0, description="Exterior width in meters")
    wall_height_m: float = Field(gt=1.5, le=10.0, default=3.0, description="Exterior wall height in meters")

    @property
    def floor_area_m2(self) -> float:
        return round(self.length_m * self.width_m, 3)

    @property
    def internal_volume_approx_m3(self) -> float:
        return round(self.length_m * self.width_m * self.wall_height_m, 3)


class RoofSpec(BaseModel):
    type: Literal["flat", "single_slope", "gable"] = "gable"
    angle_deg: float = Field(ge=0.0, le=60.0, default=30.0, description="Roof pitch in degrees")
    thickness_m: float = Field(gt=0.02, le=1.0, default=0.20, description="Total roof thickness in meters")
    material_id: str = "mud_brick"


class WallLayerSpec(BaseModel):
    material_id: str
    thickness_m: float = Field(gt=0.005, le=1.0)


class WallSystemSpec(BaseModel):
    wall_type: Literal["single", "composite"] = "single"
    outer_layer: WallLayerSpec
    insulation_layer: Optional[WallLayerSpec] = None
    inner_layer: Optional[WallLayerSpec] = None

    @property
    def total_thickness_m(self) -> float:
        thk = self.outer_layer.thickness_m
        if self.insulation_layer:
            thk += self.insulation_layer.thickness_m
        if self.inner_layer:
            thk += self.inner_layer.thickness_m
        return round(thk, 4)

    @property
    def primary_material_id(self) -> str:
        return self.outer_layer.material_id


class OpeningSpec(BaseModel):
    id: str = Field(default_factory=lambda: f"OP_{uuid.uuid4().hex[:6]}")
    type: Literal["window", "door", "skylight"] = "window"
    wall: Literal["south", "north", "east", "west", "roof"] = "south"
    position_x: float = Field(ge=0.0, description="Distance from left edge of wall in meters")
    position_z: float = Field(ge=0.0, description="Sill/bottom elevation from ground in meters")
    width_m: float = Field(gt=0.2, le=10.0, description="Opening width in meters")
    height_m: float = Field(gt=0.2, le=5.0, description="Opening height in meters")
    glass_material_id: str = "double_glazing"

    @property
    def area_m2(self) -> float:
        return round(self.width_m * self.height_m, 4)


class CandidateShelter(BaseModel):
    candidate_id: str = Field(default_factory=lambda: f"SHELTER_{uuid.uuid4().hex[:8]}")
    geometry: GeometrySpec
    roof: RoofSpec
    wall_system: WallSystemSpec
    floor_material_id: str = "rammed_earth"
    floor_thickness_m: float = 0.15
    openings: List[OpeningSpec] = []
    orientation_deg: float = Field(ge=0.0, le=360.0, default=180.0, description="0=N, 90=E, 180=S, 270=W")
    target_occupancy: int = 4
    variant_label: Optional[str] = None
    created_at: Optional[str] = None

    @property
    def total_window_area_m2(self) -> float:
        return sum(op.area_m2 for op in self.openings if op.type == "window")

    @property
    def south_window_area_m2(self) -> float:
        return sum(op.area_m2 for op in self.openings if op.type == "window" and op.wall == "south")

    @property
    def door_count(self) -> int:
        return sum(1 for op in self.openings if op.type == "door")

    @property
    def window_count(self) -> int:
        return sum(1 for op in self.openings if op.type == "window")


class ThermalMetrics(BaseModel):
    min_indoor_temperature_c: float
    max_indoor_temperature_c: float
    average_indoor_temperature_c: float
    comfort_hours: float
    comfort_percentage: float
    comfort_hours_count: int
    comfort_hours_pct: float
    wall_conductive_loss_kwh: float
    roof_conductive_loss_kwh: float
    floor_conductive_loss_kwh: float
    window_conductive_loss_kwh: float
    door_conductive_loss_kwh: float
    infiltration_loss_kwh: float
    total_heat_loss_kwh: float
    solar_gain_kwh: float
    estimated_energy_requirement_kwh: float
    hourly_indoor_temps: List[float] = []
    hourly_ambient_temps: List[float] = []
    hourly_solar_gains: List[float] = []
    hourly_heat_losses: List[float] = []


class CandidateRankingResult(BaseModel):
    rank: int
    candidate_id: str
    design: CandidateShelter
    screening_results: ThermalMetrics
    score: float
    estimated_cost_inr: Optional[float] = None
    score_breakdown: Dict[str, float] = {}
    explainability_notes: List[str] = []
    diversity_category: Optional[str] = None
    ansys_status: Literal["pending", "queued", "running", "completed", "mock_completed", "failed"] = "pending"
    ansys_payload: Optional[Dict[str, Any]] = None
    ansys_results: Optional[Dict[str, Any]] = None


class DesignSpaceConfig(BaseModel):
    min_length_m: float = 4.0
    max_length_m: float = 12.0
    length_step_m: float = 2.0

    min_width_m: float = 3.0
    max_width_m: float = 8.0
    width_step_m: float = 1.0

    min_area_m2: Optional[float] = None
    max_area_m2: Optional[float] = None

    min_wall_height_m: float = 2.6
    max_wall_height_m: float = 3.2
    wall_height_step_m: float = 0.6

    supported_shapes: List[str] = ["rectangle", "square"]
    supported_roof_types: List[str] = ["gable", "flat", "single_slope"]
    roof_angles_deg: List[float] = [0.0, 15.0, 30.0]

    orientations_deg: List[float] = [180.0, 150.0, 210.0]

    wall_systems: List[Dict[str, Any]] = [
        {"type": "single", "outer": "mud_brick", "thicknesses": [0.25, 0.35, 0.45]},
        {"type": "single", "outer": "stone_masonry", "thicknesses": [0.30, 0.40]},
        {"type": "single", "outer": "rammed_earth", "thicknesses": [0.30, 0.40]},
        {"type": "composite", "outer": "mud_brick", "insulation": "eps_insulation", "inner": "mud_brick",
         "outer_t": 0.20, "ins_t": [0.05, 0.10], "inner_t": 0.10},
        {"type": "composite", "outer": "granite_stone", "insulation": "mineral_wool", "inner": "mud_brick",
         "outer_t": 0.25, "ins_t": [0.05, 0.10], "inner_t": 0.10},
    ]

    window_south_area_options_m2: List[float] = [1.44, 2.88, 4.32, 5.76]
    glazing_options: List[str] = ["double_glazing", "single_glazing"]

    door_width_m: float = 0.9
    door_height_m: float = 2.1
    door_wall: str = "south"

    max_candidates: int = 5000
    random_seed: Optional[int] = 42

    comfort_weight: float = 0.50
    energy_weight: float = 0.30
    cost_weight: float = 0.20


class UserDesignRequest(BaseModel):
    length_m: Optional[float] = None
    width_m: Optional[float] = None
    height_m: Optional[float] = None
    min_area_m2: Optional[float] = None
    max_area_m2: Optional[float] = None
    required_occupancy: int = 4
    climate_profile_id: str = "ladakh_winter"
    min_ambient_temp_c: Optional[float] = None
    max_ambient_temp_c: Optional[float] = None
    peak_solar_radiation_w_m2: Optional[float] = None
    use_live_climate: bool = False
    custom_design_space: Optional[Dict[str, Any]] = None
    comfort_weight: float = 0.50
    energy_weight: float = 0.30
    cost_weight: float = 0.20
    run_ansys_detailed: bool = True
    ansys_mode: Literal["auto", "mock", "mapdl"] = "auto"


class PipelineOutput(BaseModel):
    request_id: str = Field(default_factory=lambda: f"REQ_{uuid.uuid4().hex[:8]}")
    total_candidates_generated: int
    valid_candidates: int
    screened_candidates: int
    top_10_candidates: List[CandidateRankingResult]
    rejection_summary: Dict[str, int] = {}
    recommendation_summary: Optional[Dict[str, Any]] = None
    simulation_mode: str = "FAST_PHYSICS + ANSYS_ADAPTER"
    explainability_log: List[Dict[str, Any]] = []
