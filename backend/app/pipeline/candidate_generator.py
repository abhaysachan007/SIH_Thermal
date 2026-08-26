"""
app.pipeline.candidate_generator
================================
Controlled parametric candidate shelter generator.
Explores the multidimensional design space (geometry, roof, multi-layer wall systems,
orientation, fenestrations) without combinatorial explosion.
Supports deterministic random seeding for reproducible benchmarks.
"""
import random
from typing import List, Generator, Optional
from app.pipeline.models import (
    CandidateShelter,
    GeometrySpec,
    RoofSpec,
    WallLayerSpec,
    WallSystemSpec,
    OpeningSpec,
    DesignSpaceConfig,
    UserDesignRequest,
)
from app.pipeline.geometry_validator import GeometryValidator


def _generate_valid_openings(length_m: float, height_m: float, window_area_m2: float, glazing_id: str) -> List[OpeningSpec]:
    """
    Parametrically generate 1 standard insulated door + evenly distributed south windows
    ensuring strictly valid non-overlapping coordinates and corner clearances.
    """
    openings = []

    # 1. Entrance Door (Left side of south wall)
    door_w = 0.90
    door_h = 2.10
    door_x = 0.40  # 0.4m from left corner
    openings.append(OpeningSpec(
        id="DOOR_S1",
        type="door",
        wall="south",
        position_x=door_x,
        position_z=0.0,
        width_m=door_w,
        height_m=door_h,
        glass_material_id="insulated_door"
    ))

    # 2. South Windows
    # Determine window count and individual dimensions
    if window_area_m2 <= 1.5:
        n_win = 1
        w_width, w_height = 1.20, 1.20
    elif window_area_m2 <= 3.0:
        n_win = 2
        w_width, w_height = 1.20, 1.20
    elif window_area_m2 <= 4.5:
        n_win = 3
        w_width, w_height = 1.20, 1.20
    else:
        n_win = 4
        w_width, w_height = 1.20, 1.20

    available_start_x = door_x + door_w + 0.40  # 0.4m clear from door
    available_end_x = length_m - 0.40           # 0.4m clear from right corner
    available_width = available_end_x - available_start_x

    if available_width >= (n_win * w_width + (n_win - 1) * 0.30):
        # Even spacing
        spacing = (available_width - (n_win * w_width)) / max(1, n_win)
        for i in range(n_win):
            wx = available_start_x + i * (w_width + spacing) + spacing / 2.0
            openings.append(OpeningSpec(
                id=f"WIN_S{i+1}",
                type="window",
                wall="south",
                position_x=round(wx, 3),
                position_z=0.90,  # 0.9m sill height
                width_m=w_width,
                height_m=w_height,
                glass_material_id=glazing_id
            ))
    else:
        # Fallback to single compact window if space is constrained
        openings.append(OpeningSpec(
            id="WIN_S1",
            type="window",
            wall="south",
            position_x=round(available_start_x + 0.20, 3),
            position_z=0.90,
            width_m=1.00,
            height_m=1.00,
            glass_material_id=glazing_id
        ))

    return openings


def generate_candidate_shelters(
    user_request: Optional[UserDesignRequest] = None,
    config: Optional[DesignSpaceConfig] = None,
    limit: Optional[int] = None
) -> List[CandidateShelter]:
    """
    Generate valid parametric shelter candidate designs from the design space.
    """
    cfg = config or DesignSpaceConfig()
    if cfg.random_seed is not None:
        random.seed(cfg.random_seed)

    max_limit = limit or cfg.max_candidates
    validator = GeometryValidator()

    # Geometry ranges
    if user_request and user_request.length_m:
        lengths = [user_request.length_m]
    else:
        lengths = []
        l = cfg.min_length_m
        while l <= cfg.max_length_m + 1e-4:
            lengths.append(round(l, 2))
            l += cfg.length_step_m

    if user_request and user_request.width_m:
        widths = [user_request.width_m]
    else:
        widths = []
        w = cfg.min_width_m
        while w <= cfg.max_width_m + 1e-4:
            widths.append(round(w, 2))
            w += cfg.width_step_m

    heights = [user_request.height_m] if (user_request and user_request.height_m) else [2.80, 3.20]

    candidates: List[CandidateShelter] = []
    seen_hashes = set()

    for L in lengths:
        for W in widths:
            if W > L:
                continue  # Standard architectural convention L >= W

            for H in heights:
                for shape in cfg.supported_shapes:
                    if shape == "square" and abs(L - W) > 0.1:
                        continue

                    for roof_type in cfg.supported_roof_types:
                        angles = [0.0] if roof_type == "flat" else [20.0, 30.0]
                        for angle in angles:
                            for w_sys in cfg.wall_systems:
                                # Build wall system spec
                                if w_sys["type"] == "single":
                                    for t in w_sys["thicknesses"]:
                                        wall_spec = WallSystemSpec(
                                            wall_type="single",
                                            outer_layer=WallLayerSpec(material_id=w_sys["outer"], thickness_m=t)
                                        )
                                        for orient in cfg.orientations_deg:
                                            for win_area in cfg.window_south_area_options_m2:
                                                for glaz in cfg.glazing_options:
                                                    openings = _generate_valid_openings(L, H, win_area, glaz)
                                                    
                                                    cand = CandidateShelter(
                                                        geometry=GeometrySpec(shape=shape, length_m=L, width_m=W, wall_height_m=H),
                                                        roof=RoofSpec(type=roof_type, angle_deg=angle, thickness_m=0.20, material_id="mud_brick"),
                                                        wall_system=wall_spec,
                                                        floor_material_id="rammed_earth",
                                                        floor_thickness_m=0.15,
                                                        openings=openings,
                                                        orientation_deg=orient,
                                                        target_occupancy=user_request.required_occupancy if user_request else 4,
                                                        variant_label=f"{w_sys['outer'].replace('_',' ').title()} {t*100:.0f}cm | {roof_type.title()} | {win_area:.1f}m² Win"
                                                    )

                                                    # Hash for uniqueness
                                                    h_str = f"{L}_{W}_{H}_{shape}_{roof_type}_{angle}_{w_sys['outer']}_{t}_{orient}_{win_area}_{glaz}"
                                                    if h_str not in seen_hashes:
                                                        seen_hashes.add(h_str)
                                                        candidates.append(cand)
                                                        if len(candidates) >= max_limit:
                                                            return candidates

                                elif w_sys["type"] == "composite":
                                    for ins_t in w_sys["ins_t"]:
                                        wall_spec = WallSystemSpec(
                                            wall_type="composite",
                                            outer_layer=WallLayerSpec(material_id=w_sys["outer"], thickness_m=w_sys["outer_t"]),
                                            insulation_layer=WallLayerSpec(material_id=w_sys["insulation"], thickness_m=ins_t),
                                            inner_layer=WallLayerSpec(material_id=w_sys["inner"], thickness_m=w_sys["inner_t"]),
                                        )
                                        for orient in cfg.orientations_deg:
                                            for win_area in cfg.window_south_area_options_m2:
                                                for glaz in cfg.glazing_options:
                                                    openings = _generate_valid_openings(L, H, win_area, glaz)
                                                    
                                                    cand = CandidateShelter(
                                                        geometry=GeometrySpec(shape=shape, length_m=L, width_m=W, wall_height_m=H),
                                                        roof=RoofSpec(type=roof_type, angle_deg=angle, thickness_m=0.22, material_id="mud_brick"),
                                                        wall_system=wall_spec,
                                                        floor_material_id="rammed_earth",
                                                        floor_thickness_m=0.15,
                                                        openings=openings,
                                                        orientation_deg=orient,
                                                        target_occupancy=user_request.required_occupancy if user_request else 4,
                                                        variant_label=f"{w_sys['outer'].replace('_',' ').title()} + {ins_t*100:.0f}cm {w_sys['insulation'].split('_')[0].upper()} | {roof_type.title()}"
                                                    )

                                                    h_str = f"{L}_{W}_{H}_{shape}_{roof_type}_{angle}_{w_sys['outer']}_{w_sys['insulation']}_{ins_t}_{orient}_{win_area}_{glaz}"
                                                    if h_str not in seen_hashes:
                                                        seen_hashes.add(h_str)
                                                        candidates.append(cand)
                                                        if len(candidates) >= max_limit:
                                                            return candidates

    return candidates
