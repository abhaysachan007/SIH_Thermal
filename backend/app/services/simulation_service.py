import asyncio
import uuid
import json
from pathlib import Path
from typing import Dict, Optional, List

from app.services.fallback_engine import run_fdm_simulation
from app.services.results_processor import process_raw_results
from app.services.recommendation import generate_recommendation

def scale_climate_profile(profile: dict, min_amb: Optional[float] = None, max_amb: Optional[float] = None, peak_solar: Optional[float] = None) -> dict:
    """
    Scale 24-hour diurnal profile dynamically based on user-specified
    min/max ambient temperature and peak solar radiation flux.
    """
    if min_amb is None and max_amb is None and peak_solar is None:
        return profile

    new_prof = {
        'id': profile.get('id', 'custom_climate'),
        'name': profile.get('name', 'Custom Environment'),
        'description': profile.get('description', ''),
        'latitude': profile.get('latitude', 34.15),
        'altitude_m': profile.get('altitude_m', 3524),
        'season': profile.get('season', 'winter'),
        'hourly_data': []
    }

    orig_hourly = profile.get('hourly_data', [])
    if not orig_hourly:
        return profile

    orig_temps = [h['ambient_temp_C'] for h in orig_hourly]
    orig_solars = [h['solar_irradiance_W_m2'] for h in orig_hourly]

    orig_min_t = min(orig_temps)
    orig_max_t = max(orig_temps)
    t_span = orig_max_t - orig_min_t if (orig_max_t - orig_min_t) > 1e-4 else 1.0

    target_min_t = min_amb if min_amb is not None else orig_min_t
    target_max_t = max_amb if max_amb is not None else orig_max_t
    if target_max_t < target_min_t:
        target_max_t = target_min_t + 5.0
    target_span = target_max_t - target_min_t

    orig_peak_solar = max(orig_solars) if orig_solars else 0.0
    target_peak_solar = peak_solar if peak_solar is not None else orig_peak_solar
    solar_scale = (target_peak_solar / orig_peak_solar) if (orig_peak_solar > 1e-4 and target_peak_solar is not None) else 1.0

    for h in orig_hourly:
        norm_t = (h['ambient_temp_C'] - orig_min_t) / t_span
        scaled_t = target_min_t + norm_t * target_span
        scaled_solar = max(0.0, h['solar_irradiance_W_m2'] * solar_scale)
        new_prof['hourly_data'].append({
            'hour': h['hour'],
            'ambient_temp_C': round(float(scaled_t), 2),
            'solar_irradiance_W_m2': round(float(scaled_solar), 2),
            'wind_speed_m_s': h.get('wind_speed_m_s', 2.0),
        })

    return new_prof


def _select_and_run(shelter_input, materials_db, climate_profile):
    """Route to ANSYS PyMAPDL or Python FDM engine based on the engine field."""
    engine = getattr(shelter_input, 'engine', 'auto')
    if engine == 'fdm':
        result = run_fdm_simulation(shelter_input, materials_db, climate_profile)
        result['engine_used'] = 'python_fdm'
        return result
    if engine == 'ansys' or engine == 'auto':
        try:
            from app.services.ansys_engine import run_ansys_simulation
            return run_ansys_simulation(shelter_input, materials_db, climate_profile)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"ANSYS engine failed ({e}), using Python FDM")
    result = run_fdm_simulation(shelter_input, materials_db, climate_profile)
    result['engine_used'] = 'python_fdm'
    return result

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
        res = self.jobs.get(job_id)
        if not res or res.get('status') == 'queued':
            try:
                from app.db.database import get_simulation_from_db
                db_res = get_simulation_from_db(job_id)
                if db_res:
                    self.jobs[job_id] = db_res
                    return db_res
            except Exception:
                pass
        return res

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
        res = self.compare_jobs.get(job_id)
        if not res or res.get('status') == 'queued':
            try:
                from app.db.database import get_comparison_from_db
                db_res = get_comparison_from_db(job_id)
                if db_res:
                    self.compare_jobs[job_id] = db_res
                    return db_res
            except Exception:
                pass
        return res

    async def _run_single(self, job_id: str, shelter_input):
        self.jobs[job_id]['status'] = 'running'
        try:
            base_climate = self.climate_db.get(shelter_input.climate_profile_id, list(self.climate_db.values())[0])
            climate_profile = scale_climate_profile(
                base_climate,
                min_amb=getattr(shelter_input, 'min_ambient_temp_C', None),
                max_amb=getattr(shelter_input, 'max_ambient_temp_C', None),
                peak_solar=getattr(shelter_input, 'peak_solar_radiation_W_m2', None),
            )
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

            # Persist to TiDB Cloud MySQL
            try:
                from app.db.database import save_simulation
                save_simulation(job_id, shelter_input, raw)
            except Exception as dbe:
                pass
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
                base_climate = self.climate_db.get(variant.climate_profile_id, list(self.climate_db.values())[0])
                climate_profile = scale_climate_profile(
                    base_climate,
                    min_amb=getattr(variant, 'min_ambient_temp_C', None),
                    max_amb=getattr(variant, 'max_ambient_temp_C', None),
                    peak_solar=getattr(variant, 'peak_solar_radiation_W_m2', None),
                )
                loop = asyncio.get_event_loop()
                raw = await loop.run_in_executor(
                    None, _select_and_run, variant, self.materials_db, climate_profile
                )
                raw = process_raw_results(raw)
                raw['job_id'] = str(uuid.uuid4())
                raw['status'] = 'complete'
                raw['engine_used'] = raw.get('engine_used', 'python_fdm')
                raw['variant_label'] = variant.variant_label
                raw['input_config'] = {
                    'variant_label': variant.variant_label,
                    'length_m': getattr(variant, 'length_m', 6.0),
                    'width_m': getattr(variant, 'width_m', 4.0),
                    'height_m': getattr(variant, 'height_m', 3.0),
                    'wall_thickness_m': getattr(variant, 'wall_thickness_m', 0.35),
                    'wall_material_id': getattr(variant, 'wall_material_id', 'mud_brick'),
                    'roof_material_id': getattr(variant, 'roof_material_id', 'mud_brick'),
                    'floor_material_id': getattr(variant, 'floor_material_id', 'rammed_earth'),
                    'roof_thickness_m': getattr(variant, 'roof_thickness_m', 0.20),
                    'floor_thickness_m': getattr(variant, 'floor_thickness_m', 0.20),
                    'orientation_deg': getattr(variant, 'orientation_deg', 180),
                    'shape': getattr(variant, 'shape', 'rectangular'),
                    'openings': [o.dict() if hasattr(o, 'dict') else o for o in (getattr(variant, 'openings', []) or [])],
                    'num_windows': getattr(variant, 'num_windows', 3),
                    'num_doors': getattr(variant, 'num_doors', 1),
                    'min_ambient_temp_C': getattr(variant, 'min_ambient_temp_C', None),
                    'max_ambient_temp_C': getattr(variant, 'max_ambient_temp_C', None),
                    'peak_solar_radiation_W_m2': getattr(variant, 'peak_solar_radiation_W_m2', None),
                    'climate_profile_id': getattr(variant, 'climate_profile_id', 'ladakh_winter'),
                    'duration_hours': getattr(variant, 'duration_hours', 24),
                }
                results.append(raw)
            rec = generate_recommendation(results)
            self.compare_jobs[job_id].update({
                'status': 'complete',
                'results': results,
                **rec,
            })

            # Persist comparison to TiDB Cloud MySQL
            try:
                from app.db.database import save_comparison
                save_comparison(job_id, self.compare_jobs[job_id])
            except Exception as dbe:
                pass
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
