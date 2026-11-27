import csv
import io

import numpy as np

from app.services.fallback_engine import run_fdm_simulation
from app.services.simulation_service import scale_climate_profile


def parse_sensor_csv(csv_content: str) -> np.ndarray:
    reader = csv.DictReader(io.StringIO(csv_content))
    headers = {
        (header or '').strip().lower(): header
        for header in (reader.fieldnames or [])
    }
    if 'hour' not in headers or 'measured_temp_c' not in headers:
        raise ValueError('CSV must contain hour and measured_temp_c columns')

    measurements = {}
    for row in reader:
        if not row:
            continue
        if None in row:
            raise ValueError('CSV rows contain more values than the header columns')
        if all(not str(value or '').strip() for value in row.values()):
            continue
        try:
            hour_value = float(row[headers['hour']])
            temperature = float(row[headers['measured_temp_c']])
        except (TypeError, ValueError) as exc:
            raise ValueError('CSV hours and measured temperatures must be numeric') from exc
        if not np.isfinite(hour_value) or not hour_value.is_integer() or not 0 <= hour_value <= 23:
            raise ValueError('CSV hour values must be whole numbers from 0 to 23')
        if not np.isfinite(temperature):
            raise ValueError('CSV measured temperatures must be finite numbers')
        hour = int(hour_value)
        if hour in measurements:
            raise ValueError(f'CSV contains duplicate measurement for hour {hour}')
        measurements[hour] = temperature

    missing_hours = sorted(set(range(24)) - measurements.keys())
    if missing_hours:
        raise ValueError(f'CSV must contain one measurement for each hour from 0 to 23; missing: {missing_hours}')

    return np.array([measurements[hour] for hour in range(24)], dtype=float)


def validate_model(shelter_input, csv_content: str, simulation_service) -> dict:
    measured = parse_sensor_csv(csv_content)
    climate = simulation_service.climate_db.get(shelter_input.climate_profile_id)
    if climate is None:
        raise ValueError(f'Unknown climate_profile_id: {shelter_input.climate_profile_id}')

    climate_profile = scale_climate_profile(
        climate,
        min_amb=shelter_input.min_ambient_temp_C,
        max_amb=shelter_input.max_ambient_temp_C,
        peak_solar=shelter_input.peak_solar_radiation_W_m2,
    )
    validation_input = shelter_input.model_copy(update={
        'duration_hours': 24,
        'engine': 'fdm',
    })
    simulation = run_fdm_simulation(
        validation_input,
        simulation_service.materials_db,
        climate_profile,
    )

    simulated_by_hour = {
        int(round(point['hour'])): float(point['value'])
        for point in simulation.get('inside_temperature_series', [])
        if 0 <= point['hour'] < 24 and abs(point['hour'] - round(point['hour'])) < 1e-6
    }
    missing_hours = sorted(set(range(24)) - simulated_by_hour.keys())
    if missing_hours:
        raise ValueError(f'FDM simulation did not produce hourly temperatures for: {missing_hours}')

    simulated = np.array([simulated_by_hour[hour] for hour in range(24)], dtype=float)
    errors = simulated - measured
    absolute_errors = np.abs(errors)
    rmse = float(np.sqrt(np.mean(np.square(errors))))
    mae = float(np.mean(absolute_errors))
    residual_sum_squares = float(np.sum(np.square(errors)))
    total_sum_squares = float(np.sum(np.square(measured - np.mean(measured))))
    if np.isclose(total_sum_squares, 0.0):
        r_squared = 1.0 if np.isclose(residual_sum_squares, 0.0) else 0.0
    else:
        r_squared = float(1.0 - residual_sum_squares / total_sum_squares)

    max_deviation_index = int(np.argmax(absolute_errors))
    if rmse < 2:
        grade = 'Excellent'
    elif rmse < 4:
        grade = 'Good'
    elif rmse < 6:
        grade = 'Acceptable'
    else:
        grade = 'Poor'

    return {
        'rmse': round(rmse, 4),
        'mae': round(mae, 4),
        'r_squared': round(r_squared, 4),
        'max_deviation_c': round(float(absolute_errors[max_deviation_index]), 4),
        'max_deviation_hour': max_deviation_index,
        'validation_grade': grade,
        'hourly_comparison': [
            {
                'hour': hour,
                'simulated_temp_c': round(float(simulated[hour]), 2),
                'measured_temp_c': round(float(measured[hour]), 2),
            }
            for hour in range(24)
        ],
    }
