<div align="center">

# THERMA·LADAKH

**A dual-engine thermal simulation platform for high-altitude passive shelters.**

Design a cold-region shelter, simulate its 24-hour thermal behaviour before a single brick is laid, and see exactly how warm it stays when the outside air hits −25 °C.

`ANSYS MAPDL 3D FEA` · `Python FDM (ISO 13790)` · `Liu–Jordan solar model` · `NASA POWER climate` · `Three.js FLIR visualization`

<sub>Smart India Hackathon 2026 · Problem Statement **SIH26051** · Team **Compile Time Terror**</sub>

</div>

---

## The problem

In Ladakh and similar high-altitude cold deserts, winter nights fall to **−25 °C**. Keeping a shelter liveable means burning diesel, kerosene, or scarce firewood — fuel that is expensive, unhealthy (indoor smoke, CO poisoning), and, near the border, airlifted at enormous logistical cost across passes like Zoji La and Khardung La.

The deeper problem is **design guesswork**: an architect only learns whether a shelter holds heat *after* it is built. Get it wrong, and it must be rebuilt.

Professional finite-element tools *can* answer these questions — but the problem statement notes the barrier plainly: a full FEA suite such as ANSYS is an **~80 GB installation** behind a paid licence, far out of reach for a field engineer on a low-spec laptop in a low-connectivity border region.

## The solution

THERMA·LADAKH is a **browser-based digital twin** for passive-solar shelters. It brings FEA-grade transient thermal analysis to a zero-install web app, and validates it against a real ANSYS backend where one is available — so the rigour of an 80 GB solver reaches a grassroots builder through a web page.

You configure a shelter (geometry, materials, glazing, orientation, climate), pick an engine, and get back a full 24-hour thermal profile: interior temperature, per-surface heat distribution, solar capture, envelope heat loss, comfort hours, build cost, and fuel-cost savings — with an interactive 3D FLIR view of the result.

---

## Dual-engine architecture

The core idea is two independent solvers that cross-validate each other.

| | **ANSYS MAPDL (3D FEA)** | **Python FDM (1D)** |
|---|---|---|
| Method | SOLID70 solid-element transient conduction | Implicit multi-layer finite difference |
| Standard | Full 3D nodal solution | ISO 13790 compliant |
| Speed | Minutes (mesh + 24-step solve) | ~1 second |
| Role | Accurate physics + validation | Fast, field-ready, offline-capable |
| Needs | Local ANSYS install (auto-detected) | Nothing beyond Python |

Both are driven by the same boundary conditions — a **Liu–Jordan** isotropic-sky solar model (with Erbs diffuse split) folded into **sol-air surface temperatures**, wind-coupled convection, a deep-ground tie, and passive-solar direct gain onto the floor. When ANSYS is unavailable or a geometry it can't mesh is requested, the platform falls back to FDM cleanly and says so — it never returns a silent or empty result.

> **Why two engines?** A single number is easy to doubt. Two methods that share no code and agree within ~2 °C are hard to argue with — that agreement is the strongest internal evidence the result is real.

---

## Features

- **Three envelope forms** — Alpine Rectangular (gable/flat), A-Frame Cabin (snow-shedding), and Igloo Hemisphere.
- **Parametric materials** — mud brick, rammed earth, stone, EPS, mineral wool, timber, and composites, each with real conductivity / density / heat-capacity, plus glazing SHGC.
- **Live climate** — one click pulls real hourly temperature, irradiance, and wind for Leh from the **NASA POWER** API, with bundled seasonal profiles as fallback.
- **Interactive 3D FLIR viewer** — per-surface thermographic colouring from the actual solved field, a scrububle sun path, the winter solar beam entering the south glazing and pooling on the floor, roof cutaway, and XYZ reference axes (Three.js / WebGL).
- **Cost & feasibility** — bill-of-materials build cost, annual heating cost, and % fuel-cost saved versus an uninsulated baseline, in ₹.
- **36-design optimizer** — an automated sweep over material, thickness, and orientation that ranks candidates by comfort.
- **Multi-variant comparison** — evaluate several designs side by side and surface the optimal one.
- **PDF report** — a full text/table export of the run, generated client-side.

---

## Tech stack

**Backend** — Python 3.12 · FastAPI · PyMAPDL (`ansys-mapdl-core`) · NumPy · Pydantic
**Frontend** — React 19 · Vite · Tailwind CSS · Three.js · Recharts
**Data** — NASA POWER Hourly API · bundled materials & climate datasets

---

## Quick start

### Prerequisites
- Python 3.12+ and Node.js 18+
- *(Optional, for the ANSYS engine)* A local ANSYS Mechanical APDL install — the backend auto-detects it, or set `MAPDL_EXEC_PATH`.

### Backend

```bash
cd backend
pip install -r requirements.txt

# optional: point at your ANSYS executable (otherwise auto-detected)
# Windows PowerShell:
$env:MAPDL_EXEC_PATH = "C:\Program Files\ANSYS Inc\v261\ansys\bin\winx64\ANSYS261.exe"

uvicorn app.main:app --reload --port 8000
```

The API serves on `http://localhost:8000` (interactive docs at `/docs`).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, configure a shelter, and run a simulation.

> Without an ANSYS install, select the **FDM** engine (or `auto`) — it runs everywhere in seconds. The ANSYS engine needs a local MAPDL licence.

---

## Project structure

```
SIH_Thermal/
├── backend/
│   └── app/
│       ├── main.py                 # FastAPI app
│       ├── routers/                # /api/simulate, /compare, /optimize, /climate/live …
│       ├── services/
│       │   ├── ansys_engine.py     # PyMAPDL 3D transient thermal FEA
│       │   ├── fallback_engine.py  # Python FDM (ISO 13790) solver
│       │   ├── nasa_climate.py     # NASA POWER live climate fetch
│       │   ├── cost_estimator.py   # build & heating-cost feasibility
│       │   ├── optimizer.py        # 36-design parameter sweep
│       │   └── apdl_templates/     # parametric shelter geometry (APDL)
│       ├── models/schemas.py       # Pydantic request/response models
│       └── data/                   # materials & climate datasets
└── frontend/
    └── src/
        ├── pages/                  # InputPage (wizard), ResultsPage (telemetry)
        ├── components/             # Shelter3DViewer (FLIR), charts, selectors
        └── api/                    # backend client
```

---

## How a simulation flows

```
User input ──▶ 3D geometry ──▶ engine (ANSYS 3D FEA │ Python FDM)
                                   ▲          ▲
              Liu–Jordan solar ────┘          └──── NASA POWER climate
                                   │
                             24-hour transient solve
                                   │
        ┌──────────────┬───────────┴────────────┬───────────────┐
   3D FLIR view   temperature /            cost & fuel        PDF report
                  heat-flow charts          savings
```

---

## Validation

Results are checked two ways: against **physics bounds** the solver must obey (sol-air surface limits, energy balance, diurnal damping, cross-engine agreement), and against the **known performance envelope** of documented Ladakh passive-solar buildings such as DRDO's DIHAR work and Sonam Wangchuk's SECMOL campus.

---

## Roadmap

- Native ANSYS boundary conditions for the dome and A-frame geometries (currently solved through the rectangular envelope path / FDM).
- Seismic (Zone IV/V) structural overlay with Dhajji-Dewari timber lacing.
- Region packs beyond Ladakh — Sikkim, Uttarakhand, and other cold high-altitude zones.

---

## Credits

Built by **Team Compile Time Terror** for Smart India Hackathon 2026 (SIH26051).
Grounded in prior passive-solar work in Ladakh by **DRDO DIHAR** and **SECMOL / Sonam Wangchuk**.
