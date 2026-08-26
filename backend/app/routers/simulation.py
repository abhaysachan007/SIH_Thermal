from fastapi import APIRouter, HTTPException
from app.models.schemas import ShelterInput, CompareRequest
from app.services.simulation_service import get_simulation_service

router = APIRouter(prefix='/api', tags=['simulation'])

@router.post('/simulate')
async def submit_simulation(shelter_input: ShelterInput):
    svc = get_simulation_service()
    if shelter_input.climate_profile_id not in svc.climate_db:
        raise HTTPException(status_code=400, detail=f'Unknown climate_profile_id: {shelter_input.climate_profile_id}')
    if shelter_input.wall_material_id != 'custom' and shelter_input.wall_material_id not in svc.materials_db:
        raise HTTPException(status_code=400, detail=f'Unknown wall_material_id: {shelter_input.wall_material_id}')
    job_id = await svc.submit_simulation(shelter_input)
    return {'job_id': job_id, 'status': 'queued'}

@router.get('/results/{job_id}')
async def get_result(job_id: str):
    svc = get_simulation_service()
    job = await svc.get_result(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f'Job not found: {job_id}')
    return job

@router.post('/compare')
async def submit_compare(req: CompareRequest):
    svc = get_simulation_service()
    job_id = await svc.submit_compare(req.variants)
    return {'job_id': job_id, 'status': 'queued'}

@router.get('/compare/{job_id}')
async def get_compare_result(job_id: str):
    svc = get_simulation_service()
    job = await svc.get_compare_result(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f'Comparison job not found: {job_id}')
    return job

@router.post('/jobs/{job_id}/open-ansys')
async def trigger_open_ansys_gui(job_id: str, payload: dict = None):
    """Launch native ANSYS MAPDL GUI on the desktop with the 3D model."""
    try:
        from app.services.ansys_engine import open_ansys_gui
        svc = get_simulation_service()
        job_data = svc.jobs.get(job_id, {})
        shelter_input = job_data.get("input")
        if shelter_input is None and payload:
            class DummyInput:
                pass
            shelter_input = DummyInput()
            for k, v in payload.items():
                setattr(shelter_input, k, v)

        res = open_ansys_gui(job_id, shelter_input, svc.materials_db)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to launch ANSYS"))
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize")
async def optimize_shelter(payload: dict):
    """
    AI Auto-Optimizer: runs a 36-design parameter sweep using FDM
    and returns the top 3 optimal designs scored by warmth, comfort,
    efficiency, and cost. The user's geometry (L/W/H) is kept fixed;
    only material, thickness, windows, and orientation are varied.
    """
    from app.services.optimizer import run_optimizer

    svc = get_simulation_service()

    # Wrap payload dict as attribute-accessible object
    class _Base:
        pass
    base = _Base()
    for k, v in payload.items():
        setattr(base, k, v)

    climate_id = payload.get("climate_profile_id", "ladakh_winter")
    climate    = svc.climate_db.get(climate_id) or list(svc.climate_db.values())[0]

    try:
        result = await run_optimizer(base, svc.materials_db, climate)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimizer error: {e}")
