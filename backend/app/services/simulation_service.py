import asyncio
import uuid
import json
from pathlib import Path
from typing import Dict, Optional, List

from app.services.fallback_engine import run_fdm_simulation
from app.services.results_processor import process_raw_results
from app.services.recommendation import generate_recommendation

def _select_and_run(shelter_input, materials_db, climate_profile):
    """Route to ANSYS or FDM engine based on the engine field."""
    engine = getattr(shelter_input, 'engine', 'auto')
    if engine == 'ansys' or engine == 'auto':
        try:
            from app.services.ansys_engine import run_ansys_simulation
            return run_ansys_simulation(shelter_input, materials_db, climate_profile)
        except Exception:
            pass  # FDM fallback below
    return run_fdm_simulation(shelter_input, materials_db, climate_profile)

DATA_DIR = Path(__file__).parent.parent / 'data'

class SimulationService:
    def __init__(self):
        self.jobs: Dict[str, dict] = {}
        self.compare_jobs: Dict[str, dict] = {}
        self.materials_db: dict = {}
        self.climate_db: dict = {}

    def load_data(self):
        with open(DATA_DIR / 'materials.json', encoding='utf-8-sig') as f:
            materials_list = json.load(f)
            self.materials_db = {m['id']: m for m in materials_list}
        with open(DATA_DIR / 'climate_profiles.json', encoding='utf-8-sig') as f:
            self.climate_db = json.load(f)

    async def submit_simulation(self, shelter_input) -> str:
        job_id = str(uuid.uuid4())
        self.jobs[job_id] = {'status': 'queued', 'job_id': job_id, 'input': shelter_input}
        asyncio.create_task(self._run_single(job_id, shelter_input))
        return job_id

    async def get_result(self, job_id: str) -> Optional[dict]:
        return self.jobs.get(job_id)

    async def submit_compare(self, variants: list) -> str:
        job_id = str(uuid.uuid4())
        self.compare_jobs[job_id] = {
            'status': 'queued',
            'job_id': job_id,
            'results': [],
            'best_variant_label': None,
            'recommendation_text': None,
            'recommendation_reasons': [],
        }
        asyncio.create_task(self._run_compare(job_id, variants))
        return job_id

    async def get_compare_result(self, job_id: str) -> Optional[dict]:
        return self.compare_jobs.get(job_id)

    async def _run_single(self, job_id: str, shelter_input):
        self.jobs[job_id]['status'] = 'running'
        try:
            climate_profile = self.climate_db[shelter_input.climate_profile_id]
            loop = asyncio.get_event_loop()
            raw = await loop.run_in_executor(
                None, _select_and_run, shelter_input, self.materials_db, climate_profile
            )
            raw = process_raw_results(raw)
            raw['status'] = 'complete'
            raw['job_id'] = job_id
            raw['engine_used'] = raw.get('engine_used', 'python_fdm')
            raw['variant_label'] = shelter_input.variant_label or 'Design 1'
            self.jobs[job_id].update(raw)
        except Exception as e:
            import traceback
            self.jobs[job_id]['status'] = 'failed'
            self.jobs[job_id]['error_message'] = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"

    async def _run_compare(self, job_id: str, variants: list):
        self.compare_jobs[job_id]['status'] = 'running'
        results = []
        try:
            for i, variant in enumerate(variants):
                if not variant.variant_label:
                    variant.variant_label = f'Design {i + 1}'
                climate_profile = self.climate_db[variant.climate_profile_id]
                loop = asyncio.get_event_loop()
                raw = await loop.run_in_executor(
                    None, _select_and_run, variant, self.materials_db, climate_profile
                )
                raw = process_raw_results(raw)
                raw['job_id'] = str(uuid.uuid4())
                raw['status'] = 'complete'
                raw['engine_used'] = raw.get('engine_used', 'python_fdm')
                raw['variant_label'] = variant.variant_label
                results.append(raw)
            rec = generate_recommendation(results)
            self.compare_jobs[job_id].update({
                'status': 'complete',
                'results': results,
                **rec,
            })
        except Exception as e:
            import traceback
            self.compare_jobs[job_id]['status'] = 'failed'
            self.compare_jobs[job_id]['error_message'] = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"

_service_instance: Optional[SimulationService] = None

def get_simulation_service() -> SimulationService:
    global _service_instance
    if _service_instance is None:
        _service_instance = SimulationService()
        _service_instance.load_data()
    return _service_instance
