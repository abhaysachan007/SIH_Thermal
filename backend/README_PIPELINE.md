# Candidate Shelter Generator → Physics Screening → Top-10 ANSYS Pipeline

This module implements a production-grade, modular, parametric thermal shelter design pipeline for high-altitude cold desert regions (Ladakh at 3500m).

---

## 1. Overall Pipeline Architecture

```mermaid
flowchart TD
    A[User Input Constraints] --> B[Input Validation & Normalization]
    B --> C[Design Space Exploration]
    C --> D[Parametric Candidate Generator (1000-5000 candidates)]
    D --> E[Hard Constraint & AABB Opening Collision Filter]
    E -->|Reject| F[Explainability & Rejection Log]
    E -->|Valid| G[Fast Physics-Based Pre-Screening Engine]
    G --> H[Transient Indoor Capacitance Solver & Solar Ray-Tracing]
    H --> I[Explainable Multi-Objective Ranking Engine]
    I --> J[Diverse Top-10 Selector]
    J --> K[ANSYS Model Contract & APDL Generator]
    K --> L[ANSYS MAPDL / Transparent Mock Execution]
    L --> M[Structured Output JSON & Audit Telemetry]
```

---

## 2. Core Modules

| Module Path | Role & Description |
| :--- | :--- |
| `app.pipeline.models` | Strictly typed Pydantic models for Parametric Geometry, Layered Wall Systems, Fenestrations, Thermal Metrics, and ANSYS Payloads. |
| `app.pipeline.material_repo` | Centralized repository of SI-unit material properties ($k$, $ho$, $c_p$, $lpha$, SHGC) and multi-layer thermal resistance calculators. |
| `app.pipeline.climate_repo` | Time-series climate ingestion with solar astronomical positioning (altitude $lpha$, azimuth $\gamma$, surface incidence angle $	heta$). |
| `app.pipeline.geometry_validator` | Strict geometric validation & 2D AABB collision detection preventing window-door overlaps, corner breaches, or excessive WWR. |
| `app.pipeline.candidate_generator` | Controlled parametric generation exploring multidimensional design spaces without combinatorial explosion. |
| `app.pipeline.thermal_screening` | 1D multi-layer conduction, solar transmission vs aperture loss trade-off, and dynamic lumped thermal-mass capacitance solver ($C_{\text{eff}} \frac{dT}{dt} = Q_{\text{net}}$). |
| `app.pipeline.ranking_engine` | Multi-objective scoring (Thermal Comfort, Auxiliary Energy Demand, Material Cost) with human-readable rationale. |
| `app.pipeline.diversity_selector` | Selects a diverse Top 10 representing varied wall construction systems, roof geometries, and window strategies without picking non-viable designs. |
| `app.pipeline.ansys_adapter` | Dedicated ANSYS Model Specification JSON contract generator and native APDL batch builder supporting real MAPDL execution or transparent MOCK mode. |
| `app.pipeline.pipeline_orchestrator` | End-to-end orchestration uniting all pipeline stages into a single callable service. |

---

## 3. Physics & Heat Transfer Formulations

### 1. Multi-Layer Wall & Roof Conduction
$$R_{\text{wall}} = R_{si} + \sum_{i=1}^{N} \frac{L_i}{k_i} + R_{se}$$
$$Q_{\text{cond,wall}} = \frac{A_{\text{opaque}}}{R_{\text{wall}}} \cdot (T_{\text{inside}} - T_{\text{ambient}})$$

### 2. Window Conduction vs Solar Aperture Trade-off
$$Q_{\text{win,loss}} = \sum A_{\text{win},j} \cdot U_{\text{win},j} \cdot (T_{\text{inside}} - T_{\text{ambient}})$$
$$Q_{\text{solar,win}} = \sum A_{\text{win},j} \cdot \text{SHGC}_j \cdot I_{\text{solar}} \cdot f_{\text{orient},j}$$

### 3. Infiltration Heat Loss
$$Q_{\text{inf}} = \frac{\text{ACH} \cdot V_{\text{internal}} \cdot \rho_{\text{air}} \cdot c_{p,\text{air}}}{3600} \cdot (T_{\text{inside}} - T_{\text{ambient}})$$

### 4. Dynamic Lumped Thermal Mass Capacitance
$$C_{\text{eff}} \cdot \frac{dT_{\text{inside}}}{dt} = Q_{\text{solar}} + Q_{\text{internal}} - Q_{\text{loss}}$$
$$T_{\text{inside}}(t + \Delta t) = T_{\text{inside}}(t) + \frac{Q_{\text{net}} \cdot \Delta t}{C_{\text{eff}}}$$

---

## 4. REST API Usage

### Endpoint: `POST /api/pipeline/generate-and-screen`
```json
{
  "length_m": 8.0,
  "width_m": 5.0,
  "height_m": 3.0,
  "required_occupancy": 4,
  "climate_profile_id": "ladakh_winter",
  "min_ambient_temp_c": -20.0,
  "max_ambient_temp_c": 3.5,
  "peak_solar_radiation_w_m2": 940.0,
  "comfort_weight": 0.50,
  "energy_weight": 0.30,
  "cost_weight": 0.20,
  "run_ansys_detailed": true,
  "ansys_mode": "auto"
}
```

### Response:
```json
{
  "request_id": "REQ_53d0a713",
  "total_candidates_generated": 1320,
  "valid_candidates": 1320,
  "screened_candidates": 1320,
  "top_10_candidates": [
    {
      "rank": 1,
      "candidate_id": "SHELTER_31b4bbc5",
      "design": { ... },
      "screening_results": {
        "min_indoor_temperature_c": -8.6,
        "max_indoor_temperature_c": -6.6,
        "average_indoor_temperature_c": -7.5,
        "comfort_hours": 0.0,
        "total_heat_loss_kwh": 38.2,
        "solar_gain_kwh": 8.4,
        "estimated_energy_requirement_kwh": 5.6
      },
      "score": 47.71,
      "diversity_category": "Mud Brick Composite + Flat Roof",
      "ansys_status": "mock_completed",
      "ansys_payload": { ... }
    }
  ]
}
```

---

## 5. Running Automated Unit Tests
```bash
python -m pytest backend/tests/test_shelter_pipeline.py -v
```
All 15 test suites verify material resistances, multi-layer assemblies, opening collision detection, geometric constraints, ranking explainability, diversity selection, and ANSYS payload contracts.
