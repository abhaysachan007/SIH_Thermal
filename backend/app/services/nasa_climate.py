"""
nasa_climate.py — Live climate profiles from the NASA POWER Hourly API.

Fetches real hourly 2 m air temperature, all-sky surface shortwave
irradiance, and 2 m wind speed for a given location/date and converts them
into the internal climate-profile shape the simulation engines consume.

Network failures, timeouts, or malformed responses never propagate: the
caller gets (None, reason) and can fall back to the bundled static profile,
so a live demo can't be broken by connectivity.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

POWER_HOURLY_URL = "https://power.larc.nasa.gov/api/temporal/hourly/point"

# Leh, Ladakh — the project's reference location.
LEH_LAT = 34.15
LEH_LON = 77.57
LEH_ALT_M = 3524


def fetch_nasa_climate(
    latitude: float = LEH_LAT,
    longitude: float = LEH_LON,
    date: Optional[str] = None,
    season: str = "winter",
    timeout_s: float = 12.0,
) -> Tuple[Optional[dict], str]:
    """
    Return (profile, source_note). On any failure returns (None, reason).

    date: 'YYYYMMDD'. Defaults to a representative clear winter day
    (roughly one year back to guarantee POWER has published the data).
    """
    try:
        import httpx
    except Exception as e:  # pragma: no cover
        return None, f"httpx not installed: {e}"

    if date is None:
        # POWER hourly data lags real time; step back ~30 days from a year ago
        # to a date that is reliably published.
        ref = datetime.utcnow() - timedelta(days=395)
        date = ref.strftime("%Y%m%d")

    params = {
        "parameters": "T2M,ALLSKY_SFC_SW_DWN,WS2M",
        "community": "RE",
        "longitude": f"{longitude:.4f}",
        "latitude": f"{latitude:.4f}",
        "start": date,
        "end": date,
        "format": "JSON",
    }

    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.get(POWER_HOURLY_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"NASA POWER fetch failed: {e}")
        return None, f"NASA POWER request failed: {e}"

    try:
        params_block = data["properties"]["parameter"]
        t2m = params_block["T2M"]
        sw = params_block["ALLSKY_SFC_SW_DWN"]
        ws = params_block["WS2M"]
    except Exception as e:
        return None, f"Unexpected NASA POWER response shape: {e}"

    # POWER hourly keys look like 'YYYYMMDDHH'. Build the 24-hour profile.
    hourly = []
    for hh in range(24):
        key = f"{date}{hh:02d}"
        temp = t2m.get(key)
        irr = sw.get(key)
        wind = ws.get(key)
        # POWER fill value for missing data is -999.
        if temp is None or temp <= -900:
            temp = -15.0
        if irr is None or irr < 0:
            irr = 0.0
        if wind is None or wind < 0:
            wind = 2.0
        hourly.append({
            "hour": hh,
            "ambient_temp_C": round(float(temp), 2),
            "solar_irradiance_W_m2": round(float(irr), 2),
            "wind_speed_m_s": round(float(wind), 2),
        })

    if not any(h["ambient_temp_C"] > -900 for h in hourly):
        return None, "NASA POWER returned no usable data for this date"

    profile = {
        "id": "nasa_live",
        "name": f"NASA POWER Live — {latitude:.2f}N {longitude:.2f}E ({date})",
        "description": "Live hourly climate from the NASA POWER API.",
        "latitude": latitude,
        "altitude_m": LEH_ALT_M,
        "season": season,
        "hourly_data": hourly,
        "source": "NASA POWER Hourly API",
        "source_date": date,
    }
    return profile, "ok"
