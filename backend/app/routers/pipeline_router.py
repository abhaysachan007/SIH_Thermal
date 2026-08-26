"""
app.routers.pipeline_router
===========================
FastAPI endpoints for Candidate Generation, Physical Screening,
Ranking, and Top-10 ANSYS Model Export.
"""
from fastapi import APIRouter, HTTPException
from typing import Optional, Dict, Any
from app.pipeline.models import UserDesignRequest, DesignSpaceConfig, PipelineOutput, CandidateShelter
from app.pipeline.pipeline_orchestrator import run_candidate_pipeline
from app.pipeline.material_repo import get_material_repo
from app.pipeline.geometry_validator import GeometryValidator

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


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
