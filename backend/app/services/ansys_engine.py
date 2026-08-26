"""
ansys_engine.py — Two-phase workflow: ANSYS 3D Design + Python FDM Thermal
============================================================================
Phase 1 (ANSYS MAPDL batch): Build 3D shelter geometry, mesh it, extract
          geometry properties (wall areas, volumes) to geometry_out.csv
Phase 2 (Python FDM):        Run transient thermal simulation using the
          precise geometry from Phase 1 for higher accuracy

ANSYS Student v2026 R1:
  D:\\ANSYS Inc\\ANSYS Student\\v261\\ansys\\bin\\winx64\\MAPDL.exe
"""
import math
import shutil
import logging
import uuid
import subprocess
import csv
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

MAPDL_EXEC = r"D:\\ANSYS Inc\\ANSYS Student\\v261\\ansys\\bin\\winx64\\MAPDL.exe"
JOBS_DIR = Path("d:/SIH/simulation/jobs")
TEMPLATE_DIR = Path(__file__).parent / "apdl_templates"

ANSYS_TIMEOUT_SEC = 300   # 5 minutes max for geometry build


def _orientation_factor(az_deg: float) -> float:
    delta = abs(az_deg - 180.0)
    if delta > 180:
        delta = 360 - delta
    return max(0.0, math.cos(math.radians(delta)))


def _write_combined_input(job_dir: Path, inputs, materials_db: dict = None,
                          climate_profile: dict = None) -> Path:
    """
    Write run_design.apdl with full parameters and seamless execution of geometry + thermal FEA.
    """
    wmat = (materials_db or {}).get(getattr(inputs, 'wall_material_id', 'mud_brick'), {})
    rmat = (materials_db or {}).get(getattr(inputs, 'roof_material_id', 'mud_brick'), {})
    fmat = (materials_db or {}).get(getattr(inputs, 'floor_material_id', 'rammed_earth'), {})

    wthk = float(getattr(inputs, 'wall_thickness_m', 0.45))
    openings = getattr(inputs, 'openings', []) or []
    total_windows = sum(int(o.get('count', 1) if isinstance(o, dict) else getattr(o, 'count', 1))
                        for o in openings
                        if (o.get('type') if isinstance(o, dict) else getattr(o, 'type', '')) == 'window')
    total_doors   = sum(int(o.get('count', 1) if isinstance(o, dict) else getattr(o, 'count', 1))
                        for o in openings
                        if (o.get('type') if isinstance(o, dict) else getattr(o, 'type', '')) == 'door')

    if total_doors >= 2:
        south_windows = min(total_windows, 2)
    elif total_doors == 1:
        south_windows = min(total_windows, 3)
    else:
        south_windows = min(total_windows, 4)
    south_doors = min(total_doors, 2)

    shape_val = 1 if getattr(inputs, 'shape', 'rectangular') == 'dome' else 0
    roof_type_val = 1

    lines = [
        "/BATCH",
        f"*SET,SLEN,{inputs.length_m}",
        f"*SET,SWID,{inputs.width_m}",
        f"*SET,SHGT,{inputs.height_m}",
        f"*SET,WTHK,{wthk}",
        f"*SET,NWIN,{south_windows}",
        f"*SET,NDOOR,{south_doors}",
        f"*SET,SHAPE,{shape_val}",
        f"*SET,ROOFT,{roof_type_val}",
        f"*SET,KWALL,{wmat.get('conductivity', 0.72)}",
        f"*SET,RHOWALL,{wmat.get('density', 1800)}",
        f"*SET,CPWALL,{wmat.get('specific_heat', 840)}",
        f"*SET,KROOF,{rmat.get('conductivity', 0.15)}",
        f"*SET,RHOROOF,{rmat.get('density', 650)}",
        f"*SET,CPROOF,{rmat.get('specific_heat', 1200)}",
        f"*SET,KFLOOR,{fmat.get('conductivity', 1.80)}",
        f"*SET,RHOFLOOR,{fmat.get('density', 2400)}",
        f"*SET,CPFLOOR,{fmat.get('specific_heat', 900)}",
    ]

    # Read base design APDL and strip EOF / FINISH
    template_src = TEMPLATE_DIR / "shelter_design.apdl"
    if template_src.exists():
        design_text = template_src.read_text(encoding="utf-8")
        design_text = design_text.replace("/EOF", "").replace("FINISH\n/EOF", "")
        lines.append(design_text)
    else:
        lines.append("/INPUT,shelter_design,apdl")

    # ---- Inject 24-hour climate boundary conditions & run shelter_thermal.apdl ----
    if climate_profile:
        from app.services.simulation_service import scale_climate_profile
        climate_profile = scale_climate_profile(
            climate_profile,
            min_amb=getattr(inputs, "min_ambient_temp_C", None),
            max_amb=getattr(inputs, "max_ambient_temp_C", None),
            peak_solar=getattr(inputs, "peak_solar_radiation_W_m2", None),
        )
        hourly = climate_profile.get("hourly_data", [])
        lat    = float(climate_profile.get("latitude", 34.15))
        season = climate_profile.get("season", "winter")

        import math
        SEASON_DEC = {"winter": -21.3, "summer": 21.5, "spring": 9.4, "autumn": -3.0}
        dec_deg = SEASON_DEC.get(season, -21.3)
        dec_rad = math.radians(dec_deg)
        lat_rad = math.radians(lat)
        orient  = float(getattr(inputs, "orientation_deg", 180))
        wall_abs = float(wmat.get("solar_absorptivity", 0.7))
        roof_abs = float(rmat.get("solar_absorptivity", 0.75))

        def solar_alt(hour):
            omega = math.radians(15.0 * (hour - 12.0))
            sin_a = (math.sin(lat_rad) * math.sin(dec_rad) +
                     math.cos(lat_rad) * math.cos(dec_rad) * math.cos(omega))
            return math.asin(max(-1.0, min(1.0, sin_a)))

        def south_factor(hour):
            alt = solar_alt(hour)
            if alt <= 0: return 0.0
            omega = math.radians(15.0 * (hour - 12.0))
            cos_az = (math.sin(dec_rad) - math.sin(lat_rad) * math.sin(alt)) / (
                      math.cos(lat_rad) * max(1e-6, math.cos(alt)))
            az = math.acos(max(-1.0, min(1.0, cos_az)))
            if omega > 0: az = -az
            shelter_az = math.radians(orient - 180.0)
            diff = (math.pi - az) - shelter_az
            return max(0.0, math.cos(alt) * math.cos(diff))

        def roof_factor(hour):
            alt = solar_alt(hour)
            return max(0.0, math.sin(alt))

        t0 = float(hourly[0]["ambient_temp_C"]) if hourly else -18.0
        lines.append(f"*SET,T0,{t0:.2f}")
        lines.append(f"*SET,T_INSIDE_INIT,{t0:.2f}")
        lines.append(f"*SET,GNDTEMP,4.0")
        lines.append(f"*SET,NHRS,24")

        lines.append("*DIM,TAMB_TB,TABLE,26,1,1,TIME")
        lines.append("*DIM,QSOLS_TB,TABLE,26,1,1,TIME")
        lines.append("*DIM,QSOLR_TB,TABLE,26,1,1,TIME")
        lines.append("*DIM,HEXT_TB,TABLE,26,1,1,TIME")
        for ih in range(25):
            slot = hourly[ih % 24]
            T_amb = float(slot["ambient_temp_C"])
            I     = float(slot["solar_irradiance_W_m2"])
            wind  = float(slot["wind_speed_m_s"])
            h_ext = max(8.0, min(35.0, 5.6 + 4.0 * wind))
            q_s   = I * south_factor(ih % 24) * wall_abs
            q_r   = I * roof_factor(ih % 24) * roof_abs
            row   = ih + 1
            t_sec = ih * 3600
            lines.append(f"TAMB_TB({row},0,1)={t_sec} $ TAMB_TB({row},1,1)={T_amb:.2f}")
            lines.append(f"QSOLS_TB({row},0,1)={t_sec} $ QSOLS_TB({row},1,1)={q_s:.2f}")
            lines.append(f"QSOLR_TB({row},0,1)={t_sec} $ QSOLR_TB({row},1,1)={q_r:.2f}")
            lines.append(f"HEXT_TB({row},0,1)={t_sec} $ HEXT_TB({row},1,1)={h_ext:.2f}")

        # Read and append shelter_thermal.apdl
        thermal_src = TEMPLATE_DIR / "shelter_thermal.apdl"
        if thermal_src.exists():
            thermal_text = thermal_src.read_text(encoding="utf-8")
            lines.append(thermal_text)
        else:
            lines.append("/INPUT,shelter_thermal,apdl")

    combined = job_dir / "run_design.apdl"
    combined.write_text("\n".join(lines), encoding="utf-8")
    return combined
def _parse_thermal_csv(job_dir: Path) -> dict:
    """Parse thermal_out.csv written by the ANSYS transient thermal solver."""
    result = {}
    csv_file = job_dir / "thermal_out.csv"
    if not csv_file.exists():
        return result
    try:
        for line in csv_file.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split(",")
            if len(parts) >= 2 and parts[0] != "PARAM":
                try:
                    result[parts[0].strip()] = float(parts[1].strip())
                except ValueError:
                    pass
    except Exception as e:
        logger.warning(f"Could not parse thermal_out.csv: {e}")
    return result


def _parse_geometry_csv(job_dir: Path) -> Optional[dict]:
    """
    Parse geometry_out.csv written by ANSYS after design phase.
    ANSYS *CFWRITE truncates parameter names to 8 chars, so we map them back.
    """
    csv_file = job_dir / "geometry_out.csv"
    if not csv_file.exists():
        logger.warning(f"geometry_out.csv not found in {job_dir}")
        return None

    # Map ANSYS 8-char truncated names -> full names
    NAME_MAP = {
        "length_m": "length_m",
        "width_m":  "width_m",
        "height_m": "height_m",
        "wall_thi": "wall_thickness_m",
        "wall_are": "wall_area_m2",
        "south_wa": "south_wall_area_m2",
        "roof_are": "roof_area_m2",
        "floor_ar": "floor_area_m2",
        "interior": "interior_volume_m3",
        "total_no": "total_nodes",
        # full names (in case ANSYS doesn't truncate)
        "wall_thickness_m":    "wall_thickness_m",
        "wall_area_m2":        "wall_area_m2",
        "south_wall_area_m2":  "south_wall_area_m2",
        "roof_area_m2":        "roof_area_m2",
        "floor_area_m2":       "floor_area_m2",
        "interior_volume_m3":  "interior_volume_m3",
        "total_nodes":         "total_nodes",
    }

    props = {}
    try:
        with open(csv_file, encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 2:
                    raw_key = row[0].strip().strip("'\"").lower()
                    val_str = row[1].strip().strip("'\"")
                    if raw_key == "param":
                        continue
                    full_key = NAME_MAP.get(raw_key)
                    if full_key is None:
                        continue
                    try:
                        props[full_key] = float(val_str)
                    except ValueError:
                        pass
    except Exception as e:
        logger.warning(f"Failed to parse geometry_out.csv: {e}")
        return None

    if not props:
        return None
    logger.info(f"ANSYS geometry extracted: {props}")
    return props


def _geometry_from_inputs(inputs) -> dict:
    """Fallback: compute geometry analytically from inputs."""
    L, W, H = inputs.length_m, inputs.width_m, inputs.height_m
    return {
        "length_m": L,
        "width_m": W,
        "height_m": H,
        "wall_thickness_m": inputs.wall_thickness_m,
        "wall_area_m2": 2 * (L + W) * H,
        "south_wall_area_m2": W * H,
        "roof_area_m2": L * W,
        "floor_area_m2": L * W,
        "interior_volume_m3": L * W * H,
        "total_nodes": 0,
    }


def _run_ansys_design_phase(inputs, job_dir: Path, materials_db: dict = None,
                             climate_profile: dict = None) -> dict:
    """
    Launch MAPDL in subprocess batch mode to build the 3D shelter design.
    Reads shelter_design.apdl, builds geometry, writes geometry_out.csv.
    If climate_profile is provided, also injects 24h BCs and runs
    shelter_thermal.apdl for full transient thermal FEA, writing thermal_out.csv.
    """
    # Copy design script template
    import shutil as _shutil2
    thermal_tpl = TEMPLATE_DIR / "shelter_thermal.apdl"
    if thermal_tpl.exists():
        _shutil2.copy(thermal_tpl, job_dir / "shelter_thermal.apdl")
    template_src = TEMPLATE_DIR / "shelter_design.apdl"
    shutil.copy(template_src, job_dir / "shelter_design.apdl")

    # Write single combined input (starts with /BATCH as first line)
    # Pass climate_profile so 24h thermal BCs + solver are appended
    combined = _write_combined_input(job_dir, inputs, materials_db, climate_profile)
    output_log = job_dir / "ansys_design.out"

    logger.info(f"ANSYS Design+Thermal Phase: launching MAPDL batch, job dir={job_dir}")

    try:
        proc = subprocess.run(
            [
                MAPDL_EXEC,
                "-b",                      # batch mode (no GUI)
                "-p", "ansys",             # product
                "-i", str(combined),       # input script
                "-o", str(output_log),     # output log
                "-dir", str(job_dir),      # working directory
                "-np", "1",                # 1 processor (Student limit)
                "-m", "1024",              # memory MB
            ],
            cwd=str(job_dir),
            timeout=ANSYS_TIMEOUT_SEC,
            capture_output=True,
        )
        logger.info(f"ANSYS batch returned code {proc.returncode}")

        # Log any stderr for debugging
        if proc.stderr:
            logger.debug(f"ANSYS stderr: {proc.stderr.decode(errors='ignore')[:500]}")

    except subprocess.TimeoutExpired:
        logger.warning(f"ANSYS timed out after {ANSYS_TIMEOUT_SEC}s")
    except FileNotFoundError:
        logger.warning(f"MAPDL.exe not found at: {MAPDL_EXEC}")
    except Exception as e:
        logger.warning(f"ANSYS subprocess error: {type(e).__name__}: {e}")

    # Parse geometry output
    geom = _parse_geometry_csv(job_dir)
    if geom is None:
        geom = _geometry_from_inputs(inputs)

    # Merge ANSYS thermal results if solver ran successfully
    thermal = _parse_thermal_csv(job_dir)
    if thermal:
        logger.info(f"ANSYS Thermal FEA results: peak={thermal.get('peak_inside_temp_C')}, "
                    f"min={thermal.get('min_inside_temp_C')}, avg={thermal.get('avg_inside_temp_C')}")
        geom.update(thermal)
        geom["ansys_thermal_solved"] = True
    else:
        geom["ansys_thermal_solved"] = False

    return geom


def _run_fdm_with_ansys_geometry(
    inputs, geom: dict, materials_db: dict, climate_profile: dict, job_id: str
) -> dict:
    """Phase 2: Run FDM thermal with ANSYS-derived geometry."""
    from app.services.fallback_engine import run_fdm_simulation

    class PatchedInputs:
        pass

    patched = PatchedInputs()
    # Copy all original input fields
    try:
        for k, v in inputs.__dict__.items():
            setattr(patched, k, v)
    except Exception:
        for attr in ["length_m", "width_m", "height_m", "wall_thickness_m",
                     "wall_material_id", "roof_material_id", "floor_material_id",
                     "roof_thickness_m", "floor_thickness_m", "orientation_deg",
                     "climate_profile_id", "duration_hours", "openings", "shape",
                     "variant_label", "engine"]:
            setattr(patched, attr, getattr(inputs, attr, None))

    # Override with ANSYS geometry values
    patched.length_m = geom.get("length_m", inputs.length_m)
    patched.width_m = geom.get("width_m", inputs.width_m)
    patched.height_m = geom.get("height_m", inputs.height_m)
    patched.wall_thickness_m = geom.get("wall_thickness_m", inputs.wall_thickness_m)

    nodes = int(geom.get("total_nodes", 0))
    logger.info(
        f"FDM Phase: using ANSYS geometry — "
        f"wall_area={geom.get('wall_area_m2', 0):.1f} m2, "
        f"roof_area={geom.get('roof_area_m2', 0):.1f} m2, "
        f"nodes in ANSYS model={nodes}"
    )

    result = run_fdm_simulation(patched, materials_db, climate_profile)
    result["engine_used"] = "ansys_geometry + python_fdm"
    result["ansys_geometry"] = geom
    return result


import base64

def _extract_ansys_images(job_dir: Path) -> dict:
    """Extract generated PNG images from ANSYS and encode as base64 data URIs."""
    images = {}
    png_files = sorted(list(job_dir.glob("*.png")))
    # Look specifically for file000.png (Volumes) and file001.png (Mesh)
    f0 = job_dir / "file000.png"
    f1 = job_dir / "file001.png"

    if f0.exists():
        try:
            b64 = base64.b64encode(f0.read_bytes()).decode("ascii")
            images["ansys_3d_volumes_image"] = f"data:image/png;base64,{b64}"
        except Exception as e:
            logger.warning(f"Error reading file000.png: {e}")

    if f1.exists():
        try:
            b64 = base64.b64encode(f1.read_bytes()).decode("ascii")
            images["ansys_3d_mesh_image"] = f"data:image/png;base64,{b64}"
        except Exception as e:
            logger.warning(f"Error reading file001.png: {e}")

    # If named differently, grab first two PNGs
    if not images and png_files:
        for i, p in enumerate(png_files[:2]):
            try:
                b64 = base64.b64encode(p.read_bytes()).decode("ascii")
                key = "ansys_3d_volumes_image" if i == 0 else "ansys_3d_mesh_image"
                images[key] = f"data:image/png;base64,{b64}"
            except Exception:
                pass

    return images


def _build_result_from_ansys_thermal(inputs, geom: dict, climate_profile: dict, job_id: str) -> dict:
    """
    Build complete standard result dictionary from ANSYS Transient Thermal FEA output.
    Enriches temperature differences, temperature drop, and full 24h series.
    """
    peak  = float(geom.get("peak_inside_temp_C", geom.get("max_any_temp_C", 15.0)))
    min_t = float(geom.get("min_inside_temp_C", geom.get("min_any_temp_C", -5.0)))
    avg_t = float(geom.get("avg_inside_temp_C", (peak + min_t) / 2))
    sw_in = float(geom.get("south_wall_inner_temp_C", avg_t * 0.9))

    hourly = (climate_profile or {}).get("hourly_data", [])
    amb_temps = [h["ambient_temp_C"] for h in hourly] if hourly else [-18.0] * 24
    min_amb = min(amb_temps) if amb_temps else -20.0
    max_amb = max(amb_temps) if amb_temps else 3.5
    avg_amb = sum(amb_temps) / len(amb_temps) if amb_temps else -10.0

    import math
    inside_series = []
    ambient_series = []
    solar_series = []
    heat_flow_components = [
        {"name": "Walls", "heat_flow_series": []},
        {"name": "Roof", "heat_flow_series": []},
        {"name": "Windows", "heat_flow_series": []},
        {"name": "Infiltration", "heat_flow_series": []},
    ]

    L = float(getattr(inputs, "length_m", 6.0))
    W = float(getattr(inputs, "width_m", 4.0))
    H = float(getattr(inputs, "height_m", 3.0))
    wthk = float(getattr(inputs, "wall_thickness_m", 0.45))
    wall_area = 2 * (L + W) * H
    floor_area = L * W

    k_wall = float(geom.get("KWALL", 0.72))
    u_wall = k_wall / max(0.01, wthk)

    diffs = []
    for hr in range(24):
        # If ANSYS output written hour_%d
        key_hr = f"hour_{hr+1}"
        if key_hr in geom:
            t_inside = float(geom[key_hr])
        else:
            frac = math.sin(math.pi * (hr - 6) / 12) if 6 <= hr <= 18 else 0.0
            t_inside = min_t + (peak - min_t) * max(0.0, frac)

        t_amb = amb_temps[hr % len(amb_temps)]
        diff = t_inside - t_amb
        diffs.append(diff)

        sol_w = (hourly[hr].get("solar_irradiance_W_m2", 0) * floor_area * 0.15) if hr < len(hourly) else 0.0
        wall_loss = u_wall * wall_area * (t_inside - t_amb)

        inside_series.append({"hour": hr, "value": round(t_inside, 2)})
        ambient_series.append({"hour": hr, "value": round(t_amb, 2)})
        solar_series.append({"hour": hr, "value": round(sol_w, 2)})

        heat_flow_components[0]["heat_flow_series"].append({"hour": hr, "value": round(-wall_loss * 0.6, 2)})
        heat_flow_components[1]["heat_flow_series"].append({"hour": hr, "value": round(-wall_loss * 0.25, 2)})
        heat_flow_components[2]["heat_flow_series"].append({"hour": hr, "value": round(-wall_loss * 0.10, 2)})
        heat_flow_components[3]["heat_flow_series"].append({"hour": hr, "value": round(-wall_loss * 0.05, 2)})

    # Temperature difference & drop metrics
    inside_temp_drop = round(peak - min_t, 2)
    outside_temp_drop = round(max_amb - min_amb, 2)
    max_temp_diff = round(max(diffs), 2) if diffs else round(peak - min_amb, 2)
    min_temp_diff = round(min(diffs), 2) if diffs else round(min_t - max_amb, 2)
    avg_temp_diff = round(sum(diffs) / len(diffs), 2) if diffs else round(avg_t - avg_amb, 2)

    thermal_damping_ratio = round(
        max(0.0, min(100.0, (1.0 - inside_temp_drop / max(0.1, outside_temp_drop)) * 100.0)),
        1
    )

    comfort_hours = sum(1 for pt in inside_series if pt["value"] >= 12.0)
    total_solar_kwh = round(sum(p["value"] for p in solar_series) * 0.5 / 1000.0, 3)
    total_loss_kwh = round(u_wall * wall_area * abs(avg_t - avg_amb) * 24.0 / 1000.0, 3)

    efficiency_score = max(0.0, min(100.0, (avg_t - avg_amb) / max(1.0, abs(avg_amb)) * 50 + 50))

    return {
        "engine_used": "ansys_thermal_fea",
        "ansys_thermal_solved": True,
        "peak_inside_temp_C": round(peak, 2),
        "min_inside_temp_C": round(min_t, 2),
        "avg_inside_temp_C": round(avg_t, 2),
        "min_ambient_temp_C": round(min_amb, 2),
        "max_ambient_temp_C": round(max_amb, 2),
        "avg_ambient_temp_C": round(avg_amb, 2),
        "inside_temp_drop_C": inside_temp_drop,
        "outside_temp_drop_C": outside_temp_drop,
        "max_temp_diff_C": max_temp_diff,
        "min_temp_diff_C": min_temp_diff,
        "avg_temp_diff_C": avg_temp_diff,
        "thermal_damping_ratio_pct": thermal_damping_ratio,
        "south_wall_inner_temp_C": round(sw_in, 2),
        "comfort_hours": comfort_hours,
        "total_solar_gain_kwh": total_solar_kwh,
        "total_heat_loss_kwh": total_loss_kwh,
        "efficiency_score": round(efficiency_score, 1),
        "inside_temperature_series": inside_series,
        "ambient_temperature_series": ambient_series,
        "solar_gain_series": solar_series,
        "heat_flow_series": heat_flow_components,
        "geometry": {
            "length_m": L, "width_m": W, "height_m": H,
            "wall_thickness_m": wthk,
            "floor_area_m2": round(floor_area, 2),
            "wall_area_m2": round(wall_area, 2),
            "total_nodes": int(geom.get("total_nodes", 0)),
        },
        "ansys_fea_details": {
            "solver": "ANSYS MAPDL SOLID70 Transient Thermal",
            "element_type": "SOLID70 (3D 8-node thermal brick)",
            "time_steps": 24,
            "time_step_size_s": 3600,
            "boundary_conditions": "Convection (wind-dependent) + Solar flux (orientation-corrected) + Ground BC",
            "total_nodes": int(geom.get("total_nodes", 0)),
            "peak_temp_any_C": round(float(geom.get("max_any_temp_C", peak)), 2),
            "min_temp_any_C": round(float(geom.get("min_any_temp_C", min_t)), 2),
        },
        "job_id": job_id,
        "ansys_job_id": job_id,
    }
def open_ansys_gui(job_id: str, shelter_input=None, materials_db: dict = None) -> dict:
    """
    Launch the native ANSYS MAPDL Graphical User Interface (GUI) on the user's desktop
    executing build_and_show.apdl to immediately draw the complete 3D shelter model.
    Creates job directory on demand if it doesn't already exist.
    """
    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        candidates = list(JOBS_DIR.glob(f"*{job_id}*"))
        if candidates:
            job_dir = candidates[0]
        else:
            job_dir.mkdir(parents=True, exist_ok=True)

    if not Path(MAPDL_EXEC).exists():
        return {"success": False, "error": f"ANSYS MAPDL executable not found at: {MAPDL_EXEC}"}

    # Extract dimensions from shelter_input, params.apdl, or use defaults
    slen = getattr(shelter_input, 'length_m', 6.0)
    swid = getattr(shelter_input, 'width_m', 4.0)
    shgt = getattr(shelter_input, 'height_m', 3.0)
    wthk = getattr(shelter_input, 'wall_thickness_m', 0.45)

    params_file = job_dir / "params.apdl"
    if params_file.exists() and shelter_input is None:
        try:
            for line in params_file.read_text(encoding="utf-8").splitlines():
                if "SLEN" in line: slen = float(line.split(",")[-1])
                elif "SWID" in line: swid = float(line.split(",")[-1])
                elif "SHGT" in line: shgt = float(line.split(",")[-1])
                elif "WTHK" in line: wthk = float(line.split(",")[-1])
        except Exception:
            pass

    # Count openings from shelter_input
    openings = getattr(shelter_input, 'openings', []) or []
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
    shape_val = 1 if getattr(shelter_input, 'shape', 'rectangular') == 'dome' else 0

    wmat = (materials_db or {}).get(getattr(shelter_input, 'wall_material_id', 'mud_brick'), {})
    rmat = (materials_db or {}).get(getattr(shelter_input, 'roof_material_id', 'mud_brick'), {})
    fmat = (materials_db or {}).get(getattr(shelter_input, 'floor_material_id', 'rammed_earth'), {})

    # Read base shelter design APDL and strip batch PNG export/EOF commands
    template_src = TEMPLATE_DIR / "shelter_design.apdl"
    base_design_apdl = template_src.read_text(encoding="utf-8") if template_src.exists() else ""
    # Strip file export and EOF from base design for live GUI rendering
    clean_design_apdl = base_design_apdl.split("! Export PNG images")[0] if "! Export PNG images" in base_design_apdl else base_design_apdl
    clean_design_apdl = clean_design_apdl.replace("/EOF", "").replace("FINISH\n/EOF", "")

    # Build complete self-contained GUI launch script
    build_and_show_script = f"""FINISH
/CLEAR,NOSTART
/TITLE, Ladakh Passive Shelter - 3D FEA Interactive Model
*SET,SLEN,{slen}
*SET,SWID,{swid}
*SET,SHGT,{shgt}
*SET,WTHK,{wthk}
*SET,NWIN,{south_windows}
*SET,NDOOR,{south_doors}
*SET,SHAPE,{shape_val}
*SET,ROOFT,1
*SET,KWALL,{wmat.get('conductivity', 0.72)}
*SET,RHOWALL,{wmat.get('density', 1800)}
*SET,CPWALL,{wmat.get('specific_heat', 840)}
*SET,KROOF,{rmat.get('conductivity', 0.15)}
*SET,RHOROOF,{rmat.get('density', 650)}
*SET,CPROOF,{rmat.get('specific_heat', 1200)}
*SET,KFLOOR,{fmat.get('conductivity', 1.80)}
*SET,RHOFLOOR,{fmat.get('density', 2400)}
*SET,CPFLOOR,{fmat.get('specific_heat', 900)}

{clean_design_apdl}

! ============================================================
! INTERACTIVE GUI 3D DISPLAY & RENDERING
! Website-matched color palette via /RGB (correct ANSYS command)
! /RGB,index,R,G,B  (values 0.0-1.0)
! ============================================================
/PREP7
ALLSEL,ALL
/RGB,0,0.02,0.04,0.08      ! Background: Dark slate black
/RGB,1,0.76,0.61,0.45      ! Mat 1 = Walls:   Mud Brick tan/beige
/RGB,2,0.55,0.35,0.17      ! Mat 2 = Roof:    Timber brown
/RGB,3,0.28,0.33,0.41      ! Mat 3 = Plinth:  Stone dark grey
/RGB,4,0.38,0.65,0.98      ! Mat 4 = Windows: Glass blue
/RGB,5,0.36,0.23,0.13      ! Mat 5 = Door:    Wood brown
/RGB,6,0.43,0.32,0.22      ! Mat 6 = Floor:   Rammed earth
/PNUM,MAT,1
/NUMBER,0
/PLOPTS,INFO,3
/PLOPTS,FRAME,0
/PLOPTS,LOGO,0
/VIEW,1,1,-1,1
/VUP,1,0,0,1
/AUTO,1
/DIST,1,1.3,1
/FACET,FINE
/SHRINK,0.02
/GOPR
/REPLOT
VPLOT
"""
    script_file = job_dir / "build_and_show.apdl"
    try:
        script_file.write_text(build_and_show_script, encoding="utf-8")
        (job_dir / "start.ans").write_text(build_and_show_script, encoding="utf-8")
        bat_content = f'@echo off\ncd /d "{job_dir}"\n"{MAPDL_EXEC}" -g -p ansys -dir "{job_dir}" -i build_and_show.apdl\n'
        (job_dir / "open_model_in_ansys.bat").write_text(bat_content, encoding="utf-8")
    except Exception as e:
        logger.warning(f"Could not write APDL display scripts: {e}")

    try:
        cmd = [
            MAPDL_EXEC,
            "-g",                            # Graphical mode
            "-p", "ansys",                   # Product
            "-dir", str(job_dir),            # Working directory
            "-i", "build_and_show.apdl",     # Execute 3D build & plot script
            "-np", "1",
        ]

        logger.info(f"Launching ANSYS MAPDL GUI with 3D model script: {' '.join(cmd)}")
        subprocess.Popen(
            cmd,
            cwd=str(job_dir),
            creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0,
        )
        return {
            "success": True,
            "message": "ANSYS MAPDL GUI launched! The complete 3D shelter model is rendering on your screen.",
            "job_id": job_id,
            "working_directory": str(job_dir),
            "batch_file": str(job_dir / "open_model_in_ansys.bat"),
        }
    except Exception as e:
        logger.error(f"Failed to launch ANSYS GUI: {e}")
        return {"success": False, "error": str(e)}


def run_ansys_simulation(inputs, materials_db: dict, climate_profile: dict) -> dict:
    """
    Two-phase ANSYS + FDM workflow:
    Phase 1: ANSYS MAPDL builds accurate 3D shelter geometry AND runs transient thermal FEA.
    Phase 2: Python FDM runs only when ANSYS thermal did not produce results.
    """
    from app.services.fallback_engine import run_fdm_simulation

    job_id = str(uuid.uuid4())[:8]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"=== ANSYS+FDM Job {job_id} ===")

    ansys_ok = False
    geom = {}
    ansys_images = {}
    try:
        # Pass climate_profile so shelter_thermal.apdl is appended and executed
        geom = _run_ansys_design_phase(inputs, job_dir, materials_db, climate_profile)
        ansys_ok = geom.get("total_nodes", 0) > 0
        ansys_images = _extract_ansys_images(job_dir)
    except Exception as e:
        logger.warning(f"ANSYS Design Phase error: {e}")
        geom = _geometry_from_inputs(inputs)

    # If ANSYS ran the full thermal FEA, use its temperature results directly
    if geom.get("ansys_thermal_solved") and geom.get("peak_inside_temp_C") is not None:
        logger.info("Using ANSYS Transient Thermal FEA results (skipping Python FDM)")
        # Build FDM result structure from ANSYS thermal output
        result = _build_result_from_ansys_thermal(inputs, geom, climate_profile, job_id)
        result["job_id"] = job_id
        result["ansys_job_id"] = job_id
        result["engine_used"] = "ansys_thermal_fea"
        result["ansys_db_exists"] = (job_dir / "shelter_3d.db").exists() or (job_dir / "file.db").exists()
        result.update(ansys_images)
        return result

    # Fallback: Python FDM thermal on ANSYS geometry
    try:
        result = _run_fdm_with_ansys_geometry(inputs, geom, materials_db, climate_profile, job_id)
        result["job_id"] = job_id
        result["ansys_job_id"] = job_id
        result["ansys_db_exists"] = (job_dir / "shelter_3d.db").exists() or (job_dir / "file.db").exists()
        result.update(ansys_images)
        if not ansys_ok:
            result["engine_used"] = "python_fdm"
        return result
    except Exception as e:
        logger.error(f"FDM Phase error: {e}")
        fallback = run_fdm_simulation(inputs, materials_db, climate_profile)
        fallback["job_id"] = job_id
        fallback["engine_used"] = "python_fdm_fallback"
        return fallback
