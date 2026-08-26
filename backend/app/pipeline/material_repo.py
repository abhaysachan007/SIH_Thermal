"""
app.pipeline.material_repo
==========================
Centralized Material Repository & Thermal Resistance Calculators.
All thermal properties use strict SI Units:
  - Thermal Conductivity: W/(m*K)
  - Density: kg/m^3
  - Specific Heat: J/(kg*K)
"""
from typing import Dict, Any, Optional, List
from app.pipeline.models import WallSystemSpec, RoofSpec

# Standard surface film convection resistances (ISO 6946 / ASHRAE)
R_SI_WALL = 0.13   # m^2*K/W (indoor vertical surface)
R_SE_WALL = 0.04   # m^2*K/W (outdoor vertical surface in winter)
R_SI_ROOF = 0.10   # m^2*K/W (indoor ceiling upward heat flow)
R_SE_ROOF = 0.04   # m^2*K/W (outdoor roof)
R_SI_FLOOR = 0.17  # m^2*K/W (indoor floor downward heat flow)
R_GROUND_EFF = 1.50 # m^2*K/W (effective perimeter ground contact resistance in cold climate)

DEFAULT_MATERIALS: Dict[str, Dict[str, Any]] = {
    "mud_brick": {
        "id": "mud_brick",
        "name": "Mud Brick (Adobe)",
        "thermal_conductivity": 0.52,
        "density": 1700.0,
        "specific_heat": 879.0,
        "solar_absorptivity": 0.70,
        "solar_reflectivity": 0.30,
        "solar_transmissivity": 0.0,
        "emissivity": 0.90,
        "shgc": 0.0,
        "cost_index_per_m3": 120.0,
    },
    "rammed_earth": {
        "id": "rammed_earth",
        "name": "Rammed Earth",
        "thermal_conductivity": 0.85,
        "density": 2000.0,
        "specific_heat": 840.0,
        "solar_absorptivity": 0.72,
        "solar_reflectivity": 0.28,
        "solar_transmissivity": 0.0,
        "emissivity": 0.90,
        "shgc": 0.0,
        "cost_index_per_m3": 110.0,
    },
    "stone_masonry": {
        "id": "stone_masonry",
        "name": "Stone Masonry (Limestone)",
        "thermal_conductivity": 1.50,
        "density": 2180.0,
        "specific_heat": 900.0,
        "solar_absorptivity": 0.68,
        "solar_reflectivity": 0.32,
        "solar_transmissivity": 0.0,
        "emissivity": 0.88,
        "shgc": 0.0,
        "cost_index_per_m3": 180.0,
    },
    "granite_stone": {
        "id": "granite_stone",
        "name": "Stone (Granite)",
        "thermal_conductivity": 2.90,
        "density": 2640.0,
        "specific_heat": 790.0,
        "solar_absorptivity": 0.75,
        "solar_reflectivity": 0.25,
        "solar_transmissivity": 0.0,
        "emissivity": 0.85,
        "shgc": 0.0,
        "cost_index_per_m3": 210.0,
    },
    "dense_concrete": {
        "id": "dense_concrete",
        "name": "Dense Concrete",
        "thermal_conductivity": 1.40,
        "density": 2300.0,
        "specific_heat": 880.0,
        "solar_absorptivity": 0.65,
        "solar_reflectivity": 0.35,
        "solar_transmissivity": 0.0,
        "emissivity": 0.88,
        "shgc": 0.0,
        "cost_index_per_m3": 160.0,
    },
    "eps_insulation": {
        "id": "eps_insulation",
        "name": "Expanded Polystyrene (EPS)",
        "thermal_conductivity": 0.036,
        "density": 20.0,
        "specific_heat": 1450.0,
        "solar_absorptivity": 0.25,
        "solar_reflectivity": 0.75,
        "solar_transmissivity": 0.0,
        "emissivity": 0.90,
        "shgc": 0.0,
        "cost_index_per_m3": 350.0,
    },
    "mineral_wool": {
        "id": "mineral_wool",
        "name": "Mineral Rock Wool",
        "thermal_conductivity": 0.040,
        "density": 80.0,
        "specific_heat": 840.0,
        "solar_absorptivity": 0.20,
        "solar_reflectivity": 0.80,
        "solar_transmissivity": 0.0,
        "emissivity": 0.90,
        "shgc": 0.0,
        "cost_index_per_m3": 400.0,
    },
    "softwood_timber": {
        "id": "softwood_timber",
        "name": "Softwood Timber",
        "thermal_conductivity": 0.13,
        "density": 500.0,
        "specific_heat": 1600.0,
        "solar_absorptivity": 0.60,
        "solar_reflectivity": 0.40,
        "solar_transmissivity": 0.0,
        "emissivity": 0.90,
        "shgc": 0.0,
        "cost_index_per_m3": 450.0,
    },
    "single_glazing": {
        "id": "single_glazing",
        "name": "Single Glazing (4mm Float)",
        "thermal_conductivity": 1.00,
        "density": 2500.0,
        "specific_heat": 840.0,
        "solar_absorptivity": 0.06,
        "solar_reflectivity": 0.08,
        "solar_transmissivity": 0.86,
        "emissivity": 0.84,
        "shgc": 0.72,
        "u_value": 5.80,  # W/(m^2*K)
        "cost_index_per_m2": 60.0,
    },
    "double_glazing": {
        "id": "double_glazing",
        "name": "Double Glazing (4-12-4 Low-E)",
        "thermal_conductivity": 0.35,
        "density": 2500.0,
        "specific_heat": 840.0,
        "solar_absorptivity": 0.10,
        "solar_reflectivity": 0.18,
        "solar_transmissivity": 0.72,
        "emissivity": 0.84,
        "shgc": 0.62,
        "u_value": 2.80,  # W/(m^2*K)
        "cost_index_per_m2": 150.0,
    },
    "triple_glazing": {
        "id": "triple_glazing",
        "name": "Triple Glazing (4-12-4-12-4 Argon)",
        "thermal_conductivity": 0.18,
        "density": 2500.0,
        "specific_heat": 840.0,
        "solar_absorptivity": 0.12,
        "solar_reflectivity": 0.28,
        "solar_transmissivity": 0.60,
        "emissivity": 0.84,
        "shgc": 0.50,
        "u_value": 1.60,  # W/(m^2*K)
        "cost_index_per_m2": 260.0,
    },
    "insulated_door": {
        "id": "insulated_door",
        "name": "Insulated Solid Wood Door with Thermal Core",
        "thermal_conductivity": 0.08,
        "density": 600.0,
        "specific_heat": 1400.0,
        "solar_absorptivity": 0.60,
        "solar_reflectivity": 0.40,
        "solar_transmissivity": 0.0,
        "emissivity": 0.90,
        "shgc": 0.0,
        "u_value": 1.80,  # W/(m^2*K)
        "cost_index_per_unit": 200.0,
    }
}


class MaterialRepository:
    def __init__(self, custom_materials: Optional[Dict[str, Dict[str, Any]]] = None):
        self._materials = dict(DEFAULT_MATERIALS)
        if custom_materials:
            self._materials.update(custom_materials)

    def get(self, material_id: str) -> Dict[str, Any]:
        if material_id not in self._materials:
            # Fallback to mud_brick if unknown
            return self._materials.get("mud_brick", {})
        return self._materials[material_id]

    def register(self, material_dict: Dict[str, Any]) -> None:
        mat_id = material_dict["id"]
        self._materials[mat_id] = material_dict

    def list_all(self) -> List[Dict[str, Any]]:
        return list(self._materials.values())

    # --- Multi-Layer Thermal Resistance Calculators ---
    def calculate_wall_r_value(self, wall: WallSystemSpec) -> float:
        """
        R_total = R_si + R_layer1 + R_layer2 + ... + R_se
        where R_i = L_i / k_i
        """
        r_sum = R_SI_WALL + R_SE_WALL

        # Outer layer
        out_mat = self.get(wall.outer_layer.material_id)
        k_out = max(1e-4, float(out_mat.get("thermal_conductivity", 0.52)))
        r_sum += wall.outer_layer.thickness_m / k_out

        # Insulation layer
        if wall.insulation_layer and wall.insulation_layer.thickness_m > 0:
            ins_mat = self.get(wall.insulation_layer.material_id)
            k_ins = max(1e-4, float(ins_mat.get("thermal_conductivity", 0.04)))
            r_sum += wall.insulation_layer.thickness_m / k_ins

        # Inner layer
        if wall.inner_layer and wall.inner_layer.thickness_m > 0:
            inn_mat = self.get(wall.inner_layer.material_id)
            k_inn = max(1e-4, float(inn_mat.get("thermal_conductivity", 0.52)))
            r_sum += wall.inner_layer.thickness_m / k_inn

        return round(r_sum, 4)

    def calculate_wall_u_value(self, wall: WallSystemSpec) -> float:
        r_val = self.calculate_wall_r_value(wall)
        return round(1.0 / max(0.01, r_val), 4)

    def calculate_roof_r_value(self, roof: RoofSpec) -> float:
        mat = self.get(roof.material_id)
        k = max(1e-4, float(mat.get("thermal_conductivity", 0.52)))
        r_mat = roof.thickness_m / k
        return round(R_SI_ROOF + r_mat + R_SE_ROOF, 4)

    def calculate_roof_u_value(self, roof: RoofSpec) -> float:
        return round(1.0 / max(0.01, self.calculate_roof_r_value(roof)), 4)

    def calculate_floor_r_value(self, floor_material_id: str, thickness_m: float) -> float:
        mat = self.get(floor_material_id)
        k = max(1e-4, float(mat.get("thermal_conductivity", 0.85)))
        r_mat = thickness_m / k
        return round(R_SI_FLOOR + r_mat + R_GROUND_EFF, 4)

    def calculate_floor_u_value(self, floor_material_id: str, thickness_m: float) -> float:
        return round(1.0 / max(0.01, self.calculate_floor_r_value(floor_material_id, thickness_m)), 4)

    def calculate_opening_u_value(self, glazing_or_mat_id: str, opening_type: str = "window") -> float:
        mat = self.get(glazing_or_mat_id)
        if "u_value" in mat:
            return float(mat["u_value"])
        if opening_type == "door":
            return 1.80
        # fallback based on conductivity
        cond = float(mat.get("thermal_conductivity", 0.35))
        if cond > 0.6:
            return 5.80
        elif cond > 0.25:
            return 2.80
        else:
            return 1.60

    def calculate_opening_shgc(self, glazing_or_mat_id: str) -> float:
        mat = self.get(glazing_or_mat_id)
        return float(mat.get("shgc", 0.62) or 0.62)

    def calculate_wall_thermal_mass(self, wall: WallSystemSpec, area_m2: float) -> float:
        """
        Thermal capacitance = Area * sum( thickness_i * density_i * specific_heat_i ) in J/K
        """
        c_per_m2 = 0.0
        out_mat = self.get(wall.outer_layer.material_id)
        c_per_m2 += wall.outer_layer.thickness_m * out_mat.get("density", 1700.0) * out_mat.get("specific_heat", 879.0)

        if wall.insulation_layer:
            ins_mat = self.get(wall.insulation_layer.material_id)
            c_per_m2 += wall.insulation_layer.thickness_m * ins_mat.get("density", 20.0) * ins_mat.get("specific_heat", 1450.0)

        if wall.inner_layer:
            inn_mat = self.get(wall.inner_layer.material_id)
            c_per_m2 += wall.inner_layer.thickness_m * inn_mat.get("density", 1700.0) * inn_mat.get("specific_heat", 879.0)

        return round(area_m2 * c_per_m2, 2)


_global_repo = MaterialRepository()

def get_material_repo() -> MaterialRepository:
    return _global_repo
