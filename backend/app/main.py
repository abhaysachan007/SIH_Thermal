from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import simulation, materials
from app.services.simulation_service import get_simulation_service

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

app.include_router(simulation.router)
app.include_router(materials.router)

@app.get('/health')
def health_check():
    return {'status': 'ok', 'service': 'ladakh-thermal-tool'}

@app.get('/')
def root():
    return {
        'message': 'Ladakh Passive Shelter Thermal Tool API v1.0',
        'docs': '/docs',
        'health': '/health',
    }
