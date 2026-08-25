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


def _write_combined_input(job_dir: Path, inputs, materials_db: dict = None) -> Path:
    """
    Write a single APDL input file that:
      1. Starts with /BATCH (required first line)
      2. Sets ALL geometry + material + opening parameters matching the frontend model exactly
      3. Includes the main design script
    """
    wthk = inputs.wall_thickness_m
    wmat = (materials_db or {}).get(getattr(inputs, 'wall_material_id', 'mud_brick'), {})
    rmat = (materials_db or {}).get(getattr(inputs, 'roof_material_id', 'mud_brick'), {})
    fmat = (materials_db or {}).get(getattr(inputs, 'floor_material_id', 'rammed_earth'), {})

    # Count openings (mirrors frontend totalWindows / totalDoors)
    openings = getattr(inputs, 'openings', []) or []
    total_windows = sum(int(o.get('count', 1) if isinstance(o, dict) else getattr(o, 'count', 1))
                        for o in openings
                        if (o.get('type') if isinstance(o, dict) else getattr(o, 'type', '')) == 'window')
    total_doors   = sum(int(o.get('count', 1) if isinstance(o, dict) else getattr(o, 'count', 1))
                        for o in openings
                        if (o.get('type') if isinstance(o, dict) else getattr(o, 'type', '')) == 'door')

    # Enforce Rule 1 (1 door -> max 3 win) and Rule 2 (2 doors -> max 2 win) for south wall
    if total_doors >= 2:
        south_windows = min(total_windows, 2)
    elif total_doors == 1:
        south_windows = min(total_windows, 3)
    else:
        south_windows = min(total_windows, 4)
    south_doors = min(total_doors, 2)

    # Shape: 0=rectangular, 1=dome
    shape_val = 1 if getattr(inputs, 'shape', 'rectangular') == 'dome' else 0

    # Roof type: 0=flat, 1=gable pitched
    roof_type_val = 1  # default gable; could be extended from inputs later

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
        "/INPUT,shelter_design,apdl",
    ]
    combined = job_dir / "run_design.apdl"
    combined.write_text("\n".join(lines), encoding="utf-8")
    return combined


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


def _run_ansys_design_phase(inputs, job_dir: Path, materials_db: dict = None) -> dict:
    """
    Launch MAPDL in subprocess batch mode to build the 3D shelter design.
    Reads shelter_design.apdl, builds geometry, writes geometry_out.csv.
    """
    # Copy design script template
    template_src = TEMPLATE_DIR / "shelter_design.apdl"
    shutil.copy(template_src, job_dir / "shelter_design.apdl")

    # Write single combined input (starts with /BATCH as first line)
    combined = _write_combined_input(job_dir, inputs, materials_db)
    output_log = job_dir / "ansys_design.out"

    logger.info(f"ANSYS Design Phase: launching MAPDL batch, job dir={job_dir}")

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

    # Try to parse geometry output
    geom = _parse_geometry_csv(job_dir)
    if geom:
        return geom

    logger.info("Falling back to analytically computed geometry")
    return _geometry_from_inputs(inputs)


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

    # Inject all parameters then call shelter_design.apdl (same script as batch run)
    # This ensures the GUI renders the EXACT SAME model as the frontend
    build_and_show_script = f"""FINISH
/CLEAR,NOSTART
/TITLE, Ladakh Passive Shelter - Frontend Mirror (ANSYS GUI)
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
/INPUT,shelter_design,apdl
"""
    script_file = job_dir / "build_and_show.apdl"
    # Copy the shelter_design.apdl template to job dir so /INPUT can find it
    import shutil as _shutil
    template_src = TEMPLATE_DIR / "shelter_design.apdl"
    if template_src.exists():
        _shutil.copy(template_src, job_dir / "shelter_design.apdl")
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
        }
    except Exception as e:
        logger.error(f"Failed to launch ANSYS GUI: {e}")
        return {"success": False, "error": str(e)}


def run_ansys_simulation(inputs, materials_db: dict, climate_profile: dict) -> dict:
    """
    Two-phase ANSYS + FDM workflow:
    Phase 1: ANSYS MAPDL builds accurate 3D shelter geometry in batch mode & exports 3D PNG plots + .db file.
    Phase 2: Python FDM runs transient thermal on ANSYS geometry.
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
        geom = _run_ansys_design_phase(inputs, job_dir, materials_db)
        ansys_ok = geom.get("total_nodes", 0) > 0
        ansys_images = _extract_ansys_images(job_dir)
    except Exception as e:
        logger.warning(f"ANSYS Design Phase error: {e}")
        geom = _geometry_from_inputs(inputs)

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
