# THERMA-LADAKH

## Description

THERMA-LADAKH predicts and compares passive shelter thermal performance for Ladakh using climate, material, and geometry inputs.

## SIH Problem Statement

SIH26051 — Software Based Model Development for Design of Area Specific Shelter for Thermal Comfort Maintenance (Ladakh).

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | React, Vite, Tailwind CSS, Recharts, Three.js |
| Backend | FastAPI, Pydantic, Uvicorn |
| Physics | Python transient FDM and lumped thermal-capacitance screening |
| FEA | ANSYS MAPDL, PyMAPDL, SOLID70 |

## Quick Start (Docker)

```sh
git clone https://github.com/abhaysachan007/SIH_Thermal.git && cd SIH_Thermal
cp /path/to/your/backend.env backend/.env
docker compose up --build
```

The backend environment file must define `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, and `TIDB_DATABASE`. The frontend is at `http://localhost:5173`; the API is at `http://localhost:8000`.

## Quick Start (Manual)

```sh
cd backend
python -m pip install -r requirements.txt
python run.py
```

In another terminal:

```sh
cd frontend
npm install
npm run dev
```

## Key Features

- Simulate indoor temperature, solar gain, and component heat loss over a daily climate profile.
- Select materials, wall and roof thicknesses, shelter geometry, openings, and orientation.
- Fetch an hourly climate sample from the NASA POWER API.
- Compare shelter variants and receive a ranked recommendation.
- Generate and screen parametric shelter candidates with geometry validation.
- Visualize results with charts and an interactive 3D shelter model.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | API information |
| GET | `/health` | Health check |
| GET | `/api/health/detailed` | Database, NASA, ANSYS, and job status |
| GET | `/api/db-status` | Database status |
| GET | `/api/history` | Simulation history |
| GET | `/api/materials` | List materials |
| GET | `/api/materials/{material_id}` | Get a material |
| GET | `/api/climate-profiles` | List climate profiles |
| GET | `/api/climate-profiles/{profile_id}` | Get a climate profile |
| GET | `/api/climate/live` | Fetch NASA POWER climate |
| POST | `/api/simulate` | Submit a simulation |
| GET | `/api/results/{job_id}` | Get simulation result |
| POST | `/api/compare` | Submit a design comparison |
| GET | `/api/compare/{job_id}` | Get comparison result |
| POST | `/api/optimize` | Optimize a shelter configuration |
| POST | `/api/pipeline/generate-and-screen` | Generate and rank candidates |
| GET | `/api/pipeline/materials` | List pipeline materials |
| POST | `/api/pipeline/validate-geometry` | Validate candidate geometry |

## Team

Team THERMA-LADAKH | SIH 2026
