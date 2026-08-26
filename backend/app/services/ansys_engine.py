"""
ansys_engine.py — Real PyMAPDL Transient Thermal FEA Engine
===========================================================
Uses ansys.mapdl.core (PyMAPDL) to:
  1. Build parametric 3D shelter geometry with SOLID70 thermal elements
  2. Apply transient thermal boundary conditions (convection + solar flux)
  3. Solve 24-hour transient thermal analysis
  4. Extract per-surface temperatures for thermal visualization
  5. Return results in standard format for the web app

ANSYS executable path is config-driven via MAPDL_EXEC_PATH env var.
"""
import math
import os
import shutil
import logging
import uuid
import numpy as np
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

JOBS_DIR = Path(os.environ.get("ANSYS_JOBS_DIR", "simulation/jobs"))

# ANSYS versions to probe, newest first (v261 = 2026 R1, v252 = 2025 R2, ...)
_ANSYS_VERSIONS = ["261", "252", "251", "242", "241", "232", "231", "222", "221"]


def find_mapdl_executable() -> Optional[str]:
    """
    Locate the MAPDL executable.

    Order:
      1. MAPDL_EXEC_PATH env var (explicit override, always wins)
      2. AWP_ROOTxxx env vars that the ANSYS installer sets
      3. Common install roots across drive letters, for both the
         Commercial/Enterprise layout (ANSYS Inc\\vXXX) and the
         Student layout (ANSYS Inc\\ANSYS Student\\vXXX)

    Returns the path as a string, or None if nothing was found.
    """
    override = os.environ.get("MAPDL_EXEC_PATH")
    if override:
        # An explicit override is honoured even if missing, so the
        # resulting error names the path the user actually configured.
        return override

    # AWP_ROOT261 etc. point at the install root, e.g. C:\Program Files\ANSYS Inc\v261
    for ver in _ANSYS_VERSIONS:
        root = os.environ.get(f"AWP_ROOT{ver}")
        if root:
            candidate = Path(root) / "ansys" / "bin" / "winx64" / f"ANSYS{ver}.exe"
            if candidate.exists():
                return str(candidate)

    drives = ["C:", "D:", "E:", "F:"]
    prefixes = [
        r"\Program Files\ANSYS Inc",
        r"\ANSYS Inc",
        r"\Program Files\ANSYS Inc\ANSYS Student",
        r"\ANSYS Inc\ANSYS Student",
        r"\ANSYSACADEMICSTUDENT\ANSYS Inc\ANSYS Student",
    ]
    for ver in _ANSYS_VERSIONS:
        for drive in drives:
            for prefix in prefixes:
                candidate = (
                    Path(f"{drive}{prefix}") / f"v{ver}"
                    / "ansys" / "bin" / "winx64" / f"ANSYS{ver}.exe"
                )
                if candidate.exists():
                    return str(candidate)

    # Linux / already-on-PATH installs
    for name in ["mapdl", "ansys261", "ansys252"]:
        found = shutil.which(name)
        if found:
            return found

    return None


def _liu_jordan_transposition(
    I_horizontal: float,
    solar_alt_rad: float,
    solar_az_rad: float,
    surface_tilt_rad: float,
    surface_az_rad: float,
    latitude_rad: float,
    declination_rad: float,
    hour_angle_rad: float,
    ground_albedo: float = 0.6,
) -> float:
    """
    Liu-Jordan isotropic sky model for transposing horizontal irradiance
    to a tilted surface: I_T = I_beam*Rb + I_diffuse*(1+cos(beta))/2
                              + I_global*rho*(1-cos(beta))/2

    Uses Erbs correlation for diffuse fraction from clearness index.
    """
    if solar_alt_rad <= 0 or I_horizontal <= 0:
        return 0.0

    sin_alt = math.sin(solar_alt_rad)
    I_extraterrestrial = 1367.0 * sin_alt
    if I_extraterrestrial <= 0:
        return 0.0

    kt = min(1.0, I_horizontal / I_extraterrestrial)

    # Erbs correlation for diffuse fraction
    if kt <= 0.22:
        kd = 1.0 - 0.09 * kt
    elif kt <= 0.80:
        kd = 0.9511 - 0.1604 * kt + 4.388 * kt**2 - 16.638 * kt**3 + 12.336 * kt**4
    else:
        kd = 0.165

    I_diffuse = kd * I_horizontal
    I_beam = I_horizontal - I_diffuse

    # Beam tilt factor Rb
    cos_theta_z = sin_alt
    lat = latitude_rad
    dec = declination_rad
    omega = hour_angle_rad
    beta = surface_tilt_rad
    gamma = surface_az_rad

    cos_theta_t = (
        math.sin(dec) * math.sin(lat) * math.cos(beta)
        - math.sin(dec) * math.cos(lat) * math.sin(beta) * math.cos(gamma)
        + math.cos(dec) * math.cos(lat) * math.cos(beta) * math.cos(omega)
        + math.cos(dec) * math.sin(lat) * math.sin(beta) * math.cos(gamma) * math.cos(omega)
        + math.cos(dec) * math.sin(beta) * math.sin(gamma) * math.sin(omega)
    )
    cos_theta_t = max(0.0, cos_theta_t)

    Rb = cos_theta_t / max(1e-6, cos_theta_z)

    I_tilted = (
        I_beam * Rb
        + I_diffuse * (1 + math.cos(beta)) / 2.0
        + I_horizontal * ground_albedo * (1 - math.cos(beta)) / 2.0
    )
    return max(0.0, I_tilted)


def _solar_position(hour: float, lat_deg: float, dec_deg: float):
    """Returns (altitude_rad, azimuth_rad_from_south, hour_angle_rad)."""
    lat = math.radians(lat_deg)
    dec = math.radians(dec_deg)
    omega = math.radians(15.0 * (hour - 12.0))

    sin_alt = math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(omega)
    alt = math.asin(max(-1.0, min(1.0, sin_alt)))

    if math.cos(alt) < 1e-6:
        az = 0.0
    else:
        cos_az = (math.sin(dec) - math.sin(lat) * sin_alt) / (math.cos(lat) * math.cos(alt))
        cos_az = max(-1.0, min(1.0, cos_az))
        az = math.acos(cos_az)
        if omega > 0:
            az = -az

    return alt, az, omega


SEASON_DECLINATION = {"winter": -21.3, "summer": 21.5, "spring": 9.4, "autumn": -3.0}


def _numpy_extract_temps(mapdl, x_range=None, y_range=None, z_range=None):
    """
    Extract temperatures using numpy coordinate masking instead of
    invalid APDL *GET NODE,0,TEMP,MEAN queries (MEAN is not a valid
    *GET sub-operation for NODE entity — it silently returns 0).

    Call after mapdl.set() to choose the time step.
    Returns (mean, max, min) tuple for nodes within the coordinate box.
    Returns (None, None, None) if no nodes match.
    """
    mapdl.allsel()
    all_temps = mapdl.post_processing.nodal_temperature
    if callable(all_temps):
        # Some PyMAPDL versions expose nodal_temperature as a method rather
        # than a property — calling it either way keeps this working across
        # versions instead of failing with "object of type 'method' has no
        # len()".
        all_temps = all_temps()
    all_coords = mapdl.mesh.nodes
    if callable(all_coords):
        all_coords = all_coords()

    mask = np.ones(len(all_temps), dtype=bool)
    if x_range is not None:
        mask &= (all_coords[:, 0] >= x_range[0]) & (all_coords[:, 0] <= x_range[1])
    if y_range is not None:
        mask &= (all_coords[:, 1] >= y_range[0]) & (all_coords[:, 1] <= y_range[1])
    if z_range is not None:
        mask &= (all_coords[:, 2] >= z_range[0]) & (all_coords[:, 2] <= z_range[1])

    selected = all_temps[mask]
    if len(selected) == 0:
        return None, None, None

    return float(np.mean(selected)), float(np.max(selected)), float(np.min(selected))


def _build_and_solve_pymapdl(inputs, materials_db: dict, climate_profile: dict, job_dir: Path) -> dict:
    """
    Launch PyMAPDL, build shelter geometry, apply thermal BCs, solve transient,
    and extract all results via the Python API.
    """
    from ansys.mapdl.core import launch_mapdl

    exec_path = find_mapdl_executable()
    if exec_path is None:
        raise FileNotFoundError(
            "No ANSYS MAPDL installation found. Set MAPDL_EXEC_PATH to the full "
            "path of ANSYS<ver>.exe, e.g. "
            r"C:\Program Files\ANSYS Inc\v261\ansys\bin\winx64\ANSYS261.exe"
        )
    if not Path(exec_path).exists():
        raise FileNotFoundError(
            f"MAPDL executable not found at MAPDL_EXEC_PATH={exec_path}"
        )
    logger.info(f"Using MAPDL executable: {exec_path}")

    mapdl = launch_mapdl(
        exec_file=exec_path,
        run_location=str(job_dir),
        nproc=1,
        override=True,
        loglevel="WARNING",
        # Fail fast instead of hanging indefinitely if MAPDL can't start
        # (missing license, blocked local gRPC port, etc.).
        start_timeout=90,
    )

    try:
        return _run_thermal_fea(mapdl, inputs, materials_db, climate_profile)
    finally:
        try:
            mapdl.exit()
        except Exception:
            pass


def _run_thermal_fea(mapdl, inputs, materials_db: dict, climate_profile: dict) -> dict:
    """Core FEA logic using PyMAPDL API calls."""

    # -- Extract inputs --
    L = float(inputs.length_m)
    W = float(inputs.width_m)
    H = float(inputs.height_m)
    wthk = float(getattr(inputs, 'wall_thickness_m', 0.45))
    shape = getattr(inputs, 'shape', 'rectangular')
    orient = float(getattr(inputs, 'orientation_deg', 180))

    if shape == 'dome':
        # shelter_design.apdl builds a genuinely different geometry for
        # SHAPE=1 (hemisphere + cylindrical tunnel), but every boundary
        # condition and temperature-extraction call below assumes the
        # rectangular gable-roof box (planar X/Y/Z faces at wall-thickness
        # offsets). Applying those selections to a dome would silently
        # select the wrong nodes — or none — and produce meaningless
        # results instead of a clear failure. Fail fast here so the caller
        # falls back to the FDM engine (which does support the dome shape)
        # with an honest reason, rather than shipping wrong physics.
        raise NotImplementedError(
            "ANSYS engine does not yet support the dome/igloo shape "
            "(boundary conditions are only implemented for the rectangular "
            "gable geometry). Falling back to Python FDM, which supports it."
        )

    wmat = materials_db.get(getattr(inputs, 'wall_material_id', 'mud_brick'), {})
    rmat = materials_db.get(getattr(inputs, 'roof_material_id', 'mud_brick'), {})
    fmat = materials_db.get(getattr(inputs, 'floor_material_id', 'rammed_earth'), {})

    k_wall = float(wmat.get('conductivity', 0.72))
    rho_wall = float(wmat.get('density', 1800))
    cp_wall = float(wmat.get('specific_heat', 840))
    k_roof = float(rmat.get('conductivity', 0.15))
    rho_roof = float(rmat.get('density', 650))
    cp_roof = float(rmat.get('specific_heat', 1200))
    k_floor = float(fmat.get('conductivity', 1.80))
    rho_floor = float(fmat.get('density', 2400))
    cp_floor = float(fmat.get('specific_heat', 900))

    wall_abs = float(wmat.get('solar_absorptivity', 0.7))
    roof_abs = float(rmat.get('solar_absorptivity', 0.75))

    # Count openings
    openings = getattr(inputs, 'openings', []) or []
    total_windows = sum(
        int(o.get('count', 1) if isinstance(o, dict) else getattr(o, 'count', 1))
        for o in openings
        if (o.get('type') if isinstance(o, dict) else getattr(o, 'type', '')) == 'window'
    )
    total_doors = sum(
        int(o.get('count', 1) if isinstance(o, dict) else getattr(o, 'count', 1))
        for o in openings
        if (o.get('type') if isinstance(o, dict) else getattr(o, 'type', '')) == 'door'
    )

    if total_doors >= 2:
        south_windows = min(total_windows, 2)
    elif total_doors == 1:
        south_windows = min(total_windows, 3)
    else:
        south_windows = min(total_windows, 4)
    south_doors = min(total_doors, 2)

    # -- Climate data --
    hourly = climate_profile.get('hourly_data', [])
    lat = float(climate_profile.get('latitude', 34.15))
    season = climate_profile.get('season', 'winter')
    dec_deg = SEASON_DECLINATION.get(season, -21.3)
    ground_albedo = 0.6 if season == 'winter' else 0.2

    # -- /PREP7: Build geometry --
    mapdl.clear()
    mapdl.prep7()
    mapdl.title("Ladakh Passive Shelter - Transient Thermal FEA")

    # Element type: SOLID70 (3D 8-node thermal brick)
    mapdl.et(1, "SOLID70")

    # Materials
    # Mat 1: Walls
    mapdl.mp("KXX", 1, k_wall)
    mapdl.mp("DENS", 1, rho_wall)
    mapdl.mp("C", 1, cp_wall)
    # Mat 2: Roof
    mapdl.mp("KXX", 2, k_roof)
    mapdl.mp("DENS", 2, rho_roof)
    mapdl.mp("C", 2, cp_roof)
    # Mat 3: Foundation/Plinth (stone)
    mapdl.mp("KXX", 3, 1.80)
    mapdl.mp("DENS", 3, 2400)
    mapdl.mp("C", 3, 900)
    # Mat 4: Glass (windows)
    mapdl.mp("KXX", 4, 1.00)
    mapdl.mp("DENS", 4, 2500)
    mapdl.mp("C", 4, 750)
    # Mat 5: Door (wood)
    mapdl.mp("KXX", 5, 0.15)
    mapdl.mp("DENS", 5, 650)
    mapdl.mp("C", 5, 1200)
    # Mat 6: Floor
    mapdl.mp("KXX", 6, k_floor)
    mapdl.mp("DENS", 6, rho_floor)
    mapdl.mp("C", 6, cp_floor)

    # Build geometry using the existing APDL template via mapdl.input()
    # This reuses the proven shelter_design.apdl geometry builder
    template_dir = Path(__file__).parent / "apdl_templates"
    design_apdl = template_dir / "shelter_design.apdl"

    # Set parameters that the APDL template expects.
    # PSET=1 tells shelter_design.apdl that parameters are injected, so it
    # skips its own defaults instead of overwriting these values.
    mapdl.parameters["PSET"] = 1
    mapdl.parameters["SLEN"] = L
    mapdl.parameters["SWID"] = W
    mapdl.parameters["SHGT"] = H
    mapdl.parameters["WTHK"] = wthk
    mapdl.parameters["NWIN"] = south_windows
    mapdl.parameters["NDOOR"] = south_doors
    mapdl.parameters["SHAPE"] = 1 if shape == 'dome' else 0
    mapdl.parameters["ROOFT"] = 1
    mapdl.parameters["KWALL"] = k_wall
    mapdl.parameters["RHOWALL"] = rho_wall
    mapdl.parameters["CPWALL"] = cp_wall
    mapdl.parameters["KROOF"] = k_roof
    mapdl.parameters["RHOROOF"] = rho_roof
    mapdl.parameters["CPROOF"] = cp_roof
    mapdl.parameters["KFLOOR"] = k_floor
    mapdl.parameters["RHOFLOOR"] = rho_floor
    mapdl.parameters["CPFLOOR"] = cp_floor

    # Run the design APDL (builds geometry, meshes, writes geometry_out.csv)
    if design_apdl.exists():
        mapdl.input(str(design_apdl))
    else:
        raise FileNotFoundError(f"shelter_design.apdl not found at {design_apdl}")

    # Get geometry metrics from MAPDL parameters
    total_nodes = int(mapdl.get("TOTAL_NODES", "NODE", "", "COUNT"))
    wall_area = 2 * (L + W) * H
    south_wall_area = W * H
    roof_area = L * W
    floor_area = L * W
    interior_volume = L * W * H

    logger.info(f"PyMAPDL geometry built: {total_nodes} nodes, wall_area={wall_area:.1f} m2")

    # -- Compute 24h climate boundary conditions --
    from app.services.simulation_service import scale_climate_profile
    climate_profile = scale_climate_profile(
        climate_profile,
        min_amb=getattr(inputs, "min_ambient_temp_C", None),
        max_amb=getattr(inputs, "max_ambient_temp_C", None),
        peak_solar=getattr(inputs, "peak_solar_radiation_W_m2", None),
    )
    hourly = climate_profile.get("hourly_data", [])

    # Compute transposed solar fluxes for each hour
    south_solar = []
    roof_solar = []
    amb_temps = []
    h_ext_values = []

    for ih in range(25):
        slot = hourly[ih % 24]
        T_amb = float(slot["ambient_temp_C"])
        I_horiz = float(slot["solar_irradiance_W_m2"])
        wind = float(slot["wind_speed_m_s"])
        h_ext = max(8.0, min(35.0, 5.6 + 4.0 * wind))

        alt, az, omega = _solar_position(ih % 24, lat, dec_deg)

        # South wall: vertical surface facing shelter orientation
        q_south = _liu_jordan_transposition(
            I_horiz, alt, az,
            surface_tilt_rad=math.pi / 2,
            surface_az_rad=math.radians(orient - 180),
            latitude_rad=math.radians(lat),
            declination_rad=math.radians(dec_deg),
            hour_angle_rad=omega,
            ground_albedo=ground_albedo,
        ) * wall_abs

        # Roof: horizontal surface (tilt=0)
        q_roof = _liu_jordan_transposition(
            I_horiz, alt, az,
            surface_tilt_rad=0.0,
            surface_az_rad=0.0,
            latitude_rad=math.radians(lat),
            declination_rad=math.radians(dec_deg),
            hour_angle_rad=omega,
            ground_albedo=ground_albedo,
        ) * roof_abs

        south_solar.append(q_south)
        roof_solar.append(q_roof)
        amb_temps.append(T_amb)
        h_ext_values.append(h_ext)

    # -- Apply thermal boundary conditions via APDL commands --
    mapdl.prep7()

    # Define APDL tables for time-varying BCs
    # Table dimensions: 25 rows x 1 col, indexed by time
    mapdl.run("*DIM,TAMB_TB,TABLE,25,1,1,TIME")
    mapdl.run("*DIM,QSOLS_TB,TABLE,25,1,1,TIME")
    mapdl.run("*DIM,QSOLR_TB,TABLE,25,1,1,TIME")
    mapdl.run("*DIM,HEXT_TB,TABLE,25,1,1,TIME")

    for ih in range(25):
        row = ih + 1
        t_sec = ih * 3600
        mapdl.run(f"TAMB_TB({row},0,1)={t_sec}")
        mapdl.run(f"TAMB_TB({row},1,1)={amb_temps[ih]:.2f}")
        mapdl.run(f"QSOLS_TB({row},0,1)={t_sec}")
        mapdl.run(f"QSOLS_TB({row},1,1)={south_solar[ih]:.2f}")
        mapdl.run(f"QSOLR_TB({row},0,1)={t_sec}")
        mapdl.run(f"QSOLR_TB({row},1,1)={roof_solar[ih]:.2f}")
        mapdl.run(f"HEXT_TB({row},0,1)={t_sec}")
        mapdl.run(f"HEXT_TB({row},1,1)={h_ext_values[ih]:.2f}")

    T0 = amb_temps[0]

    # NOTE ON AXES: shelter_design.apdl builds the model with
    #   X = length (0 .. SLEN+2*WTHK)
    #   Y = width  (0 .. SWID+2*WTHK)   <- south wall at Y=0, north wall at Y=max
    #   Z = height (-0.3 .. SHGT+...)   <- Z is UP, not Y
    # Every selection below follows that convention. Using Y as the vertical
    # axis selects zero nodes and silently produces no thermal result.
    PITCH_H = 1.6                       # matches *SET,PH,1.6 in the template
    slope_top = H + PITCH_H * 0.55 + 0.15   # top of the two gable slopes
    ridge_top = H + PITCH_H + 0.15          # top of the ridge cap

    # Exterior surface selection + convection BC
    mapdl.nsel("S", "LOC", "Z", -0.31, -0.29)       # Foundation bottom
    mapdl.nsel("A", "LOC", "X", -0.01, 0.01)        # West outer
    mapdl.nsel("A", "LOC", "X", L + 2*wthk - 0.01, L + 2*wthk + 0.01)  # East outer
    mapdl.nsel("A", "LOC", "Z", slope_top - 0.02, slope_top + 0.05)    # Roof slope tops
    mapdl.nsel("A", "LOC", "Z", ridge_top - 0.02, ridge_top + 0.05)    # Ridge cap top
    mapdl.nsel("A", "LOC", "Y", -0.01, 0.01)        # South outer
    mapdl.nsel("A", "LOC", "Y", W + 2*wthk - 0.01, W + 2*wthk + 0.01)  # North outer
    mapdl.cm("EXT_NODES", "NODE")
    mapdl.sf("EXT_NODES", "CONV", "%HEXT_TB%", "%TAMB_TB%")

    # Solar flux on south wall exterior (Y = 0 face)
    mapdl.nsel("S", "LOC", "Y", -0.01, 0.01)
    mapdl.sf("ALL", "HFLUX", "%QSOLS_TB%")

    # Solar flux on roof (both slope tops and the ridge cap)
    mapdl.nsel("S", "LOC", "Z", slope_top - 0.02, slope_top + 0.05)
    mapdl.nsel("A", "LOC", "Z", ridge_top - 0.02, ridge_top + 0.05)
    mapdl.sf("ALL", "HFLUX", "%QSOLR_TB%")

    # Ground BC: fixed deep-ground temperature at the foundation underside
    mapdl.nsel("S", "LOC", "Z", -0.32, -0.28)
    mapdl.d("ALL", "TEMP", 4.0)

    # Interior air convection (inner wall faces)
    mapdl.allsel()
    mapdl.nsel("S", "LOC", "Y", wthk * 0.4, wthk * 0.6)                  # South inner
    mapdl.nsel("A", "LOC", "Y", W + wthk * 1.4, W + wthk * 1.6)          # North inner
    mapdl.nsel("A", "LOC", "X", wthk * 0.4, wthk * 0.6)                  # West inner
    mapdl.nsel("A", "LOC", "X", L + wthk * 1.4, L + wthk * 1.6)          # East inner
    mapdl.sf("ALL", "CONV", 4.0, T0)

    mapdl.allsel()

    # Initial temperature condition
    mapdl.ic("ALL", "TEMP", T0)

    # -- SOLVE: Transient thermal --
    mapdl.finish()
    mapdl.slashsolu()

    mapdl.antype("TRANS")
    mapdl.trnopt("FULL")
    mapdl.timint("ON")
    mapdl.kbc(0)  # Ramped loading
    mapdl.run("DELTIM,3600,600,3600")
    mapdl.outres("ALL", "ALL")
    mapdl.nsubst(1, 6, 1)

    # Solve 24 time steps
    for ihour in range(1, 25):
        mapdl.time(ihour * 3600)
        mapdl.solve()

    mapdl.finish()

    # -- POST-PROCESSING: Extract temperatures via numpy --
    # All temperature extraction uses mapdl.post_processing.nodal_temperature
    # with coordinate-mask filtering, NOT invalid *GET NODE,0,TEMP,MEAN.
    mapdl.post1()

    # Read last time step
    mapdl.set("LAST")

    # Overall temperature extremes (all nodes, no coordinate filter)
    all_avg, T_max_all, T_min_all = _numpy_extract_temps(mapdl)
    if T_max_all is None:
        T_max_all, T_min_all = T0, T0

    # Interior core nodes (away from walls) — coordinate-masked.
    # Template axes: X = length, Y = width, Z = height.
    int_x = (wthk + 0.3, wthk + L - 0.3)
    int_y = (wthk + 0.3, wthk + W - 0.3)
    int_z = (0.2, H - 0.2)
    T_int_avg, T_int_max, T_int_min = _numpy_extract_temps(
        mapdl, x_range=int_x, z_range=int_z, y_range=int_y,
    )
    if T_int_avg is None:
        T_int_avg, T_int_max, T_int_min = T0, T0, T0

    # Per-surface inner temperatures for thermal visualization
    surface_temps = _extract_surface_temperatures(mapdl, L, W, H, wthk)

    # Extract 24-hour interior temperature profile
    hourly_inside = []
    for ih in range(1, 25):
        mapdl.set(ih)
        t_avg, _, _ = _numpy_extract_temps(
            mapdl, x_range=int_x, z_range=int_z, y_range=int_y,
        )
        hourly_inside.append(float(t_avg) if t_avg is not None else float(T0))

    mapdl.finish()

    # -- Build result dictionary --
    return _build_results(
        inputs=inputs,
        climate_profile=climate_profile,
        hourly_inside=hourly_inside,
        T_int_max=float(T_int_max),
        T_int_min=float(T_int_min),
        T_int_avg=float(T_int_avg),
        T_max_all=float(T_max_all),
        T_min_all=float(T_min_all),
        surface_temps=surface_temps,
        total_nodes=total_nodes,
        wall_area=wall_area,
        south_wall_area=south_wall_area,
        roof_area=roof_area,
        floor_area=floor_area,
        interior_volume=interior_volume,
        south_solar=south_solar,
    )


def _extract_surface_temperatures(mapdl, L, W, H, wthk) -> dict:
    """
    Extract average inner-surface temperature for each building component
    using numpy coordinate masking (not invalid *GET NODE,0,TEMP,MEAN).
    """
    # Template axes: X = length, Y = width, Z = height.
    temps = {}
    x_inner = (wthk + 0.2, wthk + L - 0.2)   # along length, clear of end walls
    y_inner = (wthk + 0.2, wthk + W - 0.2)   # across width, clear of side walls
    z_mid = (0.5, H * 0.8)                   # mid-height band of the wall

    # South wall inner surface (low Y face)
    avg, _, _ = _numpy_extract_temps(
        mapdl, x_range=x_inner, z_range=z_mid,
        y_range=(wthk * 0.85, wthk * 1.15),
    )
    temps["south_wall_inner_C"] = avg

    # North wall inner surface (high Y face)
    avg, _, _ = _numpy_extract_temps(
        mapdl, x_range=x_inner, z_range=z_mid,
        y_range=(W + wthk * 0.85, W + wthk * 1.15),
    )
    temps["north_wall_inner_C"] = avg

    # East wall inner surface (high X face)
    avg, _, _ = _numpy_extract_temps(
        mapdl, y_range=y_inner, z_range=z_mid,
        x_range=(L + wthk * 0.85, L + wthk * 1.15),
    )
    temps["east_wall_inner_C"] = avg

    # West wall inner surface (low X face)
    avg, _, _ = _numpy_extract_temps(
        mapdl, y_range=y_inner, z_range=z_mid,
        x_range=(wthk * 0.85, wthk * 1.15),
    )
    temps["west_wall_inner_C"] = avg

    # Roof underside (just below/at wall top height)
    avg, _, _ = _numpy_extract_temps(
        mapdl, x_range=x_inner, y_range=y_inner,
        z_range=(H - 0.1, H + 0.2),
    )
    temps["roof_inner_C"] = avg

    # Floor surface (top of the 0.15 m floor slab)
    avg, _, _ = _numpy_extract_temps(
        mapdl, x_range=x_inner, y_range=y_inner,
        z_range=(0.10, 0.20),
    )
    temps["floor_surface_C"] = avg

    return temps


def _build_results(
    inputs, climate_profile, hourly_inside, T_int_max, T_int_min, T_int_avg,
    T_max_all, T_min_all, surface_temps, total_nodes, wall_area,
    south_wall_area, roof_area, floor_area, interior_volume, south_solar,
) -> dict:
    """Build the standard result dictionary from ANSYS FEA outputs."""

    hourly = climate_profile.get("hourly_data", [])
    L = float(inputs.length_m)
    W = float(inputs.width_m)
    H = float(inputs.height_m)
    wthk = float(getattr(inputs, 'wall_thickness_m', 0.45))

    wmat = {}
    try:
        from app.services.simulation_service import get_simulation_service
        svc = get_simulation_service()
        wmat = svc.materials_db.get(getattr(inputs, 'wall_material_id', 'mud_brick'), {})
    except Exception:
        pass
    k_wall = float(wmat.get('conductivity', 0.72))
    u_wall = k_wall / max(0.01, wthk)

    amb_temps = [float(h["ambient_temp_C"]) for h in hourly[:24]]
    min_amb = min(amb_temps) if amb_temps else -20.0
    max_amb = max(amb_temps) if amb_temps else 3.5
    avg_amb = sum(amb_temps) / len(amb_temps) if amb_temps else -10.0

    # Build time series
    inside_series = []
    ambient_series = []
    solar_series = []
    heat_flow_components = {
        "South Wall": [], "North Wall": [], "East Wall": [],
        "West Wall": [], "Roof": [], "Floor": [], "Openings": [],
    }

    diffs = []
    for hr in range(24):
        t_inside = hourly_inside[hr] if hr < len(hourly_inside) else T_int_avg
        t_amb = amb_temps[hr % len(amb_temps)]
        diff = t_inside - t_amb
        diffs.append(diff)

        # Solar gain delivered to interior
        sol_w = south_solar[hr] * south_wall_area * 0.15 if hr < len(south_solar) else 0.0

        # Heat flow through each component (negative = loss)
        q_total = u_wall * wall_area * (t_inside - t_amb)
        wall_loss_south = -q_total * south_wall_area / max(1, wall_area)
        wall_loss_north = -q_total * south_wall_area / max(1, wall_area)
        wall_loss_east = -q_total * (W * H) / max(1, wall_area)
        wall_loss_west = -q_total * (W * H) / max(1, wall_area)
        roof_loss = -(k_wall / max(0.01, 0.20)) * roof_area * (t_inside - t_amb) * 0.3
        floor_loss = -(k_wall / max(0.01, 0.15)) * floor_area * (t_inside - 4.0) * 0.1

        inside_series.append({"hour": hr, "value": round(t_inside, 2)})
        ambient_series.append({"hour": hr, "value": round(t_amb, 2)})
        solar_series.append({"hour": hr, "value": round(sol_w, 2)})

        heat_flow_components["South Wall"].append({"hour": hr, "value": round(wall_loss_south, 2)})
        heat_flow_components["North Wall"].append({"hour": hr, "value": round(wall_loss_north, 2)})
        heat_flow_components["East Wall"].append({"hour": hr, "value": round(wall_loss_east, 2)})
        heat_flow_components["West Wall"].append({"hour": hr, "value": round(wall_loss_west, 2)})
        heat_flow_components["Roof"].append({"hour": hr, "value": round(roof_loss, 2)})
        heat_flow_components["Floor"].append({"hour": hr, "value": round(floor_loss, 2)})
        heat_flow_components["Openings"].append({"hour": hr, "value": round(-q_total * 0.05, 2)})

    # Computed metrics
    inside_temp_drop = round(T_int_max - T_int_min, 2)
    outside_temp_drop = round(max_amb - min_amb, 2)
    max_temp_diff = round(max(diffs), 2) if diffs else 0.0
    min_temp_diff = round(min(diffs), 2) if diffs else 0.0
    avg_temp_diff = round(sum(diffs) / len(diffs), 2) if diffs else 0.0

    thermal_damping = round(
        max(0.0, min(100.0, (1.0 - inside_temp_drop / max(0.1, outside_temp_drop)) * 100.0)), 1
    )
    comfort_hours = sum(1 for pt in inside_series if pt["value"] >= 12.0)
    total_solar_kwh = round(sum(p["value"] for p in solar_series) * 0.5 / 1000.0, 3)
    total_loss_kwh = round(u_wall * wall_area * abs(T_int_avg - avg_amb) * 24.0 / 1000.0, 3)
    efficiency_score = max(0.0, min(100.0, (T_int_avg - avg_amb) / max(1.0, abs(avg_amb)) * 50 + 50))

    heat_flow_list = [
        {"component": name, "heat_flow_series": series}
        for name, series in heat_flow_components.items()
    ]

    return {
        "engine_used": "ansys_thermal_fea",
        "ansys_thermal_solved": True,
        "peak_inside_temp_C": round(T_int_max, 2),
        "min_inside_temp_C": round(T_int_min, 2),
        "avg_inside_temp_C": round(T_int_avg, 2),
        "min_ambient_temp_C": round(min_amb, 2),
        "max_ambient_temp_C": round(max_amb, 2),
        "avg_ambient_temp_C": round(avg_amb, 2),
        "inside_temp_drop_C": inside_temp_drop,
        "outside_temp_drop_C": outside_temp_drop,
        "max_temp_diff_C": max_temp_diff,
        "min_temp_diff_C": min_temp_diff,
        "avg_temp_diff_C": avg_temp_diff,
        "thermal_damping_ratio_pct": thermal_damping,
        "south_wall_inner_temp_C": surface_temps.get("south_wall_inner_C", T_int_avg * 0.9),
        "comfort_hours": comfort_hours,
        "total_solar_gain_kwh": total_solar_kwh,
        "total_heat_loss_kwh": total_loss_kwh,
        "efficiency_score": round(efficiency_score, 1),
        "inside_temperature_series": inside_series,
        "ambient_temperature_series": ambient_series,
        "solar_gain_series": solar_series,
        "heat_flow_series": heat_flow_list,
        "surface_temperatures": surface_temps,
        "geometry": {
            "length_m": L, "width_m": W, "height_m": H,
            "wall_thickness_m": wthk,
            "floor_area_m2": round(floor_area, 2),
            "wall_area_m2": round(wall_area, 2),
            "roof_area_m2": round(roof_area, 2),
            "interior_volume_m3": round(interior_volume, 2),
            "total_nodes": total_nodes,
        },
        "ansys_fea_details": {
            "solver": "ANSYS MAPDL SOLID70 Transient Thermal via PyMAPDL",
            "element_type": "SOLID70 (3D 8-node thermal brick)",
            "time_steps": 24,
            "time_step_size_s": 3600,
            "boundary_conditions": "Convection (wind-dependent) + Solar flux (Liu-Jordan) + Ground BC",
            "total_nodes": total_nodes,
            "peak_temp_any_C": round(T_max_all, 2),
            "min_temp_any_C": round(T_min_all, 2),
        },
    }


ANSYS_HARD_TIMEOUT_S = int(os.environ.get("ANSYS_HARD_TIMEOUT_S", 600))


def run_ansys_simulation(inputs, materials_db: dict, climate_profile: dict) -> dict:
    """
    Main entry point: run ANSYS PyMAPDL transient thermal FEA.
    Falls back to Python FDM if PyMAPDL is unavailable, fails, or exceeds
    ANSYS_HARD_TIMEOUT_S (default 10 min) — this bounds the case where MAPDL
    hangs (license negotiation, blocked local gRPC port) instead of erroring,
    which would otherwise stall the job forever with no visible failure.
    """
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
    from app.services.fallback_engine import run_fdm_simulation

    job_id = str(uuid.uuid4())[:8]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"=== ANSYS PyMAPDL Job {job_id} ===")

    fallback_reason = None
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(
                _build_and_solve_pymapdl, inputs, materials_db, climate_profile, job_dir
            )
            try:
                result = future.result(timeout=ANSYS_HARD_TIMEOUT_S)
            except FutureTimeoutError:
                raise TimeoutError(
                    f"ANSYS FEA exceeded the {ANSYS_HARD_TIMEOUT_S}s hard timeout "
                    "(MAPDL likely hung on license negotiation or process launch)"
                )
        result["job_id"] = job_id
        result["ansys_job_id"] = job_id
        logger.info(
            f"ANSYS FEA complete: peak={result['peak_inside_temp_C']:.1f}°C, "
            f"min={result['min_inside_temp_C']:.1f}°C, avg={result['avg_inside_temp_C']:.1f}°C"
        )
        return result

    except ImportError as e:
        fallback_reason = f"PyMAPDL not available: {e}"
    except FileNotFoundError as e:
        fallback_reason = f"MAPDL executable not found: {e}"
    except TimeoutError as e:
        fallback_reason = str(e)
    except Exception as e:
        fallback_reason = f"{type(e).__name__}: {e}"

    logger.warning(f"ANSYS FEA failed ({fallback_reason}), falling back to Python FDM")

    # Fallback to Python FDM — surfaced to the UI via ansys_fallback_reason so
    # a fallback is never mistaken for a real ANSYS result.
    try:
        result = run_fdm_simulation(inputs, materials_db, climate_profile)
        result["job_id"] = job_id
        result["engine_used"] = "python_fdm_fallback"
        result["ansys_fallback_reason"] = fallback_reason
        return result
    except Exception as e:
        logger.error(f"FDM fallback also failed: {e}")
        raise
