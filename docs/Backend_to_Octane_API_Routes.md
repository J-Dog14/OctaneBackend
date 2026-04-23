# Biomech Reports Pipeline — Architecture Reference

## Overview

Data flows one-way from **OctaneBiomechBackend** (staff tool) → **Octane** (athlete-facing app).
The trigger is a "Send to App" button on the UIAS Maintenance page. Pre-computed percentiles
travel with the payload — Octane stores and displays them but never recomputes them.

---

## 1. Full Data Flow (Ingest Path)

```mermaid
flowchart TD
  A["Staff clicks 'Send to App'\nUIAS Maintenance Page\nOctaneBiomechBackend"] 
  --> B["handleSendToApp()\nPOST /api/dashboard/send-to-octane\nAuth: requireRole('admin')"]

  B --> C["lookupOctaneUserByEmail(athlete.email)\nGET /api/external/users/by-email\nAuth: Bearer OCTANE_API_KEY"]
  C --> C2["Octane: /api/external/users/by-email\nReturns OctaneUser: uuid, name, email"]
  C2 --> C3["Cache uuid → d_athletes.app_db_uuid\nAvoids repeat lookups on future sends"]

  B --> D["buildAthleteTrackingReport(athleteUuid)\nBuilds all available domains\nPre-computes percentiles from 150-athlete population"]

  C3 --> E
  D --> E["POST /api/biomech/ingest\nOctane app\nAuth: Bearer BIOMECH_API_KEYS\nPayload: octaneUserUuid + athleteEmail + domains"]

  E --> F["requireReportsApiAuth(req)\nValidates REPORTS_API_KEY Bearer token"]
  F --> G["SAFEGUARD: prisma.user.findFirst\nMain Octane DB — verifies uuid AND email match\nPrevents data from landing on wrong account"]

  G -->|"User verified"| H["upsertBiomechReport()\n@octane/reports service layer\nbiomechService.ts"]
  G -->|"No match"| ERR["404 DataNotFoundError\nData not stored"]

  H --> I["reportsDb — Neon PostgreSQL\nPrismaPg adapter via REPORTS_DATABASE_URL"]
  I --> J["biomech_reports — 1 row per athlete"]
  I --> K["biomech_domains — 1 row per domain"]
  I --> L["biomech_metrics — N rows per domain"]
```

---

## 2. Data Retrieval (Athlete View)

```mermaid
flowchart TD
  A["Athlete visits /app/report\nOctane app"] 
  --> B["useBiomechReport() hook\nTanStack React Query"]
  B --> C["GET /api/biomech/report\nAuth: getUserFromSession()\nUses session cookie"]
  C --> D["getBiomechReportByUserId(user.userUuid)\n@octane/reports service"]
  D --> E["Neon Reports DB\nbiomech_reports + domains + metrics\nOrdered by createdAt asc"]
  E --> F["BiomechAthleteTracking component\nTabs: Highlights + one tab per domain"]
```

---

## 3. Data Retrieval (Coach/Admin View)

```mermaid
flowchart TD
  A["Coach visits /app/athlete-reports\nSelects athlete from dropdown"] 
  --> B["useAdminBiomechReport({ athleteUuid }) hook\nEnabled only when athleteUuid is set"]
  B --> C["GET /api/biomech/admin/[athleteUuid]\nAuth: getUserFromSession()\nPermission: requirePermission(user, 'Athlete_Reports')"]
  C --> D["getBiomechReportByUserId(athleteUuid)\n@octane/reports service"]
  D --> E["Neon Reports DB"]
  E --> F["BiomechAthleteTracking component\nisAdmin=true"]
```

---

## 4. Database Schema (Neon Reports DB)

```mermaid
erDiagram
  biomech_reports {
    uuid id PK
    uuid userId UK "Stores User.uuid from Octane main DB. One report per athlete — latest send wins."
    string athleteName
    datetime generatedAt "When OctaneBiomechBackend built the report"
    datetime createdAt
    datetime updatedAt
  }

  biomech_domains {
    uuid id PK
    uuid reportId FK
    string domainId "pitching | hitting | mobility | athleticScreen | armAction | proteus"
    string label "Human-readable: Pitching, Hitting, etc."
    string sessionDate "Optional: date of the assessment session"
    datetime createdAt
    datetime updatedAt
  }

  biomech_metrics {
    uuid id PK
    uuid domainId FK
    string category "e.g. TRACKMAN_METRICS, KINEMATIC_SEQUENCE, CMJ"
    string name "e.g. VELOCITY, PELVIS, Peak_Power"
    float value
    string valueUnit "MPH, DEGREES, WATTS, etc."
    string orientation "HIGHER_IS_BETTER | LOWER_IS_BETTER | null"
    float percentile "Pre-computed 0-100 from OctaneBiomechBackend population"
    string mobilityMetricKind "GROUP | COMPONENT | null — mobility only"
    string mobilityGroup "Mobility group label — mobility only"
    string mobilityDisplayLabel "Mobility display name — mobility only"
    float mobilityOutOf "Mobility max score — mobility only"
    datetime createdAt
    datetime updatedAt
  }

  biomech_reports ||--o{ biomech_domains : "has domains"
  biomech_domains ||--o{ biomech_metrics : "has metrics"
```

> **Why one generic metrics table?** The existing `Metric` table in the reports package uses
> fixed enums (12 pitching-specific categories). Biomech needs open-ended string categories
> that work for all 6 domains. Three new tables were added rather than modifying the existing
> schema to avoid breaking the existing athlete reports feature.

---

## 5. Infrastructure Map

```mermaid
flowchart LR
  subgraph OctaneBiomechBackend ["OctaneBiomechBackend (Staff Tool)"]
    UIAS["UIAS Maintenance Page\napp/dashboard/uais-maintenance/"]
    SendRoute["POST /api/dashboard/send-to-octane\nClerck auth: requireRole('admin')"]
    BuildReport["buildAthleteTrackingReport()\nlib/athlete-tracking/report.ts"]
    LookupFn["lookupOctaneUserByEmail()\nlib/octane/octaneUserLookup.ts"]
    BackendDB[("OctaneBiomechBackend DB\nd_athletes, assessment tables")]
  end

  subgraph Octane ["Octane (Athlete-Facing App)"]
    ExtRoute["GET /api/external/users/by-email\nAuth: REPORTS_API_KEY"]
    IngestRoute["POST /api/biomech/ingest\nAuth: REPORTS_API_KEY"]
    ReportRoute["GET /api/biomech/report\nSession auth"]
    AdminRoute["GET /api/biomech/admin/[uuid]\nPermission: Athlete_Reports"]
    MainDB[("Main Octane DB\nUser table — for safeguard check only")]
    ServiceLayer["@octane/reports package\npackages/reports/src/services/biomechService.ts"]
    NeonDB[("Neon Reports DB\nbiomech_reports\nbiomech_domains\nbiomech_metrics")]
    UI["BiomechAthleteTracking component\nHighlights + domain tabs\nRadar charts + metric rows"]
  end

  UIAS --> SendRoute
  SendRoute --> LookupFn
  LookupFn -->|"OCTANE_API_KEY"| ExtRoute
  SendRoute --> BuildReport
  BuildReport --> BackendDB
  SendRoute -->|"BIOMECH_API_KEYS"| IngestRoute
  IngestRoute --> MainDB
  IngestRoute --> ServiceLayer
  ServiceLayer --> NeonDB
  ReportRoute --> ServiceLayer
  AdminRoute --> ServiceLayer
  NeonDB --> UI
```

---

## 6. Endpoints Reference

| App | Method | Endpoint | Auth | Purpose |
|-----|--------|----------|------|---------|
| OctaneBiomechBackend | POST | `/api/dashboard/send-to-octane` | Clerk `requireRole('admin')` | Builds report, resolves Octane UUID, POSTs to ingest |
| Octane | GET | `/api/external/users/by-email` | Bearer `REPORTS_API_KEY` | Resolves athlete email → Octane UUID |
| Octane | POST | `/api/biomech/ingest` | Bearer `REPORTS_API_KEY` | Receives payload, validates identity, upserts to Neon |
| Octane | GET | `/api/biomech/report` | Session cookie | Athlete fetches their own report |
| Octane | GET | `/api/biomech/admin/[athleteUuid]` | Session + `Athlete_Reports` permission | Coach fetches any athlete's report |

---

## 7. Environment Variables

| Variable | App | Value |
|----------|-----|-------|
| `OCTANE_APP_API_URL` | OctaneBiomechBackend | URL of the Octane app (e.g. `http://localhost:3000`) |
| `BIOMECH_API_KEYS` | OctaneBiomechBackend | Bearer key for the ingest endpoint — must match `REPORTS_API_KEY` in Octane |
| `OCTANE_API_KEY` | OctaneBiomechBackend | Bearer key for the user-lookup endpoint — must match `REPORTS_API_KEY` in Octane |
| `REPORTS_API_KEY` | Octane | Shared secret validating both OctaneBiomechBackend integrations |
| `REPORTS_DATABASE_URL` | Octane | Neon PostgreSQL connection string — used by `packages/reports/src/db.ts` |

---

## 8. Upsert Behavior (Re-sending Data)

Each "Send to App" replaces all metrics for every domain that is re-sent:

1. `BiomechReport` — upserted by `userId` (one row per athlete, updated in place)
2. `BiomechDomain` — upserted by `(reportId, domainId)` unique constraint
3. `BiomechMetric` — **deleted and recreated** on every send (no stale metrics accumulate)

This means sending Pitching data twice updates only Pitching metrics — Hitting metrics from a
previous send are untouched because their domain row is upserted separately.
