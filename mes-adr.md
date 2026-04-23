# ADR-001: MES Tech Stack and High-Level Architecture

**Status:** ACCEPTED (amended 2026-04-23) — CEO approved; Staff Engineer confirmed; Board added container + GitHub mandates  
**Date:** 2026-04-20  
**Due:** 2026-04-23 (Day 3)  
**Author:** CTO  
**Unblocks:** Data model (Work Orders schema), CI/CD setup, acceptance criteria authoring, Week 2 engineer onboarding

---

## Context

We are building a 30-day Manufacturing Execution System (MES) MVP. The system must:

- Manage Work Orders through a lifecycle state machine
- Ingest real-time machine telemetry and compute OEE metrics
- Integrate with an ERP system (target TBD by board)
- Connect to SCADA/PLC assets via OPC-UA
- Serve a real-time operator dashboard
- Run either cloud-hosted or on-prem (board input pending)

The decisions below are optimized for **team velocity**, **industrial compatibility**, and **operational simplicity** at MVP scale. Each section flags any dependency on pending board decisions.

---

## Decision 1 — Backend Language and Framework

**Decision: TypeScript (Node.js 22 LTS) + Fastify v5**

**Rationale:**

- Fastify is the fastest mainstream Node.js framework (~85k req/s), with a plugin architecture that avoids monolith sprawl.
- TypeScript across the full stack (frontend + backend) means shared type definitions for domain entities (WorkOrder, OEESnapshot, Schedule) — eliminates a whole class of contract bugs.
- The Node.js ecosystem has the best industrial integration libraries: `node-opcua` (OPC-UA), `mqtt.js` (MQTT), `kafkajs` (Kafka). No other runtime matches this breadth for MES use cases.
- Fastify's schema-based validation (JSON Schema / Ajv) naturally produces OpenAPI specs, which QA can use for contract testing immediately.

**Alternatives Rejected:**

- *Python/FastAPI*: Strong for data science tasks but slower for I/O concurrency; team would split context between two async models.
- *Go*: Excellent performance ceiling but smaller industrial library ecosystem; higher hiring friction.
- *Java/Spring Boot*: Well-proven in manufacturing but too heavyweight for a 30-day MVP; JVM startup and boilerplate cost too much velocity.

**Key packages:** `fastify`, `@fastify/swagger`, `@fastify/websocket`, `zod`, `drizzle-orm`, `node-opcua`, `mqtt`, `pino`

---

## Decision 2 — Frontend Framework

**Decision: React 19 + Vite + shadcn/ui + Recharts**

**Rationale:**

- React 19 with TypeScript is the safest hiring bet for Week 2 frontend engineers; largest talent pool.
- shadcn/ui provides unstyled, accessible components built on Radix UI — copy-owned, not npm-installed, which means zero dependency drift risk on operator-facing displays.
- Vite gives sub-second HMR, critical for real-time dashboard iteration.
- Recharts (OEE trend charts) and TanStack Table (Work Order grids) are the current industry standard pair.
- MES operators use large monitors or touch kiosks; shadcn provides the density controls and theming needed for both.

**Alternatives Rejected:**

- *Vue + Vuetify*: Viable but smaller talent pool; standardizing on TypeScript across the stack is a stronger choice.
- *Next.js (SSR)*: Overkill for an authenticated internal dashboard; SSR adds infrastructure complexity for no user-facing SEO benefit.

**Real-time strategy:** WebSocket connection to Fastify `/ws/telemetry` endpoint, client-managed reconnect with exponential backoff. Zustand for client state.

---

## Decision 3 — Primary Relational Database

**Decision: PostgreSQL 16**

**Rationale:**

- PostgreSQL serves as both the relational store (Work Orders, Resources, BOM, Personnel) and the foundation for the time-series store (see Decision 4).
- JSONB columns allow schema-flex on machine metadata and ERP payload envelopes without migration overhead during MVP.
- Row-level security (RLS) provides the multi-tenant access control needed when multiple production lines share one instance.
- Mature connection pooling via PgBouncer.

**Schema management:** Staff Engineer owns the baseline migration set via Drizzle Kit (`drizzle-kit push` for dev, `drizzle-kit generate` + migration files for prod).

---

## Decision 4 — Time-Series Database

**Decision: TimescaleDB (PostgreSQL extension) — co-located with primary DB**

**Rationale:**

- TimescaleDB runs inside PostgreSQL — single DB engine, single connection pool, single ops burden. For a 30-day MVP this is the only defensible choice.
- Hypertables with automatic time-partitioning on `machine_telemetry(ts, machine_id)` handle the write volume of OEE events (typically 1-10 Hz per machine).
- Continuous Aggregates produce pre-computed OEE rollups at 1-min, 1-hour, and 1-day granularities without application-layer aggregation.
- Migration path to standalone InfluxDB or QuestDB cluster is available if write throughput exceeds ~100k events/sec — not an MVP concern.

**Alternatives Rejected:**

- *InfluxDB v3*: Better raw ingest throughput but requires a separate service, separate credentials, and a different query language. Adds operational surface for MVP.
- *QuestDB*: Excellent performance but immature ecosystem and support risk.

**Key table:**

```sql
CREATE TABLE machine_telemetry (
  ts         TIMESTAMPTZ      NOT NULL,
  machine_id UUID             NOT NULL,
  metric     TEXT             NOT NULL,
  value      DOUBLE PRECISION,
  tags       JSONB
);
SELECT create_hypertable('machine_telemetry', 'ts');
```

---

## Decision 5 — Message Broker / Event Streaming

**Decision: MQTT (protocol) + EMQX 5 (broker)**

**Rationale:**

- MQTT is the de facto standard for industrial machine communication. Most PLCs, SCADA systems, and edge devices speak MQTT natively. Any other broker would require a translation layer.
- EMQX 5 is enterprise-grade with clustering, persistence, and a rule engine that can route messages to PostgreSQL/TimescaleDB directly without application code.
- QoS Level 1 ("at least once") for telemetry; QoS Level 2 ("exactly once") for work order state change events.
- EMQX's Rule Engine handles dead-letter queuing and fanout without needing a separate Kafka cluster at MVP scale.

**Topic structure:**

```
mes/{machineId}/telemetry      # per-machine sensor data (write: OPC-UA Collector)
mes/{machineId}/status         # machine operational state (write: OPC-UA Collector)
mes/workorders/{id}/events     # READ-ONLY fanout (write: MES API only — see [F2])
```

> **[F1] Hard constraint — EMQX Rule Engine: no direct database writes.**
> The EMQX Rule Engine must not be wired to write to PostgreSQL or TimescaleDB directly. Its permitted operations are: topic fanout, topic routing, and dead-letter queuing only. All persistent writes flow through the MES API. This constraint must be enforced in the Docker Compose EMQX config (rule chain) with a comment preventing future drift. Reason: direct Rule Engine writes bypass the domain layer (validation, state machine enforcement, audit trail) and create a second write path that ERP/dashboard integrations will silently depend on.

**Alternatives Rejected:**

- *Kafka*: Correct for high-throughput event sourcing at scale; wrong for MVP. Kafka's operational complexity would burn Week 1.
- *NATS JetStream*: Good cloud-native option but lacks native industrial protocol bridges.

**Upgrade path:** If write volume exceeds EMQX capacity, the EMQX-to-Kafka bridge enables migration without changing producer code.

---

## Decision 6 — ERP Integration Approach

**Decision: Adapter Pattern behind an IERPAdapter interface — ERP-agnostic from Day 1**

> **BOARD INPUT REQUIRED:** Target ERP system (SAP, Oracle, Epicor, etc.) is TBD. This decision defines the abstraction layer; the specific adapter ships once the board decides.

**Architecture:**

```
MES Core
  └── ERPService
        └── IERPAdapter (interface)
              ├── MockERPAdapter     (ships now — returns fixture data)
              ├── SAPAdapter         (stub — implements interface)
              └── EpicorAdapter      (stub)
```

**IERPAdapter contract (TypeScript):**

```typescript
interface IERPAdapter {
  getWorkOrdersByDate(from: Date, to: Date): Promise<WorkOrder[]>;
  pushProductionResult(result: ProductionResult): Promise<void>;
  getMaterialList(bomId: string): Promise<BOMItem[]>;
  healthCheck(): Promise<{ connected: boolean; latency: number }>;
}
```

**For MVP:** `MockERPAdapter` returns seeded fixture data so the team builds and tests against the interface immediately. When the board chooses a target ERP, the concrete adapter is a single file implementing the interface.

**API Gateway consideration:** If the ERP is cloud-hosted and the MES is on-prem (or vice versa), Kong or AWS API Gateway sits in front of the ERP adapter endpoint for auth, rate limiting, and audit logging.

---

## Decision 7 — SCADA Integration Approach

**Decision: OPC-UA monitored-item subscriptions with node-opcua, connection pooling, and supervised reconnect**

> **BOARD INPUT REQUIRED:** SCADA/PLC scope and specific OPC-UA server addresses are TBD. This decision defines the client architecture; configuration is parameterized.

**Architecture:**

```
OPCUACollector (Node.js service)
  ├── OPCUASession per server (pooled, max 5 sessions per endpoint)
  ├── MonitoredItem subscription list (configurable per machine profile)
  ├── Change-notification model (server pushes on value change)
  └── MQTT publisher → EMQX → TimescaleDB
```

**Key design choices:**

- **Monitored items vs. polling:** OPC-UA publish/subscribe model — the server notifies the client when values change. Lower bandwidth than fixed-interval polling; no missed transitions.
- **Connection pooling:** `node-opcua`'s `OPCUAClient` is reused per endpoint. Sessions established once at startup with keepalive pings.
- **Reconnect:** Supervised exponential backoff (1s to 2s to 4s to max 60s). Connectivity loss is surfaced as a DISCONNECTED event on `mes/{machineId}/status` MQTT topic.
- **Security:** OPC-UA SignAndEncrypt with certificate-based authentication for production. None policy permitted for dev/lab only, gated by `OPCUA_SECURITY_POLICY` env var.

**Node IDs are configuration, not code.** Machine profiles define the NodeId-to-metric mapping in YAML config, allowing non-engineers to add new machines without deployments.

---

## Decision 8 — Deployment Target

**Decision: Every component runs in a Docker container. Cloud vs. on-prem target TBD by board.**

> **Board mandate (2026-04-23):** All components must run in containers. Bare-metal or native-process deployment is not permitted. This applies to every service: application code, databases, broker, collectors, proxy, and observability stack.
>
> **BOARD INPUT REQUIRED:** Cloud (AWS) vs. on-prem is still TBD. Both paths below use identical container images — the only difference is the orchestrator and network topology.

### Complete Container Inventory

Every process in the system has a corresponding Docker image:

| Component | Image | Notes |
|-----------|-------|-------|
| MES API | `mes/api` (Node.js 22 Alpine) | Fastify backend |
| Web frontend | `mes/web` (Nginx serving Vite build) | Static build served by Nginx container |
| OPC-UA Collector | `mes/opcua-collector` (Node.js 22 Alpine) | YAML-configured, no code change for new machines |
| PostgreSQL + TimescaleDB | `timescale/timescaledb:latest-pg16` | Official TimescaleDB image |
| EMQX broker | `emqx/emqx:5` | Official EMQX image |
| Nginx reverse proxy | `nginx:alpine` | TLS termination, routes `/api` and `/` |
| Grafana | `grafana/grafana` | Observability dashboards |
| Prometheus | `prom/prometheus` | Metrics scraping |

All images are pinned to specific digests in production. `latest` tags are forbidden in any environment beyond initial local dev.

### Local Dev (Docker Compose)

`docker-compose.yml` in `infra/compose/` brings up the full stack. Application services (`api`, `web`, `opcua-collector`) run as containers with source-mounted volumes for hot reload during development.

```yaml
# infra/compose/docker-compose.yml (abbreviated)
services:
  db:
    image: timescale/timescaledb:latest-pg16
    ports: ["5432:5432"]
  emqx:
    image: emqx/emqx:5
    ports: ["1883:1883", "18083:18083"]
  api:
    build: { context: ../../apps/api, dockerfile: ../../infra/docker/api.Dockerfile }
    volumes: ["../../apps/api/src:/app/src"]   # hot reload
    depends_on: [db, emqx]
  web:
    build: { context: ../../apps/web, dockerfile: ../../infra/docker/web.Dockerfile }
  opcua-collector:
    build: { context: ../../apps/opcua-collector }
    volumes: ["./config/machines.yml:/app/config/machines.yml"]
  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    depends_on: [api, web]
```

### Cloud Path (AWS — when board selects cloud)

| Component | AWS Service |
|-----------|-------------|
| Application containers | ECS Fargate (runs the Docker images above) |
| PostgreSQL + TimescaleDB | Self-managed on ECS with EBS, or RDS PostgreSQL 16 with TimescaleDB extension |
| EMQX broker | ECS Fargate (stateful service, EFS for EMQX data persistence) |
| OPC-UA Collector | ECS Fargate task in VPC with Site-to-Site VPN to plant floor |
| Frontend (Nginx) | ECS Fargate or CloudFront + S3 for static assets |
| Secrets | AWS Secrets Manager |
| Observability | CloudWatch + OpenTelemetry Collector sidecar |
| Plant-to-Cloud connectivity | AWS Site-to-Site VPN or Direct Connect |

### On-Prem Path (when board selects on-prem)

| Component | Service |
|-----------|---------|
| Orchestration | Docker Compose (MVP) → k3s / Kubernetes (production) |
| All containers | Same images as above; orchestrated by k3s |
| Reverse proxy | Nginx container with TLS termination |
| Observability | Grafana + Prometheus containers |

**Identical container images across all environments.** The only differences between dev, cloud, and on-prem are orchestration tooling, environment variable values, and persistent volume backing.

---

## Decision 9 — Monorepo vs. Multi-Repo

**Decision: Monorepo with Turborepo + pnpm workspaces, hosted on GitHub**

> **Board mandate (2026-04-23):** The entire project must be in a GitHub repository.

**Repository host:** GitHub — `git@github.com:johnlyng/PaperClip-MES.git` (HTTPS: `https://github.com/johnlyng/PaperClip-MES`). GitHub Actions is the CI/CD platform. Release Engineer owns the initial workflow configuration.

**Rationale:**

- A single repo means a single `git clone` for Week 2 engineers joining cold. No multi-repo coordination on day one.
- Turborepo's task pipeline handles incremental builds: only rebuild packages affected by a change.
- Shared packages (`@mes/types`, `@mes/domain`, `@mes/test-fixtures`) are imported directly — no npm publish overhead during MVP. Breaking changes to domain types fail the full monorepo build, catching contract issues at CI time.
- pnpm workspaces: fastest installs, strict dependency hoisting, disk-efficient.
- GitHub Actions integrates natively with the repo for CI, container image builds (GHCR or ECR), and deployment triggers.

**Workspace layout:**

```
/
├── apps/
│   ├── api/                 # Fastify backend
│   ├── web/                 # React frontend
│   └── opcua-collector/     # OPC-UA to MQTT bridge service
├── packages/
│   ├── types/               # Shared TypeScript interfaces
│   ├── domain/              # Business logic, state machines (no I/O)
│   └── test-fixtures/       # Seeded test data, mock adapters
├── infra/
│   ├── docker/              # Dockerfiles per app
│   └── compose/             # docker-compose.yml for local dev
├── .github/
│   └── workflows/           # GitHub Actions CI/CD pipelines
├── turbo.json
└── pnpm-workspace.yaml
```

**GitHub Actions pipeline (initial scope for Release Engineer):**

- `ci.yml` — on every PR: typecheck, lint, unit tests, Turborepo build
- `docker-build.yml` — on merge to `main`: build and push all container images to GHCR (or ECR when cloud target is decided)
- `deploy.yml` — triggered manually or on tag: deploy to target environment

**Branch strategy:** `main` is protected (require PR + passing CI). Feature branches off `main`. No long-lived environment branches.

**Alternatives Rejected:**

- *Nx*: More powerful than Turborepo but significantly more configuration overhead for MVP.
- *Multi-repo*: Correct at scale; wrong for a team still establishing shared types and domain models.

---

## Decision 10 — API Design Standard

**Decision: REST + WebSockets, URL versioning at /api/v1/**

**Rationale:**

- REST maps cleanly to MES resources (Work Orders, Machines, Schedules, Personnel) and integrates trivially with ERP/SCADA adapters that expect HTTP callbacks.
- WebSockets (via `@fastify/websocket`) serve the real-time telemetry feed — the only use case where REST polling would be inappropriate.
- GraphQL adds schema definition, resolver infrastructure, and N+1 query risk for no MVP benefit.
- URL-based versioning (/v1/, /v2/) is less elegant than header-based but far easier to test, log, proxy, and document.

**URL conventions:**

```
GET    /api/v1/work-orders
GET    /api/v1/work-orders/:id
POST   /api/v1/work-orders
PATCH  /api/v1/work-orders/:id
DELETE /api/v1/work-orders/:id
GET    /api/v1/machines/:id/oee?from=&to=&granularity=1h
WS     /api/v1/ws/telemetry?machineIds=[]
```

**Auth:** JWT (RS256) issued on login, verified via `@fastify/jwt`. Role claims: `operator`, `supervisor`, `engineer`, `admin`. Row-level security in PostgreSQL enforces the same role model at the DB layer.

**OpenAPI spec:** Auto-generated from Fastify schemas via `@fastify/swagger`. QA uses the spec as the contract for acceptance testing from Day 1.

> **[F2] Hard constraint — Work order lifecycle is REST-canonical; MQTT is read-only fanout.**
> Work order state transitions (create, start, pause, complete, cancel) are committed by the REST API to PostgreSQL first. Only after the commit does the MES API publish the already-committed state change to `mes/workorders/{id}/events` as a derived, read-only notification. Nothing may write to `mes/workorders/{id}/events` directly via MQTT — not the frontend, not external systems, not EMQX rule chains. This is not a detail to revisit: removing the canonical write path after ERP or dashboard integrations are built against the wrong assumption requires a breaking change to both the API contract and the topic semantics. Enforce from day one.

---

## High-Level Architecture Diagram

```
                    PLANT FLOOR
          ┌─────────────────────────┐
          │  PLCs / Machines        │
          │  SCADA (OPC-UA Server)  │
          └───────────┬─────────────┘
                      │ OPC-UA (monitored items)
          ┌───────────▼─────────────┐
          │  OPC-UA Collector       │
          │  (node-opcua, Node.js)  │
          └───────────┬─────────────┘
                      │ MQTT publish
          ┌───────────▼─────────────┐
          │  EMQX 5 Broker          │
          │  (MQTT / WebSocket)     │
          └───────────┬─────────────┘
                      │ Subscriptions
          ┌───────────▼─────────────────────────┐
          │         MES API (Fastify v5)         │
          │                                      │
          │  REST /api/v1/*                      │
          │  WebSocket /api/v1/ws/telemetry      │
          │                                      │
          │  WorkOrderService  OEEService        │
          │  ScheduleService   MachineService    │
          │                                      │
          │  IERPAdapter (MockERP → real ERP)   │
          │                                      │
          │  PostgreSQL 16                       │
          │  TimescaleDB (machine_telemetry)     │
          └───────────┬──────────────────────────┘
                      │ HTTP / WebSocket
          ┌───────────▼─────────────┐
          │  React 19 + shadcn/ui   │
          │  (Operator Dashboard)   │
          └─────────────────────────┘

                      │ IERPAdapter
          ┌───────────▼─────────────┐
          │  ERP System (TBD)       │
          │  SAP / Oracle / Epicor  │
          └─────────────────────────┘
```

---

## Pending Board Decisions

| Decision | Impact | Who Decides | Fallback Until Decided |
|----------|--------|-------------|------------------------|
| Cloud vs. on-prem | Container orchestration, network topology | Board | Local Docker Compose; both paths documented |
| ERP target system | Which concrete IERPAdapter to implement | Board | MockERPAdapter ships first; concrete adapter in Week 2 |
| SCADA/PLC scope | Number of OPC-UA endpoints, NodeId config | Board | node-opcua collector is parameterized; zero code change needed |

None of these block Week 1 work. Engineers build against mock adapters and local Docker Compose while the board decides.

---

## Local Dev Environment — Day 1 Setup (All Engineers)

**Prerequisites:** Node.js 22 LTS, pnpm 9, Docker Desktop, VS Code

```bash
git clone git@github.com:johnlyng/PaperClip-MES.git
cd mes
pnpm install
docker compose -f infra/compose/docker-compose.yml up -d
# starts all containers: PostgreSQL+TimescaleDB, EMQX, Nginx, Grafana, Prometheus
pnpm turbo dev
# starts app containers in watch mode: api (port 3000), web (port 5173), opcua-collector
```

**.env.local template:**

```env
DATABASE_URL=postgresql://mes:mes@localhost:5432/mes_dev
MQTT_URL=mqtt://localhost:1883
OPCUA_ENDPOINTS=[]
JWT_SECRET=dev-only-secret
OPCUA_SECURITY_POLICY=None
```

All services run in Docker containers locally. There is no "run outside Docker" mode for infrastructure components. This setup is deterministic and identical across macOS, Windows (WSL2), and Linux.

---

## Summary Table

| Area | Decision | Key Rationale |
|------|----------|---------------|
| Backend | Node.js 22 + Fastify v5 + TypeScript | Best industrial libraries, shared types with frontend, I/O performance |
| Frontend | React 19 + Vite + shadcn/ui | Largest talent pool, operator dashboard fit, shared TypeScript |
| Relational DB | PostgreSQL 16 | Reliability, JSONB flexibility, RLS for access control |
| Time-series DB | TimescaleDB (PG extension) | Zero extra ops burden, continuous aggregates for OEE |
| Message broker | EMQX 5 (MQTT) | Industry-standard IoT protocol, native PLC/SCADA compatibility |
| ERP integration | Adapter Pattern + IERPAdapter interface | Board has not chosen ERP; abstracts vendor from day one |
| SCADA integration | node-opcua + OPC-UA monitored items | Server-side change notifications, pooled sessions, YAML config |
| Deployment | All components in Docker containers; AWS Fargate or k3s TBD | Board mandate: containers everywhere; cloud vs. on-prem still pending |
| Repo structure | Monorepo (Turborepo + pnpm) hosted on GitHub | Board mandate: GitHub; GitHub Actions for CI/CD |
| API standard | REST + WebSocket, URL versioning /v1/ | Simplicity, OpenAPI contract, WebSocket for live telemetry |
