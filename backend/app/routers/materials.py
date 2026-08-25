from fastapi import APIRouter, HTTPException
from app.services.simulation_service import get_simulation_service

router = APIRouter(prefix='/api', tags=['materials'])

@router.get('/materials')
def get_materials():
    svc = get_simulation_service()
    return list(svc.materials_db.values())

@router.get('/materials/{material_id}')
def get_material(material_id: str):
    svc = get_simulation_service()
    if material_id not in svc.materials_db:
        raise HTTPException(status_code=404, detail=f'Material not found: {material_id}')
    return svc.materials_db[material_id]

@router.get('/climate-profiles')
def get_climate_profiles():
    svc = get_simulation_service()
    return [
        {'id': p['id'], 'name': p['name'], 'description': p['description']}
        for p in svc.climate_db.values()
    ]

@router.get('/climate-profiles/{profile_id}')
def get_climate_profile(profile_id: str):
    svc = get_simulation_service()
    if profile_id not in svc.climate_db:
        raise HTTPException(status_code=404, detail=f'Climate profile not found: {profile_id}')
    return svc.climate_db[profile_id]
