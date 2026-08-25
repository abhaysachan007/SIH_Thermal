"""
Python 1D Finite Difference Method (FDM) Transient Thermal Solver
for passive shelter thermal analysis in cold desert climates (Ladakh).

Physics model:
- 1D conduction through wall/roof/floor slabs using unconditionally stable implicit FDM
- Pre-conditioning (spin-up cycle) to eliminate cold-start transient effects
- Exterior BC: convection (wind-dependent) + solar heat flux (orientation-adjusted)
- Interior BC: convection with well-mixed interior air
- Lumped capacitance for interior air volume + thermal mass of structure/contents
- Solar position based on astronomical calculation for Leh (34.15 N)
- Windows: direct solar gain via SHGC + conductive loss via glazing U-value
- Infiltration heat loss (ACH)
"""

import math
import numpy as np
from typing import Dict, Any


# --- Constants ---
RHO_AIR = 1.0        # kg/m3 (at ~3500 m altitude)
CP_AIR = 1005.0      # J/kg*K
H_INT = 4.0          # W/m2*K interior surface convection coefficient
ACH = 0.35           # air changes per hour (infiltration, well-sealed shelter)
GROUND_TEMP_C = 4.0  # deg C deep ground temperature (Ladakh winter/spring avg)

SEASON_DECLINATION = {
    'winter': math.radians(-21.3),
    'summer': math.radians(21.5),
    'spring': math.radians(9.4),
    'autumn': math.radians(-3.0),
}


def solar_altitude_and_azimuth(hour: float, latitude_deg: float, declination_rad: float):
    lat = math.radians(latitude_deg)
    omega = math.radians(15.0 * (hour - 12.0))
    dec = declination_rad

    sin_alt = math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(omega)
    alt = math.asin(max(-1.0, min(1.0, sin_alt)))

    if math.cos(alt) < 1e-6:
        azimuth = 0.0
    else:
        cos_az = (math.sin(dec) - math.sin(lat) * sin_alt) / (math.cos(lat) * math.cos(alt))
        cos_az = max(-1.0, min(1.0, cos_az))
        azimuth = math.acos(cos_az)
        if omega > 0:
            azimuth = -azimuth

    return alt, azimuth


def surface_orientation_factor(surface: str, orientation_deg: float, solar_alt: float, solar_az_from_south: float) -> float:
    if solar_alt <= 0.0:
        return 0.0

    # orientation_deg is azimuth of shelter primary front (South facade when orientation_deg=180)
    shelter_front_az = math.radians(orientation_deg - 180.0)

    wall_normals = {
        'south': shelter_front_az,
        'north': shelter_front_az + math.pi,
        'east':  shelter_front_az + math.pi / 2.0,
        'west':  shelter_front_az - math.pi / 2.0,
    }

    if surface == 'roof':
        return math.sin(solar_alt)

    if surface not in wall_normals:
        return 0.0

    wall_normal_az = wall_normals[surface]
    sun_az_from_north = math.pi - solar_az_from_south

    angle_diff = sun_az_from_north - wall_normal_az
    cos_incidence = math.cos(solar_alt) * math.cos(angle_diff)
    return max(0.0, cos_incidence)


def get_material(mat_id: str, custom_mat, materials_db: dict) -> dict:
    if mat_id == 'custom' and custom_mat is not None:
        return custom_mat.model_dump() if hasattr(custom_mat, 'model_dump') else dict(custom_mat)
    return materials_db.get(mat_id, materials_db.get('mud_brick', {}))


def solve_slab_implicit(
    T_old: np.ndarray,
    mat: dict,
    thickness: float,
    dt: float,
    T_ext: float,
    T_int: float,
    h_ext: float,
    q_solar: float,
    h_int: float = H_INT,
    is_floor: bool = False
) -> np.ndarray:
    n = len(T_old)
    dx = thickness / max(1, n - 1)
    k = max(0.01, float(mat.get('conductivity', 0.5)))
    rho = max(10.0, float(mat.get('density', 1500.0)))
    cp = max(100.0, float(mat.get('specific_heat', 800.0)))
    r = k * dt / (rho * cp * dx**2)

    A = np.zeros((n, n))
    b = np.zeros(n)

    # Node 0 (exterior surface)
    diag0 = rho * cp * dx / (2.0 * dt) + k / dx + h_ext
    A[0, 0] = diag0
    A[0, 1] = -k / dx
    b[0] = (rho * cp * dx / (2.0 * dt)) * T_old[0] + h_ext * T_ext + q_solar

    # Interior nodes 1 to n-2
    for i in range(1, n - 1):
        A[i, i - 1] = -r
        A[i, i] = 1.0 + 2.0 * r
        A[i, i + 1] = -r
        b[i] = T_old[i]

    # Node n-1 (interior surface)
    diagN = rho * cp * dx / (2.0 * dt) + k / dx + h_int
    A[n - 1, n - 2] = -k / dx
    A[n - 1, n - 1] = diagN
    b[n - 1] = (rho * cp * dx / (2.0 * dt)) * T_old[n - 1] + h_int * T_int

    return np.linalg.solve(A, b)


def run_fdm_simulation(shelter_input, materials_db: dict, climate_profile: dict) -> dict:
    si = shelter_input
    L, W, H = float(si.length_m), float(si.width_m), float(si.height_m)
    orient = float(si.orientation_deg)
    duration_h = int(si.duration_hours)
    lat = float(climate_profile.get('latitude', 34.15))
    season = climate_profile.get('season', 'winter')
    hourly = climate_profile['hourly_data']

    wall_mat = get_material(si.wall_material_id, si.wall_custom_material, materials_db)
    roof_mat = get_material(si.roof_material_id, si.roof_custom_material, materials_db)
    floor_mat = get_material(si.floor_material_id, None, materials_db)

    wall_t = float(si.wall_thickness_m)
    roof_t = float(si.roof_thickness_m)
    floor_t = float(si.floor_thickness_m)

    A_south = L * H
    A_north = L * H
    A_east  = W * H
    A_west  = W * H
    A_roof  = L * W
    A_floor = L * W

    A_openings = 0.0
    opening_u_total = 0.0
    shgc_eff_total = 0.0

    for op in si.openings:
        area = float(op.width_m) * float(op.height_m) * int(op.count)
        glaz = materials_db.get(op.glazing_material_id, materials_db.get('single_glazing', {}))
        cond = float(glaz.get('conductivity', 1.0))
        if cond > 0.5:
            glaz_u = 5.8
        elif cond > 0.25:
            glaz_u = 2.8
        else:
            glaz_u = 1.8
        shgc = float(glaz.get('shgc', 0.65) or 0.65)
        A_openings += area
        opening_u_total += glaz_u * area
        shgc_eff_total += shgc * area

    A_south_opaque = max(0.5, A_south - A_openings)

    N_NODES = 7
    dt = 30.0  # 30s
    dec = SEASON_DECLINATION.get(season, SEASON_DECLINATION['winter'])

    def climate_at(t_seconds):
        hour_float = (t_seconds / 3600.0) % 24.0
        h0 = int(hour_float) % 24
        h1 = (h0 + 1) % 24
        frac = hour_float - h0
        d0 = hourly[h0]
        d1 = hourly[h1]
        return {
            'ambient_temp_C': d0['ambient_temp_C'] * (1.0 - frac) + d1['ambient_temp_C'] * frac,
            'solar_irradiance_W_m2': d0['solar_irradiance_W_m2'] * (1.0 - frac) + d1['solar_irradiance_W_m2'] * frac,
            'wind_speed_m_s': d0['wind_speed_m_s'] * (1.0 - frac) + d1['wind_speed_m_s'] * frac,
        }

    V_interior = L * W * H
    m_air = RHO_AIR * V_interior
    C_air = m_air * CP_AIR
    # Thermal capacitance of interior buffer / contents
    C_internal_buffer = A_floor * 20.0 * 880.0
    C_total = C_air + C_internal_buffer

    # Initialize at average ambient temperature
    avg_amb = sum(d['ambient_temp_C'] for d in hourly) / len(hourly)
    T_inside = avg_amb

    slab_south = np.full(N_NODES, avg_amb)
    slab_north = np.full(N_NODES, avg_amb)
    slab_east  = np.full(N_NODES, avg_amb)
    slab_west  = np.full(N_NODES, avg_amb)
    slab_roof  = np.full(N_NODES, avg_amb)
    slab_floor = np.full(N_NODES, GROUND_TEMP_C)

    # ?? 1. Spin-up / Warm-up Period (1 full 24h cycle) to achieve periodic equilibrium
    warmup_steps = int(24 * 3600 / dt)
    for step in range(warmup_steps):
        t_sec = step * dt
        clim = climate_at(t_sec)
        T_amb = clim['ambient_temp_C']
        I_horiz = clim['solar_irradiance_W_m2']
        wind = clim['wind_speed_m_s']
        h_ext = max(8.0, min(35.0, 5.6 + 4.0 * wind))

        hour_of_day = (t_sec / 3600.0) % 24.0
        sol_alt, sol_az = solar_altitude_and_azimuth(hour_of_day, lat, dec)

        f_south = surface_orientation_factor('south', orient, sol_alt, sol_az)
        f_north = surface_orientation_factor('north', orient, sol_alt, sol_az)
        f_east  = surface_orientation_factor('east',  orient, sol_alt, sol_az)
        f_west  = surface_orientation_factor('west',  orient, sol_alt, sol_az)
        f_roof  = surface_orientation_factor('roof',  orient, sol_alt, sol_az)

        q_south_abs = I_horiz * f_south * wall_mat.get('solar_absorptivity', 0.7)
        q_north_abs = I_horiz * f_north * wall_mat.get('solar_absorptivity', 0.7)
        q_east_abs  = I_horiz * f_east  * wall_mat.get('solar_absorptivity', 0.7)
        q_west_abs  = I_horiz * f_west  * wall_mat.get('solar_absorptivity', 0.7)
        q_roof_abs  = I_horiz * f_roof  * roof_mat.get('solar_absorptivity', 0.7)

        slab_south = solve_slab_implicit(slab_south, wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_south_abs)
        slab_north = solve_slab_implicit(slab_north, wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_north_abs)
        slab_east  = solve_slab_implicit(slab_east,  wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_east_abs)
        slab_west  = solve_slab_implicit(slab_west,  wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_west_abs)
        slab_roof  = solve_slab_implicit(slab_roof,  roof_mat, roof_t, dt, T_amb, T_inside, h_ext, q_roof_abs)
        slab_floor = solve_slab_implicit(slab_floor, floor_mat, floor_t, dt, GROUND_TEMP_C, T_inside, 1.5, 0.0, is_floor=True)

        Q_south_in = H_INT * (slab_south[-1] - T_inside) * A_south_opaque
        Q_north_in = H_INT * (slab_north[-1] - T_inside) * A_north
        Q_east_in  = H_INT * (slab_east[-1]  - T_inside) * A_east
        Q_west_in  = H_INT * (slab_west[-1]  - T_inside) * A_west
        Q_roof_in  = H_INT * (slab_roof[-1]  - T_inside) * A_roof
        Q_floor_in = H_INT * (slab_floor[-1] - T_inside) * A_floor

        Q_solar_windows = 0.0
        Q_opening_loss = 0.0
        if A_openings > 0:
            Q_solar_windows = I_horiz * f_south * shgc_eff_total
            Q_opening_loss = opening_u_total * (T_inside - T_amb)

        Q_infiltration = (ACH / 3600.0) * V_interior * RHO_AIR * CP_AIR * (T_inside - T_amb)
        Q_net = (Q_south_in + Q_north_in + Q_east_in + Q_west_in + Q_roof_in + Q_floor_in + Q_solar_windows - Q_opening_loss - Q_infiltration)
        T_inside += Q_net * dt / C_total

    # ?? 2. Production Simulation Period (recording outputs)
    total_seconds = duration_h * 3600
    n_steps = int(total_seconds / dt)
    sample_every = max(1, int(1800.0 / dt))

    out_inside_temp = []
    out_ambient_temp = []
    out_solar_gain = []
    out_hf_south = []
    out_hf_north = []
    out_hf_east = []
    out_hf_west = []
    out_hf_roof = []
    out_hf_floor = []
    out_hf_openings = []

    for step in range(n_steps + 1):
        t_sec = step * dt
        clim = climate_at(t_sec)
        T_amb = clim['ambient_temp_C']
        I_horiz = clim['solar_irradiance_W_m2']
        wind = clim['wind_speed_m_s']
        h_ext = max(8.0, min(35.0, 5.6 + 4.0 * wind))

        hour_of_day = (t_sec / 3600.0) % 24.0
        sol_alt, sol_az = solar_altitude_and_azimuth(hour_of_day, lat, dec)

        f_south = surface_orientation_factor('south', orient, sol_alt, sol_az)
        f_north = surface_orientation_factor('north', orient, sol_alt, sol_az)
        f_east  = surface_orientation_factor('east',  orient, sol_alt, sol_az)
        f_west  = surface_orientation_factor('west',  orient, sol_alt, sol_az)
        f_roof  = surface_orientation_factor('roof',  orient, sol_alt, sol_az)

        q_south_abs = I_horiz * f_south * wall_mat.get('solar_absorptivity', 0.7)
        q_north_abs = I_horiz * f_north * wall_mat.get('solar_absorptivity', 0.7)
        q_east_abs  = I_horiz * f_east  * wall_mat.get('solar_absorptivity', 0.7)
        q_west_abs  = I_horiz * f_west  * wall_mat.get('solar_absorptivity', 0.7)
        q_roof_abs  = I_horiz * f_roof  * roof_mat.get('solar_absorptivity', 0.7)

        slab_south = solve_slab_implicit(slab_south, wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_south_abs)
        slab_north = solve_slab_implicit(slab_north, wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_north_abs)
        slab_east  = solve_slab_implicit(slab_east,  wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_east_abs)
        slab_west  = solve_slab_implicit(slab_west,  wall_mat, wall_t, dt, T_amb, T_inside, h_ext, q_west_abs)
        slab_roof  = solve_slab_implicit(slab_roof,  roof_mat, roof_t, dt, T_amb, T_inside, h_ext, q_roof_abs)
        slab_floor = solve_slab_implicit(slab_floor, floor_mat, floor_t, dt, GROUND_TEMP_C, T_inside, 1.5, 0.0, is_floor=True)

        Q_south_in = H_INT * (slab_south[-1] - T_inside) * A_south_opaque
        Q_north_in = H_INT * (slab_north[-1] - T_inside) * A_north
        Q_east_in  = H_INT * (slab_east[-1]  - T_inside) * A_east
        Q_west_in  = H_INT * (slab_west[-1]  - T_inside) * A_west
        Q_roof_in  = H_INT * (slab_roof[-1]  - T_inside) * A_roof
        Q_floor_in = H_INT * (slab_floor[-1] - T_inside) * A_floor

        Q_solar_windows = 0.0
        Q_opening_loss = 0.0
        if A_openings > 0:
            Q_solar_windows = I_horiz * f_south * shgc_eff_total
            Q_opening_loss = opening_u_total * (T_inside - T_amb)

        Q_infiltration = (ACH / 3600.0) * V_interior * RHO_AIR * CP_AIR * (T_inside - T_amb)
        Q_net = (Q_south_in + Q_north_in + Q_east_in + Q_west_in + Q_roof_in + Q_floor_in + Q_solar_windows - Q_opening_loss - Q_infiltration)
        T_inside += Q_net * dt / C_total

        if step % sample_every == 0:
            t_hour = t_sec / 3600.0
            out_inside_temp.append({'hour': round(t_hour, 2), 'value': round(float(T_inside), 2)})
            out_ambient_temp.append({'hour': round(t_hour, 2), 'value': round(float(T_amb), 2)})
            
            # Useful solar gain delivered to shelter zone
            useful_solar = Q_solar_windows + max(0.0, Q_south_in) + max(0.0, Q_roof_in)
            out_solar_gain.append({'hour': round(t_hour, 2), 'value': round(float(useful_solar), 1)})
            
            out_hf_south.append({'hour': round(t_hour, 2), 'value': round(float(Q_south_in), 1)})
            out_hf_north.append({'hour': round(t_hour, 2), 'value': round(float(Q_north_in), 1)})
            out_hf_east.append({'hour': round(t_hour, 2), 'value': round(float(Q_east_in), 1)})
            out_hf_west.append({'hour': round(t_hour, 2), 'value': round(float(Q_west_in), 1)})
            out_hf_roof.append({'hour': round(t_hour, 2), 'value': round(float(Q_roof_in), 1)})
            out_hf_floor.append({'hour': round(t_hour, 2), 'value': round(float(Q_floor_in), 1)})
            out_hf_openings.append({'hour': round(t_hour, 2),
                                     'value': round(float(Q_solar_windows - Q_opening_loss), 1)})

    return {
        'inside_temperature_series': out_inside_temp,
        'ambient_temperature_series': out_ambient_temp,
        'solar_gain_series': out_solar_gain,
        'heat_flow_series': [
            {'component': 'South Wall', 'heat_flow_series': out_hf_south},
            {'component': 'North Wall', 'heat_flow_series': out_hf_north},
            {'component': 'East Wall',  'heat_flow_series': out_hf_east},
            {'component': 'West Wall',  'heat_flow_series': out_hf_west},
            {'component': 'Roof',       'heat_flow_series': out_hf_roof},
            {'component': 'Floor',      'heat_flow_series': out_hf_floor},
            {'component': 'Openings',   'heat_flow_series': out_hf_openings},
        ],
    }
