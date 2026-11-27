"""
app.pipeline.climate_repo
=========================
Time-series Climate Ingestion & Astronomical Solar Flux Calculation.
Supports variable simulation timesteps (1 hour, 30 min, 15 min).
"""
import math
import json
from pathlib import Path
from typing import List, Dict, Any, Optional

DATA_PATH = Path(__file__).parent.parent / "data" / "climate_profiles.json"


class ClimateTimeSeries:
    def __init__(self, records: List[Dict[str, Any]], latitude_deg: float = 34.15, season: str = "winter"):
        self.records = records  # list of dicts: {"hour": 0..23, "ambient_temperature_c": float, "solar_irradiance_w_m2": float, "wind_speed_m_s": float}
        self.latitude_deg = latitude_deg
        self.season = season
        self.duration_hours = len(records)

    def at_time(self, time_seconds: float) -> Dict[str, float]:
        """Interpolate time-series at continuous seconds."""
        hour_float = (time_seconds / 3600.0) % float(self.duration_hours)
        h0 = int(hour_float) % self.duration_hours
        h1 = (h0 + 1) % self.duration_hours
        frac = hour_float - int(hour_float)

        r0 = self.records[h0]
        r1 = self.records[h1]

        t_amb = r0["ambient_temperature_c"] + frac * (r1["ambient_temperature_c"] - r0["ambient_temperature_c"])
        i_sol = max(0.0, r0["solar_irradiance_w_m2"] + frac * (r1["solar_irradiance_w_m2"] - r0["solar_irradiance_w_m2"]))
        w_spd = max(0.5, r0.get("wind_speed_m_s", 2.0) + frac * (r1.get("wind_speed_m_s", 2.0) - r0.get("wind_speed_m_s", 2.0)))

        return {
            "ambient_temperature_c": t_amb,
            "solar_irradiance_w_m2": i_sol,
            "wind_speed_m_s": w_spd,
        }

    def solar_position(self, hour_float: float) -> (float, float):
        """
        Calculate solar altitude (alpha) and solar azimuth (gamma) in radians.
        Season declinations for Ladakh:
          winter: -21.3 deg, summer: +21.5 deg, spring: +9.4 deg, autumn: -3.0 deg
        """
        SEASON_DEC = {"winter": -21.3, "summer": 21.5, "spring": 9.4, "autumn": -3.0}
        dec_deg = SEASON_DEC.get(self.season, -21.3)
        dec_rad = math.radians(dec_deg)
        lat_rad = math.radians(self.latitude_deg)

        # Solar hour angle (omega): 0 at solar noon (hour 12)
        omega = math.radians(15.0 * (hour_float - 12.0))

        sin_alpha = math.sin(lat_rad) * math.sin(dec_rad) + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(omega)
        alpha = math.asin(max(-1.0, min(1.0, sin_alpha)))

        if alpha <= 0.0:
            return 0.0, 0.0

        cos_gamma = (math.sin(dec_rad) - math.sin(lat_rad) * math.sin(alpha)) / (math.cos(lat_rad) * max(1e-5, math.cos(alpha)))
        gamma = math.acos(max(-1.0, min(1.0, cos_gamma)))
        if omega > 0:
            gamma = -gamma  # Afternoon is west of south

        return alpha, gamma

    def surface_solar_factor(self, surface_azimuth_deg: float, surface_tilt_deg: float, hour_float: float) -> float:
        """
        Calculate geometric cosine factor for direct solar beam on tilted vertical/sloped surface.
        surface_azimuth_deg: 180=South, 90=East, 270=West, 0=North
        surface_tilt_deg: 90=Vertical wall, 0=Horizontal roof, 30=pitched roof
        """
        alpha, gamma = self.solar_position(hour_float)
        if alpha <= 0.0:
            return 0.0

        # Shelter orientation relative to south
        shelter_az = math.radians(surface_azimuth_deg - 180.0)
        az_diff = (math.pi - gamma) - shelter_az
        tilt_rad = math.radians(surface_tilt_deg)

        # Cosine of incidence angle on tilted surface
        cos_theta = math.sin(alpha) * math.cos(tilt_rad) + math.cos(alpha) * math.sin(tilt_rad) * math.cos(az_diff)
        return max(0.0, cos_theta)


def load_climate_timeseries(
    profile_id: str = "ladakh_winter",
    min_amb: Optional[float] = None,
    max_amb: Optional[float] = None,
    peak_solar: Optional[float] = None,
    use_live: bool = False,
    lat: float = 34.15,
    lon: float = 77.57
) -> ClimateTimeSeries:
    if use_live:
        from app.services.nasa_climate import fetch_nasa_climate

        prof, note = fetch_nasa_climate(latitude=lat, longitude=lon)
        if prof is None:
            raise ValueError(note)
    else:
        with open(DATA_PATH, encoding="utf-8-sig") as f:
            profiles = json.load(f)

        prof = profiles.get(profile_id, list(profiles.values())[0])

    raw_hourly = prof.get("hourly_data", [])

    orig_temps = [h["ambient_temp_C"] for h in raw_hourly]
    orig_solars = [h["solar_irradiance_W_m2"] for h in raw_hourly]

    orig_min = min(orig_temps)
    orig_max = max(orig_temps)
    t_span = orig_max - orig_min if (orig_max - orig_min) > 1e-4 else 1.0

    target_min = min_amb if min_amb is not None else orig_min
    target_max = max_amb if max_amb is not None else orig_max
    if target_max < target_min:
        target_max = target_min + 5.0
    target_span = target_max - target_min

    orig_peak = max(orig_solars) if orig_solars else 1.0
    target_peak = peak_solar if peak_solar is not None else orig_peak
    solar_scale = (target_peak / orig_peak) if (orig_peak > 1e-4 and target_peak is not None) else 1.0

    normalized_records = []
    for h in raw_hourly:
        norm_t = (h["ambient_temp_C"] - orig_min) / t_span
        scaled_t = target_min + norm_t * target_span
        scaled_solar = max(0.0, h["solar_irradiance_W_m2"] * solar_scale)
        normalized_records.append({
            "hour": h["hour"],
            "ambient_temperature_c": round(float(scaled_t), 3),
            "solar_irradiance_w_m2": round(float(scaled_solar), 3),
            "wind_speed_m_s": float(h.get("wind_speed_m_s", 2.0)),
        })

    return ClimateTimeSeries(
        records=normalized_records,
        latitude_deg=float(prof.get("latitude", 34.15)),
        season=prof.get("season", "winter")
    )
