from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Literal, Any, Union


class MaterialProperties(BaseModel):
    conductivity: float = Field(gt=0, description="Thermal conductivity W/(m?K)")
    density: float = Field(gt=0, description="Density kg/m?")
    specific_heat: float = Field(gt=0, description="Specific heat J/(kg?K)")
    solar_absorptivity: float = Field(ge=0, le=1)
    emissivity: float = Field(ge=0, le=1)


class Opening(BaseModel):
    type: Literal['window', 'door'] = 'window'
    width_m: float = Field(gt=0, le=5.0, default=1.0)
    height_m: float = Field(gt=0, le=5.0, default=1.2)
    count: int = Field(ge=1, le=20, default=1)
    glazing_material_id: str = 'single_glazing'

    @model_validator(mode='before')
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if 'width' in data and 'width_m' not in data:
                data['width_m'] = data['width']
            if 'height' in data and 'height_m' not in data:
                data['height_m'] = data['height']
            if 'material_id' in data and 'glazing_material_id' not in data:
                data['glazing_material_id'] = data['material_id']
        return data


class ShelterInput(BaseModel):
    length_m: float = Field(gt=1, le=50, default=6.0)
    width_m: float = Field(gt=1, le=50, default=4.0)
    height_m: float = Field(gt=1, le=10, default=3.0)
    shape: Literal['rectangular', 'dome'] = 'rectangular'
    wall_material_id: str = 'mud_brick'
    wall_thickness_m: float = Field(gt=0.04, le=2.0, default=0.30)
    roof_material_id: str = 'mud_brick'
    roof_thickness_m: float = Field(gt=0.04, le=2.0, default=0.20)
    floor_material_id: str = 'rammed_earth'
    floor_thickness_m: float = Field(gt=0.04, le=2.0, default=0.15)
    wall_custom_material: Optional[MaterialProperties] = None
    roof_custom_material: Optional[MaterialProperties] = None
    openings: List[Opening] = []
    orientation_deg: float = Field(ge=0, le=360, default=180.0)
    climate_profile_id: str = 'ladakh_winter'
    duration_hours: int = Field(ge=1, le=72, default=24)
    variant_label: Optional[str] = None
    engine: Literal['auto', 'fdm', 'ansys'] = 'auto'
    # auto = use ANSYS if available/licensed, else fall back to Python FDM

    @model_validator(mode='before')
    @classmethod
    def handle_payload_variants(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Dimensions support
            if 'dimensions' in data and isinstance(data['dimensions'], dict):
                dim = data['dimensions']
                data['length_m'] = dim.get('length', data.get('length_m', 6.0))
                data['width_m']  = dim.get('width',  data.get('width_m', 4.0))
                data['height_m'] = dim.get('height', data.get('height_m', 3.0))
            if 'length' in data and 'length_m' not in data:
                data['length_m'] = data['length']
            if 'width' in data and 'width_m' not in data:
                data['width_m'] = data['width']
            if 'height' in data and 'height_m' not in data:
                data['height_m'] = data['height']

            # Wall support
            if 'wall' in data and isinstance(data['wall'], dict):
                data['wall_material_id']  = data['wall'].get('material_id', data.get('wall_material_id', 'mud_brick'))
                data['wall_thickness_m']  = data['wall'].get('thickness', data.get('wall_thickness_m', 0.30))
            if 'wall_thickness' in data and 'wall_thickness_m' not in data:
                data['wall_thickness_m'] = data['wall_thickness']

            # Roof support
            if 'roof' in data and isinstance(data['roof'], dict):
                data['roof_material_id']  = data['roof'].get('material_id', data.get('roof_material_id', 'mud_brick'))
                data['roof_thickness_m']  = data['roof'].get('thickness', data.get('roof_thickness_m', 0.20))
            if 'roof_thickness' in data and 'roof_thickness_m' not in data:
                data['roof_thickness_m'] = data['roof_thickness']

            # Floor support
            if 'floor' in data and isinstance(data['floor'], dict):
                data['floor_material_id'] = data['floor'].get('material_id', data.get('floor_material_id', 'rammed_earth'))
                data['floor_thickness_m'] = data['floor'].get('thickness', data.get('floor_thickness_m', 0.15))
            if 'floor_thickness' in data and 'floor_thickness_m' not in data:
                data['floor_thickness_m'] = data['floor_thickness']

            # Orientation support
            if 'orientation' in data and 'orientation_deg' not in data:
                data['orientation_deg'] = data['orientation']
            if data.get('orientation_deg') == 360:
                data['orientation_deg'] = 0.0

        return data


class TimeSeriesPoint(BaseModel):
    hour: float
    value: float


class ComponentHeatFlow(BaseModel):
    component: str
    heat_flow_series: List[TimeSeriesPoint]


class SimulationResult(BaseModel):
    job_id: str
    status: Literal['queued', 'running', 'complete', 'failed'] = 'queued'
    error_message: Optional[str] = None
    variant_label: Optional[str] = None
    inside_temperature_series: List[TimeSeriesPoint] = []
    ambient_temperature_series: List[TimeSeriesPoint] = []
    solar_gain_series: List[TimeSeriesPoint] = []
    total_solar_gain_kwh: Optional[float] = None
    heat_flow_series: List[ComponentHeatFlow] = []
    total_heat_loss_kwh: Optional[float] = None
    peak_inside_temp_C: Optional[float] = None
    min_inside_temp_C: Optional[float] = None
    avg_inside_temp_C: Optional[float] = None
    comfort_hours: Optional[int] = None
    efficiency_score: Optional[float] = None
    engine_used: Optional[str] = None


class CompareRequest(BaseModel):
    variants: List[ShelterInput] = Field(min_length=2, max_length=6)


class CompareResult(BaseModel):
    job_id: str
    status: Literal['queued', 'running', 'complete', 'failed'] = 'queued'
    results: List[SimulationResult] = []
    best_variant_label: Optional[str] = None
    recommendation_text: Optional[str] = None
    recommendation_reasons: List[str] = []
