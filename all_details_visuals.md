# SIH Thermal - Visual Project Guide

## 1. Project Overview

```mermaid
mindmap
  root((THERMA-LADAKH))
    Purpose
      Passive shelter thermal design
      Ladakh cold desert
      SIH26051
    Core Outputs
      Indoor temperature
      Solar thermal energy
      Heat flow
    Engines
      Python FDM
      Lumped thermal capacitance
      ANSYS MAPDL
      SOLID70
    Features
      Material comparison
      Candidate optimization
      3D shelter viewer
      NASA POWER climate
      Cost estimation
    Current Status
      15 backend tests pass
      Frontend build passes
      Advanced prototype
      Native ANSYS unverified
      Production hardening required
```

## 2. Folder and Component Architecture

```mermaid
flowchart TD
  A[SIH_Thermal root] --> B[backend]
  A --> C[frontend]
  A --> D[simulation]
  A --> E[Documentation]
  A --> F[ANSYS scripts]

  B --> B1[app/main.py]
  B --> B2[routers]
  B --> B3[services]
  B --> B4[pipeline]
  B --> B5[db/database.py]
  B --> B6[tests]
  B --> B7[data]

  B2 --> B21[simulation.py]
  B2 --> B22[materials.py]
  B2 --> B23[pipeline_router.py]

  B3 --> B31[simulation_service.py]
  B3 --> B32[fallback_engine.py]
  B3 --> B33[ansys_engine.py]
  B3 --> B34[nasa_climate.py]
  B3 --> B35[optimizer.py]
  B3 --> B36[cost_estimator.py]

  B4 --> B41[pipeline_orchestrator.py]
  B4 --> B42[candidate_generator.py]
  B4 --> B43[geometry_validator.py]
  B4 --> B44[thermal_screening.py]
  B4 --> B45[ranking_engine.py]
  B4 --> B46[diversity_selector.py]
  B4 --> B47[ansys_adapter.py]

  C --> C1[src/main.jsx]
  C --> C2[src/App.jsx]
  C --> C3[pages]
  C --> C4[components]
  C --> C5[api/simulationApi.js]

  C3 --> C31[InputPage.jsx]
  C3 --> C32[ResultsPage.jsx]

  C4 --> C41[3D Viewer]
  C4 --> C42[Temperature Chart]
  C4 --> C43[Heat Flow Chart]
  C4 --> C44[Solar Gain Chart]
  C4 --> C45[Comparison Table]

  D --> D1[generated job directories]

  E --> E1[SIH26051 research]
  E --> E2[project report]
  E --> E3[RESOURCES]

  F --> F1[direct_build.apdl]
  F --> F2[OPEN_IN_ANSYS.bat]
```

## 3. Legacy Simulation Data Flow

```mermaid
flowchart LR
  U[User] --> I[InputPage.jsx]
  I -->|Shelter configuration| A[POST /api/simulate]
  A --> V[ShelterInput validation]
  V --> S[SimulationService]
  S --> C[Climate scaling]
  C --> F{Engine selection}

  F -->|auto or fdm| P[Python FDM solver]
  F -->|ansys| N[ANSYS MAPDL]

  P --> R[Processed results]
  N --> R

  R --> CO[Cost estimator]
  CO --> DB[(TiDB or MySQL)]
  R --> X[GET /api/results/job_id]
  X --> RP[ResultsPage]

  RP --> T[Temperature chart]
  RP --> H[Heat flow chart]
  RP --> G[Solar gain chart]
  RP --> V3[3D viewer]
  RP --> PDF[PDF export]
```

## 4. Candidate Pipeline Data Flow

```mermaid
flowchart TD
  REQ[UserDesignRequest] --> CL[Load climate time series]
  REQ --> CFG[DesignSpaceConfig]
  CFG --> GEN[generate_candidate_shelters]
  CL --> SCR
  GEN --> RAW[Raw candidates]

  RAW --> GV[Geometry validation]
  GV -->|valid| VALID[Valid candidates]
  GV -->|invalid| LOG[Rejection summary]

  VALID --> SCR[Thermal screening]
  SCR --> RK[score_candidate]
  RK --> SORT[Sort by composite score]
  SORT --> DIV[select_diverse_top_10]

  DIV --> TOP[Top 10 candidates]
  TOP --> PAY[Build ANSYS JSON contract]
  PAY --> APDL[Generate APDL script]
  APDL --> AM{ANSYS available}

  AM -->|yes and licensed| MAPDL[Native MAPDL execution]
  AM -->|no or mock mode| MOCK[Transparent mock execution]

  MAPDL --> OUT[PipelineOutput]
  MOCK --> OUT
  LOG --> OUT
```

## 5. Thermal Model Components

```mermaid
flowchart TD
  AMB[Ambient temperature] --> LOSS[Heat-loss calculation]
  SOL[Solar irradiance] --> FAC{Surface factor}
  OCC[Occupant heat] --> NET[Net indoor heat]
  FAC --> SG[South and facade gains]
  SG --> NET

  LOSS --> WALL[Wall conduction]
  LOSS --> ROOF[Roof conduction]
  LOSS --> FLOOR[Floor conduction]
  LOSS --> WIN[Window conduction]
  LOSS --> DOOR[Door conduction]
  LOSS --> INF[Infiltration]

  WALL --> SUM[Total heat loss]
  ROOF --> SUM
  FLOOR --> SUM
  WIN --> SUM
  DOOR --> SUM
  INF --> SUM

  SUM --> NET
  NET --> CAP[C_eff lumped thermal capacitance]
  CAP --> TEMP[Updated indoor temperature]
  TEMP -->|next hour| AMB

  TEMP --> STAT[Minimum, maximum, average]
  TEMP --> COMF[Comfort hours]
  TEMP --> AUX[Auxiliary heating requirement]
```

## 6. SIH26051 Required Build Pipeline

```mermaid
flowchart TD
  A[1. Climate data input] --> B[2. Horizontal to tilted solar conversion]
  B --> C[3. Material properties]
  C --> D[4. 3D shelter geometry]
  D --> E[5. ANSYS transient thermal solve]
  E --> F[6. Batch design comparison]
  F --> G[7. Required outputs]

  A1[NASA POWER T2M] --> A
  A2[ALLSKY SFC SW DWN] --> A
  A3[WS10M or WS2M] --> A
  A4[RH2M] --> A

  B1[Liu-Jordan model] --> B
  B2[Wall orientation] --> B
  B2[Surface tilt] --> B

  C1[k conductivity] --> C
  C2[rho density] --> C
  C3[Cp specific heat] --> C

  D1[PyMAPDL] --> D
  D2[APDL] --> D
  D3[SOLID70] --> D

  G --> G1[Indoor temperature]
  G --> G2[Solar thermal energy]
  G --> G3[Heat flow]
```

## 7. Implemented and Missing Feature Split

```mermaid
pie showData
    title Broad Implementation Status
    "Implemented core features" : 29
    "Partially implemented features" : 6
    "Missing or future features" : 10
```

## 8. Priority Risk Matrix

```mermaid
quadrantChart
  title Project Risk and Priority
  x-axis Low implementation effort --> High implementation effort
  y-axis Low project impact --> High project impact
  quadrant-1 Strategic Improvements
  quadrant-2 Immediate Priority
  quadrant-3 Low Priority
  quadrant-4 Later Hardening

  Rotate database secret: [0.20, 0.95]
  Restrict CORS: [0.15, 0.85]
  Add authentication: [0.45, 0.90]
  Durable job queue: [0.55, 0.88]
  Add pymysql dependency: [0.10, 0.80]
  Configurable API URL: [0.15, 0.72]
  NASA into pipeline: [0.45, 0.82]
  Liu Jordan surfaces: [0.55, 0.92]
  Real ANSYS extraction: [0.65, 0.95]
  Dome and A frame physics: [0.75, 0.80]
  Docker deployment: [0.60, 0.78]
  IoT digital twin: [0.90, 0.55]
  GIS terrain shading: [0.85, 0.65]
  Offline PWA: [0.70, 0.45]
  EnergyPlus cross validation: [0.85, 0.88]
```

## 9. Release Roadmap

```mermaid
gantt
  title Recommended Development Plan
  dateFormat YYYY-MM-DD
  axisFormat %b %d

  section Security
  Rotate TiDB credentials              :crit, sec1, 2026-11-28, 1d
  Restrict CORS and add authentication :crit, sec2, after sec1, 4d
  Environment secret configuration     :sec3, after sec1, 3d

  section Reliability
  Add pymysql and test dependencies    :rel1, 2026-11-28, 1d
  Configurable frontend API URL        :rel2, after rel1, 2d
  Durable Redis or database jobs       :crit, rel3, after sec2, 7d
  Docker Compose deployment            :rel4, after rel3, 5d

  section Physics
  NASA profiles in candidate pipeline  :phys1, 2026-12-01, 4d
  Liu Jordan surface irradiance        :crit, phys2, after phys1, 7d
  Dome and A frame geometry           :phys3, after phys1, 5d
  Measured benchmark validation        :crit, phys4, after phys2, 10d

  section ANSYS
  Real native result extraction        :crit, ans1, 2026-12-08, 7d
  Mock and native status separation    :ans2, after ans1, 3d
  Batch ANSYS worker orchestration     :ans3, after rel3, 7d

  section Validation
  API integration tests                :test1, 2026-12-10, 5d
  Frontend end to end tests            :test2, after test1, 5d
  CI build and test pipeline           :test3, after test2, 4d

  section Future Scope
  GIS terrain shading                  :future1, 2027-01-15, 10d
  IoT digital twin                     :future2, after future1, 12d
  Offline PWA                          :future3, 2027-02-01, 8d
```

## 10. API Map

```mermaid
flowchart LR
  C[Frontend] --> H[/health]
  C --> M1[/api/materials]
  C --> M2[/api/climate-profiles]
  C --> M3[/api/climate/live]

  C --> S1[POST /api/simulate]
  S1 --> S2[GET /api/results/job_id]

  C --> CP1[POST /api/compare]
  CP1 --> CP2[GET /api/compare/job_id]

  C --> O[POST /api/optimize]

  C --> P1[POST /api/pipeline/generate-and-screen]
  C --> P2[GET /api/pipeline/materials]
  C --> P3[POST /api/pipeline/validate-geometry]

  C --> DB1[/api/db-status]
  C --> DB2[/api/history]

  S1 --> SV[(SimulationService)]
  CP1 --> SV
  O --> SV
  P1 --> OR[Pipeline Orchestrator]

  SV --> SOL{FDM or ANSYS}
  OR --> CAN[Candidate Pipeline]

  SOL --> TD[(TiDB MySQL)]
  CAN --> JD[(ANSYS job directory)]
```

## 11. Solar Geometry Pipeline

```mermaid
flowchart TD
  H[NASA horizontal irradiance] --> D{Split components}
  D --> B[Beam component]
  D --> DF[Diffuse component]
  D --> GR[Ground-reflected component]

  POS[Time and location] --> SA[Solar altitude]
  POS --> AZ[Solar azimuth]

  SA --> ANG[Incidence angle]
  AZ --> ANG

  OR[Wall or roof orientation] --> ANG
  TILT[Wall or roof tilt] --> ANG

  ANG --> LJ[Liu-Jordan transposition]
  B --> LJ
  DF --> LJ
  GR --> LJ

  LJ --> SF[Surface irradiance]
  SF --> SOUTH[South wall]
  SF --> NORTH[North wall]
  SF --> EAST[East wall]
  SF --> WEST[West wall]
  SF --> ROOF[Rooftop]

  SOUTH --> FEA[ANSYS boundary loads]
  NORTH --> FEA
  EAST --> FEA
  WEST --> FEA
  ROOF --> FEA
```
