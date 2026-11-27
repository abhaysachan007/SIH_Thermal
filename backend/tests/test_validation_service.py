import pytest

from app.models.schemas import ShelterInput
from app.services.validation_service import parse_sensor_csv, validate_model


def test_parse_sensor_csv_orders_complete_hourly_data():
    csv_content = 'hour,measured_temp_c\n' + ''.join(
        f'{hour},{hour - 10}\n' for hour in reversed(range(24))
    )

    measurements = parse_sensor_csv(csv_content)

    assert measurements.tolist() == [hour - 10 for hour in range(24)]


def test_parse_sensor_csv_rejects_missing_hours():
    with pytest.raises(ValueError, match='missing'):
        parse_sensor_csv('hour,measured_temp_c\n0,1\n')


def test_parse_sensor_csv_rejects_duplicate_hours():
    csv_content = 'hour,measured_temp_c\n' + ''.join(
        f'{hour},{hour}\n' for hour in range(24)
    ) + '0,5\n'

    with pytest.raises(ValueError, match='duplicate'):
        parse_sensor_csv(csv_content)


def test_validate_model_returns_metrics_and_hourly_chart_data(monkeypatch):
    measured = [float(hour) for hour in range(24)]
    csv_content = 'hour,measured_temp_c\n' + ''.join(
        f'{hour},{temperature}\n' for hour, temperature in enumerate(measured)
    )
    climate = {'id': 'test_climate', 'hourly_data': []}
    simulation_service = type('SimulationServiceStub', (), {
        'climate_db': {'test_climate': climate},
        'materials_db': {},
    })()

    def fake_fdm_simulation(shelter_input, materials_db, climate_profile):
        assert shelter_input.duration_hours == 24
        assert shelter_input.engine == 'fdm'
        return {
            'inside_temperature_series': [
                {'hour': hour, 'value': temperature + 1}
                for hour, temperature in enumerate(measured)
            ],
        }

    monkeypatch.setattr(
        'app.services.validation_service.run_fdm_simulation',
        fake_fdm_simulation,
    )
    result = validate_model(
        ShelterInput(climate_profile_id='test_climate'),
        csv_content,
        simulation_service,
    )

    assert result['rmse'] == pytest.approx(1.0)
    assert result['mae'] == pytest.approx(1.0)
    assert result['r_squared'] == pytest.approx(round(1 - 24 / 1150, 4))
    assert result['max_deviation_c'] == pytest.approx(1.0)
    assert result['max_deviation_hour'] == 0
    assert result['validation_grade'] == 'Excellent'
    assert len(result['hourly_comparison']) == 24
    assert result['hourly_comparison'][23] == {
        'hour': 23,
        'simulated_temp_c': 24.0,
        'measured_temp_c': 23.0,
    }
