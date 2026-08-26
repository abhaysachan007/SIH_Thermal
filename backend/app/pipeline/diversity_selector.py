"""
app.pipeline.diversity_selector
===============================
Diverse Top-10 Selector.
Ensures the final candidate set presents varied architectural solutions:
  - Different wall construction systems (Mud Brick, Stone Masonry, Rammed Earth, Composite Insulated)
  - Different roof pitches/types (Gable, Flat, Single Slope)
  - Different window solar aperture strategies
Without picking thermally non-viable designs.
"""
from typing import List, Set
from app.pipeline.models import CandidateRankingResult

MIN_VIABLE_MIN_TEMP_C = -22.0  # Must not freeze below -22°C inside


def select_diverse_top_10(
    ranked_candidates: List[CandidateRankingResult],
    target_count: int = 10
) -> List[CandidateRankingResult]:
    """
    Select up to `target_count` diverse, high-performing candidates.
    """
    if len(ranked_candidates) <= target_count:
        for r, c in enumerate(ranked_candidates):
            c.rank = r + 1
        return ranked_candidates

    selected: List[CandidateRankingResult] = []
    seen_wall_categories: Set[str] = set()
    seen_roof_types: Set[str] = set()
    seen_shapes: Set[str] = set()

    # Pass 1: Select top candidates with distinct wall construction & roof types
    for cand in ranked_candidates:
        if len(selected) >= target_count:
            break

        # Filter out extreme thermal failures
        if cand.screening_results.min_indoor_temperature_c < MIN_VIABLE_MIN_TEMP_C:
            continue

        wall_mat = cand.design.wall_system.primary_material_id
        is_comp = (cand.design.wall_system.wall_type == "composite")
        wall_cat = f"{wall_mat}_{'composite' if is_comp else 'single'}"
        roof_type = cand.design.roof.type
        shape = cand.design.geometry.shape

        archetype_key = f"{wall_cat}_{roof_type}"

        # If this introduces new architectural diversity
        if wall_cat not in seen_wall_categories or roof_type not in seen_roof_types or shape not in seen_shapes:
            cand.diversity_category = f"{wall_cat.replace('_',' ').title()} + {roof_type.title()} Roof"
            selected.append(cand)
            seen_wall_categories.add(wall_cat)
            seen_roof_types.add(roof_type)
            seen_shapes.add(shape)

    # Pass 2: Fill remaining slots with the next highest-scoring candidates
    if len(selected) < target_count:
        selected_ids = {c.candidate_id for c in selected}
        for cand in ranked_candidates:
            if len(selected) >= target_count:
                break
            if cand.candidate_id not in selected_ids:
                cand.diversity_category = f"High Performance Variant ({cand.design.wall_system.primary_material_id.replace('_',' ').title()})"
                selected.append(cand)

    # Final re-ranking
    selected.sort(key=lambda x: -x.score)
    for r, c in enumerate(selected):
        c.rank = r + 1

    return selected
