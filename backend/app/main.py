from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import simulation, materials, pipeline_router
from app.services.simulation_service import get_simulation_service
from app.db.database import init_db, get_db_status, get_history_from_db

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

