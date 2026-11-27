"""
app.routers.pipeline_router
===========================
FastAPI endpoints for Candidate Generation, Physical Screening,
Ranking, and Top-10 ANSYS Model Export.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from types import SimpleNamespace
from app.pipeline.models import (
    CandidateRankingResult,
    UserDesignRequest,
    PipelineOutput,
    CandidateShelter,
)
from app.pipeline.pipeline_orchestrator import run_candidate_pipeline
from app.pipeline.material_repo import get_material_repo
from app.pipeline.geometry_validator import GeometryValidator
from app.services.cost_estimator import estimate_costs

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


class BudgetOptimizeRequest(BaseModel):
    target_min_temp_c: float = 15.0
    max_budget_inr: float = Field(ge=0)
    shelter_config: UserDesignRequest


class BudgetOptimizeResponse(BaseModel):
    feasible: bool
    cheapest_designs: list[CandidateRankingResult]
    cheapest_cost_inr: Optional[float] = None
    gap_if_infeasible: str


def _estimate_candidate_cost(candidate) -> float:
    design = candidate.design
    cost_input = SimpleNamespace(
        length_m=design.geometry.length_m,
        width_m=design.geometry.width_m,
        height_m=design.geometry.wall_height_m,
        wall_thickness_m=design.wall_system.total_thickness_m,
        wall_material_id=design.wall_system.primary_material_id,
        roof_thickness_m=design.roof.thickness_m,
        roof_material_id=design.roof.material_id,
        floor_thickness_m=design.floor_thickness_m,
        floor_material_id=design.floor_material_id,
        openings=[
            {
                "type": opening.type,
                "width_m": opening.width_m,
                "height_m": opening.height_m,
                "count": 1,
                "glazing_material_id": opening.glass_material_id,
            }
            for opening in design.openings
        ],
    )
    estimate = estimate_costs(cost_input, {})
    return float(estimate["cost_estimate"]["material_cost_inr"])


@router.post("/generate-and-screen", response_model=PipelineOutput)
async def generate_and_screen_candidates(payload: Optional[UserDesignRequest] = None):
    """
    Execute full candidate generation, hard constraint filtering,
    transient physics screening, multi-objective ranking, and ANSYS Top 10 export.
    """
    try:
        req = payload or UserDesignRequest()
        result = run_candidate_pipeline(req)
        return result
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Pipeline execution error: {e}\n{traceback.format_exc()}")


@router.post("/budget-optimize", response_model=BudgetOptimizeResponse)
async def optimize_candidates_for_budget(payload: BudgetOptimizeRequest):
    try:
        result = run_candidate_pipeline(payload.shelter_config)
        candidates = result.top_10_candidates
        for candidate in candidates:
            candidate.estimated_cost_inr = _estimate_candidate_cost(candidate)

        qualifying = sorted(
            (
                candidate for candidate in candidates
                if candidate.screening_results.min_indoor_temperature_c >= payload.target_min_temp_c
            ),
            key=lambda candidate: candidate.estimated_cost_inr,
        )
        cheapest_cost = qualifying[0].estimated_cost_inr if qualifying else None
        feasible = cheapest_cost is not None and cheapest_cost <= payload.max_budget_inr
        if not qualifying:
            gap = (
                f"No screened design reaches the target minimum indoor temperature "
                f"of {payload.target_min_temp_c:.1f}°C."
            )
        elif not feasible:
            gap = (
                f"The cheapest design meeting the temperature target costs "
                f"₹{cheapest_cost:,.0f}, which is ₹{cheapest_cost - payload.max_budget_inr:,.0f} "
                f"over the ₹{payload.max_budget_inr:,.0f} budget."
            )
        else:
            gap = ""

        return BudgetOptimizeResponse(
            feasible=feasible,
            cheapest_designs=qualifying[:3],
            cheapest_cost_inr=cheapest_cost,
            gap_if_infeasible=gap,
        )
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Budget optimization error: {e}\n{traceback.format_exc()}",
        )


@router.get("/materials")
async def list_pipeline_materials():
    """List all centralized materials with standard SI thermal properties."""
    repo = get_material_repo()
    return repo.list_all()


@router.post("/validate-geometry")
async def validate_candidate_geometry(candidate: CandidateShelter):
    """Validate single candidate geometry for boundary containment and opening collisions."""
    validator = GeometryValidator()
    is_valid, reasons = validator.validate(candidate)
    return {
        "candidate_id": candidate.candidate_id,
        "is_valid": is_valid,
        "rejection_reasons": reasons
    }
