import asyncio
import csv
import io
import json
import re
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from pydantic import ValidationError
from app.models.schemas import ShelterInput, CompareRequest
from app.services.simulation_service import get_simulation_service

router = APIRouter(prefix='/api', tags=['simulation'])


class BatchSimulationSite(BaseModel):
    name: str = Field(min_length=1)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    shelter_config: ShelterInput


class BatchSimulationRequest(BaseModel):
    sites: list[BatchSimulationSite] = Field(min_length=1, max_length=10)


def _hourly_values(series: list[dict]) -> dict[int, float]:
    return {
        int(round(point['hour'])): float(point['value'])
        for point in series
        if point.get('hour') is not None
        and point.get('value') is not None
        and 0 <= point['hour'] < 24
        and abs(point['hour'] - round(point['hour'])) < 1e-6
    }


def _hourly_export_rows(result: dict, climate_profile: dict | None) -> list[dict]:
    ambient = _hourly_values(result.get('ambient_temperature_series', []))
    solar_irradiance = _hourly_values(result.get('solar_irradiance_series', []))
    indoor = _hourly_values(result.get('inside_temperature_series', []))
    solar_gain = _hourly_values(result.get('solar_gain_series', []))

    if not solar_irradiance and climate_profile:
        solar_irradiance = {
            int(hour['hour']): float(hour['solar_irradiance_W_m2'])
            for hour in climate_profile.get('hourly_data', [])
            if 0 <= hour.get('hour', -1) < 24
        }

    heat_loss = {hour: 0.0 for hour in range(24)}
    for component in result.get('heat_flow_series', []):
        for point in component.get('heat_flow_series', []):
            hour = point.get('hour')
            value = point.get('value')
            if hour is not None and value is not None and 0 <= hour < 24:
                rounded_hour = int(round(hour))
                if abs(hour - rounded_hour) < 1e-6:
                    heat_loss[rounded_hour] += max(0.0, -float(value))

    rows = []
    for hour in range(24):
        solar_gain_w = solar_gain.get(hour)
        heat_loss_w = heat_loss[hour] if result.get('heat_flow_series') else None
        rows.append({
            'hour': hour,
            'ambient_temp_c': ambient.get(hour),
            'solar_irradiance_w_m2': solar_irradiance.get(hour),
            'indoor_temp_c': indoor.get(hour),
            'heat_loss_w': heat_loss_w,
            'solar_gain_w': solar_gain_w,
            'net_heat_w': (
                solar_gain_w - heat_loss_w
                if solar_gain_w is not None and heat_loss_w is not None
                else None
            ),
        })
    return rows


@router.get('/export/{job_id}')
async def export_simulation(job_id: str, format: str = 'json'):
    if format not in {'json', 'csv'}:
        raise HTTPException(status_code=400, detail="format must be 'json' or 'csv'")

    svc = get_simulation_service()
    job = svc.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f'Job not found: {job_id}')
    if job.get('status') != 'complete':
        raise HTTPException(status_code=409, detail=f'Simulation is not complete: {job_id}')

    safe_job_id = re.sub(r'[^A-Za-z0-9._-]', '_', job_id)
    if format == 'json':
        content = json.dumps(jsonable_encoder(job), ensure_ascii=False, indent=2)
        return Response(
            content=content,
            media_type='application/json',
            headers={'Content-Disposition': f'attachment; filename="{safe_job_id}.json"'},
        )

    input_config = job.get('input')
    if hasattr(input_config, 'model_dump'):
        input_config = input_config.model_dump()
    input_config = input_config or job.get('input_config', {})
    climate_profile = svc.climate_db.get(input_config.get('climate_profile_id'))
    rows = _hourly_export_rows(job, climate_profile)
    output = io.StringIO(newline='')
    columns = [
        'hour',
        'ambient_temp_c',
        'solar_irradiance_w_m2',
        'indoor_temp_c',
        'heat_loss_w',
        'solar_gain_w',
        'net_heat_w',
    ]
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=output.getvalue(),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{safe_job_id}.csv"'},
    )


@router.post('/validate-model')
async def validate_model_endpoint(
    shelter_config: str = Form(...),
    sensor_csv: UploadFile = File(...),
):
    from app.services.validation_service import validate_model

    if sensor_csv.filename and not sensor_csv.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail='sensor_csv must be a CSV file')

    try:
        shelter_input = ShelterInput.model_validate_json(shelter_config)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    svc = get_simulation_service()
    if shelter_input.climate_profile_id not in svc.climate_db:
        raise HTTPException(
            status_code=400,
            detail=f'Unknown climate_profile_id: {shelter_input.climate_profile_id}',
        )
    if shelter_input.wall_material_id != 'custom' and shelter_input.wall_material_id not in svc.materials_db:
        raise HTTPException(
            status_code=400,
            detail=f'Unknown wall_material_id: {shelter_input.wall_material_id}',
        )

    try:
        csv_content = (await sensor_csv.read()).decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail='sensor_csv must be UTF-8 encoded') from exc

    try:
        return await asyncio.to_thread(validate_model, shelter_input, csv_content, svc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/simulate')
async def submit_simulation(shelter_input: ShelterInput):
    svc = get_simulation_service()
    if shelter_input.climate_profile_id not in svc.climate_db:
        raise HTTPException(status_code=400, detail=f'Unknown climate_profile_id: {shelter_input.climate_profile_id}')
    if shelter_input.wall_material_id != 'custom' and shelter_input.wall_material_id not in svc.materials_db:
        raise HTTPException(status_code=400, detail=f'Unknown wall_material_id: {shelter_input.wall_material_id}')
    job_id = await svc.submit_simulation(shelter_input)
    return {'job_id': job_id, 'status': 'queued'}


@router.post('/batch-simulate')
async def submit_batch_simulation(request: BatchSimulationRequest):
    from app.services.nasa_climate import fetch_nasa_climate

    svc = get_simulation_service()
    batch_id = str(uuid.uuid4())

    async def run_site(index: int, site: BatchSimulationSite):
        profile, note = await asyncio.to_thread(fetch_nasa_climate, site.lat, site.lon)
        if profile is None:
            return {
                'site_name': site.name,
                'status': 'failed',
                'result': {'error_message': note},
            }

        profile_id = f'nasa_live_{batch_id}_{index}'
        profile['id'] = profile_id
        svc.climate_db[profile_id] = profile
        shelter_input = site.shelter_config.model_copy(update={
            'climate_profile_id': profile_id,
            'min_ambient_temp_C': None,
            'max_ambient_temp_C': None,
            'peak_solar_radiation_W_m2': None,
            'variant_label': site.name,
        })
        job_id = str(uuid.uuid4())
        svc.jobs[job_id] = {'status': 'queued', 'job_id': job_id, 'input': shelter_input}
        try:
            await svc._run_single(job_id, shelter_input)
            result = await svc.get_result(job_id)
            status = result.get('status', 'failed') if result else 'failed'
            return {'site_name': site.name, 'status': status, 'result': result}
        finally:
            svc.climate_db.pop(profile_id, None)

    results = await asyncio.gather(
        *(run_site(index, site) for index, site in enumerate(request.sites))
    )
    return {'batch_id': batch_id, 'results': results}


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
