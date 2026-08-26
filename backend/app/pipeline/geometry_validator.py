"""
app.pipeline.geometry_validator
===============================
Strict geometric validation and AABB collision detection.
Ensures every candidate shelter is physically buildable and free from
geometric anomalies (openings outside walls, window-door overlaps, corner proximity).
"""
from typing import Tuple, List, Dict, Any
from app.pipeline.models import CandidateShelter, OpeningSpec
from app.pipeline.material_repo import get_material_repo

MIN_CORNER_CLEARANCE_M = 0.25   # Minimum distance from wall edge to opening (m)
MIN_TOP_CLEARANCE_M = 0.20      # Minimum distance below eave/ceiling (m)
MIN_OPENING_SPACING_M = 0.20    # Minimum spacing between two adjacent openings (m)
MAX_WINDOW_TO_WALL_RATIO = 0.40 # Max 40% window area on any single facade
MIN_WALL_THICKNESS_M = 0.10     # Minimum total wall thickness
MAX_WALL_THICKNESS_M = 1.00     # Maximum total wall thickness


def _boxes_overlap_2d(op1: OpeningSpec, op2: OpeningSpec, min_gap: float = MIN_OPENING_SPACING_M) -> bool:
    """
    2D Axis-Aligned Bounding Box (AABB) collision check with minimum safety gap.
    """
    x1_min, x1_max = op1.position_x, op1.position_x + op1.width_m
    z1_min, z1_max = op1.position_z, op1.position_z + op1.height_m

    x2_min, x2_max = op2.position_x, op2.position_x + op2.width_m
    z2_min, z2_max = op2.position_z, op2.position_z + op2.height_m

    # If one box is completely to the left, right, above, or below the other (plus gap)
    if (x1_max + min_gap <= x2_min) or (x2_max + min_gap <= x1_min):
        return False
    if (z1_max + min_gap <= z2_min) or (z2_max + min_gap <= z1_min):
        return False

    return True


class GeometryValidator:
    def __init__(self, material_repo=None):
        self.mat_repo = material_repo or get_material_repo()

    def validate(self, candidate: CandidateShelter, config: Any = None) -> Tuple[bool, List[str]]:
        reasons = []
        geom = candidate.geometry
        roof = candidate.roof
        wall = candidate.wall_system

        # 1. Floor area bounds check
        if config:
            if config.min_area_m2 and geom.floor_area_m2 < config.min_area_m2:
                reasons.append(f"Floor area {geom.floor_area_m2:.1f}m² < min allowed {config.min_area_m2:.1f}m²")
            if config.max_area_m2 and geom.floor_area_m2 > config.max_area_m2:
                reasons.append(f"Floor area {geom.floor_area_m2:.1f}m² > max allowed {config.max_area_m2:.1f}m²")

        # 2. Dimensions validity
        if geom.length_m < 1.5 or geom.width_m < 1.5 or geom.wall_height_m < 1.8:
            reasons.append(f"Dimensions too small: {geom.length_m}x{geom.width_m}x{geom.wall_height_m}m")

        if geom.shape == "square" and abs(geom.length_m - geom.width_m) > 0.05:
            reasons.append(f"Square shape requested but length ({geom.length_m}m) != width ({geom.width_m}m)")

        # 3. Roof pitch validity
        if roof.type == "flat" and roof.angle_deg > 5.0:
            reasons.append(f"Flat roof angle {roof.angle_deg}° exceeds max 5.0°")
        if roof.type in ["gable", "single_slope"] and (roof.angle_deg < 5.0 or roof.angle_deg > 60.0):
            reasons.append(f"Pitched roof angle {roof.angle_deg}° out of realistic bounds [5°-60°]")

        # 4. Wall thickness validity
        tot_thk = wall.total_thickness_m
        if tot_thk < MIN_WALL_THICKNESS_M or tot_thk > MAX_WALL_THICKNESS_M:
            reasons.append(f"Total wall thickness {tot_thk:.3f}m out of bounds [{MIN_WALL_THICKNESS_M}-{MAX_WALL_THICKNESS_M}m]")

        # 5. Wall dimensions map
        wall_lengths = {
            "south": geom.length_m,
            "north": geom.length_m,
            "east":  geom.width_m,
            "west":  geom.width_m,
            "roof":  geom.length_m,
        }

        # 6. Openings validation: containment, corner margins, collisions
        openings_by_wall: Dict[str, List[OpeningSpec]] = {}
        for op in candidate.openings:
            openings_by_wall.setdefault(op.wall, []).append(op)

        for wall_name, ops in openings_by_wall.items():
            wall_w = wall_lengths.get(wall_name, geom.length_m)
            wall_h = geom.wall_height_m
            wall_gross_area = wall_w * wall_h

            total_opening_area = 0.0

            for op in ops:
                total_opening_area += op.area_m2

                # Left / Right margin check
                if op.position_x < MIN_CORNER_CLEARANCE_M:
                    reasons.append(f"Opening {op.id} position_x={op.position_x:.2f}m violates min corner margin {MIN_CORNER_CLEARANCE_M}m on {wall_name}")
                if (op.position_x + op.width_m) > (wall_w - MIN_CORNER_CLEARANCE_M):
                    reasons.append(f"Opening {op.id} extends to {(op.position_x + op.width_m):.2f}m beyond wall length {wall_w:.2f}m on {wall_name}")

                # Bottom / Top elevation check
                if op.position_z < 0.0:
                    reasons.append(f"Opening {op.id} position_z={op.position_z:.2f}m cannot be negative on {wall_name}")
                if (op.position_z + op.height_m) > (wall_h - MIN_TOP_CLEARANCE_M):
                    reasons.append(f"Opening {op.id} top elevation {(op.position_z + op.height_m):.2f}m exceeds eave limit {(wall_h - MIN_TOP_CLEARANCE_M):.2f}m on {wall_name}")

                if op.type == "door" and op.position_z > 0.1:
                    reasons.append(f"Door {op.id} sill elevation {op.position_z:.2f}m must be at floor level (z=0)")

            # Facade Window-to-Wall Ratio (WWR) check
            if wall_gross_area > 0 and (total_opening_area / wall_gross_area) > MAX_WINDOW_TO_WALL_RATIO:
                reasons.append(f"Opening area {total_opening_area:.2f}m² on {wall_name} exceeds {MAX_WINDOW_TO_WALL_RATIO*100:.0f}% WWR limit ({wall_gross_area:.2f}m² gross)")

            # Opening-to-Opening Collision Detection (pairwise AABB)
            for i in range(len(ops)):
                for j in range(i + 1, len(ops)):
                    op_a, op_b = ops[i], ops[j]
                    if _boxes_overlap_2d(op_a, op_b):
                        reasons.append(f"Collision/Overlap between opening {op_a.id} ({op_a.type}) and {op_b.id} ({op_b.type}) on {wall_name} wall")

        # 7. Material availability check
        mats_to_check = [
            wall.outer_layer.material_id,
            roof.material_id,
            candidate.floor_material_id
        ]
        if wall.insulation_layer:
            mats_to_check.append(wall.insulation_layer.material_id)
        if wall.inner_layer:
            mats_to_check.append(wall.inner_layer.material_id)
        for op in candidate.openings:
            mats_to_check.append(op.glass_material_id)

        for mid in mats_to_check:
            if not self.mat_repo.get(mid):
                reasons.append(f"Material ID '{mid}' not found in material database")

        is_valid = (len(reasons) == 0)
        return is_valid, reasons
