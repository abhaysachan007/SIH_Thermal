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

@router.get("/climate/live")
async def get_live_climate(
    latitude: float = 34.15,
    longitude: float = 77.57,
    date: str = None,
    season: str = "winter",
):
    """
    Fetch a live hourly climate profile from the NASA POWER API and register
    it so it can be used as a climate_profile_id ('nasa_live'). Falls back
    with a clear message if the live fetch fails — never raises.
    """
    from app.services.nasa_climate import fetch_nasa_climate

    svc = get_simulation_service()
    profile, note = fetch_nasa_climate(latitude, longitude, date, season)
    if profile is None:
        return {"ok": False, "detail": note}

    svc.climate_db[profile["id"]] = profile
    temps = [h["ambient_temp_C"] for h in profile["hourly_data"]]
    solars = [h["solar_irradiance_W_m2"] for h in profile["hourly_data"]]
    return {
        "ok": True,
        "climate_profile_id": profile["id"],
        "name": profile["name"],
        "source": profile.get("source"),
        "source_date": profile.get("source_date"),
        "min_temp_C": round(min(temps), 2) if temps else None,
        "max_temp_C": round(max(temps), 2) if temps else None,
        "peak_solar_W_m2": round(max(solars), 2) if solars else None,
    }


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
