"""
app.pipeline.pipeline_orchestrator
==================================
End-to-end pipeline runner orchestrating:
  Input Validation -> Design Space Generator -> Candidate Generation (1k-5k)
  -> Hard Constraint Filtering -> Fast Physical Screening
  -> Explainable Multi-Objective Ranking -> Diverse Top-10 Selection
  -> ANSYS Model Contract Export -> Detailed Evaluation.
"""
import logging
from typing import Optional, Dict, Any, List
from app.pipeline.models import (
    UserDesignRequest,
    DesignSpaceConfig,
    PipelineOutput,
    CandidateRankingResult,
)
from app.pipeline.climate_repo import load_climate_timeseries
from app.pipeline.candidate_generator import generate_candidate_shelters
from app.pipeline.geometry_validator import GeometryValidator
from app.pipeline.thermal_screening import ThermalScreeningEngine
from app.pipeline.ranking_engine import score_candidate, build_recommendation_summary
from app.pipeline.diversity_selector import select_diverse_top_10
from app.pipeline.ansys_adapter import build_ansys_contract_payload, run_ansys_evaluation

logger = logging.getLogger(__name__)


def run_candidate_pipeline(
    user_request: Optional[UserDesignRequest] = None,
    config: Optional[DesignSpaceConfig] = None
) -> PipelineOutput:
    req = user_request or UserDesignRequest()
    cfg = config or DesignSpaceConfig()

    # Apply user overrides to config weights
    cfg.comfort_weight = req.comfort_weight
    cfg.energy_weight = req.energy_weight
    cfg.cost_weight = req.cost_weight
    if req.min_area_m2: cfg.min_area_m2 = req.min_area_m2
    if req.max_area_m2: cfg.max_area_m2 = req.max_area_m2

    # 1. Load Climate Time-Series
    climate = load_climate_timeseries(
        profile_id=req.climate_profile_id,
        min_amb=req.min_ambient_temp_c,
        max_amb=req.max_ambient_temp_c,
        peak_solar=req.peak_solar_radiation_w_m2,
        use_live=req.use_live_climate
    )

    # 2. Generate Candidate Shelters from Design Space
    raw_candidates = generate_candidate_shelters(user_request=req, config=cfg)
    total_generated = len(raw_candidates)

    # 3. Hard Constraint Filtering & Geometry Validation
    validator = GeometryValidator()
    valid_candidates = []
    rejection_summary: Dict[str, int] = {}
    explainability_log: List[Dict[str, Any]] = []

    for cand in raw_candidates:
        is_val, reasons = validator.validate(cand, cfg)
        if is_val:
            valid_candidates.append(cand)
        else:
            for r in reasons:
                # Group key by category
                cat = r.split(":")[0] if ":" in r else r.split(" ")[0]
                rejection_summary[cat] = rejection_summary.get(cat, 0) + 1
            explainability_log.append({
                "candidate_id": cand.candidate_id,
                "status": "rejected",
                "reasons": reasons
            })

    # 4. Fast Physics-Based Thermal Pre-Screening Engine
    screening_engine = ThermalScreeningEngine()
    scored_results: List[CandidateRankingResult] = []

    for cand in valid_candidates:
        metrics = screening_engine.evaluate(cand, climate)
        score, breakdown, notes = score_candidate(cand, metrics, cfg)

        scored_results.append(CandidateRankingResult(
            rank=0,
            candidate_id=cand.candidate_id,
            design=cand,
            screening_results=metrics,
            score=score,
            score_breakdown=breakdown,
            explainability_notes=notes,
            ansys_status="pending"
        ))

    # Sort all screened candidates by composite score
    scored_results.sort(key=lambda x: -x.score)

    # 5. Diverse Top-10 Selector
    top_10 = select_diverse_top_10(scored_results, target_count=10)

    # 6. Generate ANSYS Contracts & Run Evaluations for Top 10
    sim_mode_detected = "FAST_PHYSICS"
    for cand_res in top_10:
        ansys_payload = build_ansys_contract_payload(cand_res.design, climate)
        cand_res.ansys_payload = ansys_payload

        if req.run_ansys_detailed:
            ansys_eval = run_ansys_evaluation(
                cand_res.design,
                climate,
                mode=req.ansys_mode
            )
            cand_res.ansys_results = ansys_eval
            cand_res.ansys_status = ansys_eval.get("status", "mock_completed")
            sim_mode_detected = ansys_eval.get("SIMULATION_MODE", "MOCK")
        else:
            cand_res.ansys_status = "pending"

    return PipelineOutput(
        total_candidates_generated=total_generated,
        valid_candidates=len(valid_candidates),
        screened_candidates=len(scored_results),
        top_10_candidates=top_10,
        rejection_summary=rejection_summary,
        recommendation_summary=build_recommendation_summary(top_10[0]) if top_10 else None,
        simulation_mode=f"FAST_PHYSICS + ANSYS_ADAPTER ({sim_mode_detected})",
        explainability_log=explainability_log[:100]  # sample of logs
    )
