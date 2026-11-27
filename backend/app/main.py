import os
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import simulation, materials, pipeline_router
from app.services.simulation_service import get_simulation_service
from app.db.database import init_db, get_db_status, get_history_from_db, get_connection

app = FastAPI(
    title='Ladakh Passive Shelter Thermal Tool API',
    description=(
        'Predicts and optimizes thermal performance of passive shelters '
        'in cold desert climates. Designed for Ladakh and similar high-altitude regions.'
    ),
    version='1.0.0',
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.on_event('startup')
async def startup_event():
    get_simulation_service()
    init_db()

app.include_router(simulation.router)
app.include_router(materials.router)
app.include_router(pipeline_router.router)

@app.get('/health')
def health_check():
    return {'status': 'ok', 'service': 'ladakh-thermal-tool'}

@app.get('/api/health/detailed')
def detailed_health_check():
    database = "unavailable"
    try:
        conn = get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
        finally:
            conn.close()
        database = "connected"
    except Exception:
        database = "unavailable"

    nasa_api = "unavailable"
    try:
        response = httpx.head("https://power.larc.nasa.gov", timeout=3.0)
        response.raise_for_status()
        nasa_api = "reachable"
    except Exception:
        nasa_api = "unavailable"

    mapdl_path = os.getenv("MAPDL_EXEC_PATH")
    ansys = "available" if mapdl_path and Path(mapdl_path).exists() else "mock_mode"
    service = get_simulation_service()
    active_jobs = sum(
        job.get("status") not in {"complete", "failed"}
        for job in service.jobs.values()
    )

    return {
        "status": "ok",
        "database": database,
        "nasa_api": nasa_api,
        "ansys": ansys,
        "active_jobs": active_jobs,
    }

@app.get('/api/db-status')
def db_status():
    """Returns live connection and table statistics from TiDB Cloud MySQL."""
    return get_db_status()

@app.get('/api/history')
def get_history(limit: int = 20):
    """Returns past simulation runs from TiDB Cloud database."""
    return {'history': get_history_from_db(limit)}

@app.get('/')
def root():
    return {
        'message': 'Ladakh Passive Shelter Thermal Tool API v1.0',
        'docs': '/docs',
        'health': '/health',
        'db_status': '/api/db-status',
        'history': '/api/history',
    }
