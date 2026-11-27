import asyncio
import csv
import io
import json
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import simulation
from app.services.simulation_service import SimulationService
from app.models.schemas import ShelterInput


def _completed_job():
    return {
        'job_id': 'job-42',
        'status': 'complete',
        'input': {'climate_profile_id': 'test-climate'},
        'inside_temperature_series': [
            {'hour': 0, 'value': 12.5},
            {'hour': 1, 'value': 13.0},
        ],
        'ambient_temperature_series': [
            {'hour': 0, 'value': -5.0},
            {'hour': 1, 'value': -4.0},
        ],
        'solar_irradiance_series': [
            {'hour': 0, 'value': 0.0},
            {'hour': 1, 'value': 100.0},
        ],
        'solar_gain_series': [
            {'hour': 0, 'value': 5.0},
            {'hour': 1, 'value': 25.0},
        ],
        'heat_flow_series': [{
            'component': 'Wall',
            'heat_flow_series': [
                {'hour': 0, 'value': -10.0},
                {'hour': 1, 'value': -20.0},
            ],
        }],
    }


def test_export_csv_has_hourly_columns_and_heat_balance(monkeypatch):
    job = _completed_job()
    service = SimpleNamespace(jobs={job['job_id']: job}, climate_db={})
    monkeypatch.setattr(simulation, 'get_simulation_service', lambda: service)

    response = asyncio.run(simulation.export_simulation('job-42', 'csv'))
    rows = list(csv.DictReader(io.StringIO(response.body.decode())))

    assert response.media_type == 'text/csv'
    assert 'attachment; filename="job-42.csv"' in response.headers['content-disposition']
    assert list(rows[0]) == [
        'hour',
        'ambient_temp_c',
        'solar_irradiance_w_m2',
        'indoor_temp_c',
        'heat_loss_w',
        'solar_gain_w',
        'net_heat_w',
    ]
    assert len(rows) == 24
    assert rows[0]['hour'] == '0'
    assert float(rows[0]['heat_loss_w']) == 10.0
    assert float(rows[0]['net_heat_w']) == -5.0
    assert rows[2]['indoor_temp_c'] == ''


def test_export_json_downloads_entire_job(monkeypatch):
    job = _completed_job()
    service = SimpleNamespace(jobs={job['job_id']: job}, climate_db={})
    monkeypatch.setattr(simulation, 'get_simulation_service', lambda: service)

    response = asyncio.run(simulation.export_simulation('job-42', 'json'))

    assert response.media_type == 'application/json'
    assert 'attachment; filename="job-42.json"' in response.headers['content-disposition']
    assert json.loads(response.body)['inside_temperature_series'] == job['inside_temperature_series']


def test_export_rejects_missing_and_incomplete_jobs(monkeypatch):
    service = SimpleNamespace(jobs={'queued': {'status': 'running'}}, climate_db={})
    monkeypatch.setattr(simulation, 'get_simulation_service', lambda: service)

    with pytest.raises(HTTPException) as missing:
        asyncio.run(simulation.export_simulation('missing', 'json'))
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as incomplete:
        asyncio.run(simulation.export_simulation('queued', 'csv'))
    assert incomplete.value.status_code == 409


def test_single_simulation_adds_research_metadata(monkeypatch):
    hours = [
        {'hour': hour, 'ambient_temp_C': -5.0, 'solar_irradiance_W_m2': hour * 10.0, 'wind_speed_m_s': 1.0}
        for hour in range(24)
    ]
    service = SimulationService()
    service.climate_db = {'test-climate': {'id': 'test-climate', 'hourly_data': hours}}
    service.materials_db = {}
    service.jobs['job-42'] = {'status': 'queued', 'job_id': 'job-42'}
    monkeypatch.setattr(
        'app.services.simulation_service._select_and_run',
        lambda shelter_input, materials_db, climate_profile: {
            'inside_temperature_series': [{'hour': 0, 'value': 10.0}],
            'ambient_temperature_series': [{'hour': 0, 'value': -5.0}],
            'solar_gain_series': [],
            'heat_flow_series': [],
            'engine_used': 'python_fdm',
        },
    )
    monkeypatch.setitem(
        sys.modules,
        'app.db.database',
        SimpleNamespace(save_simulation=lambda *args: None),
    )

    asyncio.run(service._run_single(
        'job-42',
        ShelterInput(climate_profile_id='test-climate', engine='fdm'),
    ))

    result = service.jobs['job-42']
    assert result['methodology'] == 'Lumped-capacitance FDM'
    assert result['timestep_hours'] == 1
    assert result['simulation_hours'] == 24
    assert result['solver'] == 'Python FDM'
    assert result['generated_at'].endswith('+00:00')
    assert result['solar_irradiance_series'][1] == {'hour': 1.0, 'value': 10.0}
