# MES — Manufacturing Execution System

Monorepo scaffold per [ADR-001](./mes-adr.md) · Turborepo + pnpm workspaces

## Quick Start

**Prerequisites:** Node.js 22 LTS, pnpm 9, Docker Desktop

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template
cp .env.local.template .env.local

# 3a. Start the core stack (CI-safe, fast startup)
docker compose -f infra/compose/docker-compose.yml up -d

# 3b. Start the full stack including Scada-LTS (local dev only)
docker compose -f infra/compose/docker-compose.yml --profile scadalts up -d

# 4. Run all services in dev mode (hot-reload, outside Docker)
pnpm turbo dev
```

**Core stack** (started by `docker compose up -d`):
| Service | URL |
|---|---|
| API (Fastify) | http://localhost:3000 |
| OpenAPI docs | http://localhost:3000/docs |
| Web dashboard (nginx) | http://localhost:8080 |
| EMQX dashboard | http://localhost:18083 (admin/public) |
| PostgreSQL | localhost:5432 (mes/mes/mes_dev) |

**Full stack** (requires `--profile scadalts` — omitted from CI due to 3-minute Tomcat startup):
| Service | URL |
|---|---|
| Scada-LTS UI | http://localhost:8888 (admin/admin) |
| Scada-LTS collector health | http://localhost:9090/health |

## Workspace Layout

```
/
├── apps/
│   ├── api/                  # Fastify v5 + TypeScript backend
│   ├── web/                  # React 19 + Vite operator dashboard
│   ├── opcua-collector/      # OPC-UA → MQTT bridge service
│   └── scadalts-collector/   # Scada-LTS REST API poller → MQTT bridge
├── packages/
│   ├── types/                # @mes/types — shared TypeScript interfaces
│   ├── db/                   # @mes/db — Drizzle ORM schema definitions
│   ├── domain/               # @mes/domain — business logic, state machines, IERPAdapter
│   └── test-fixtures/        # @mes/test-fixtures — mock adapters, seeded data
├── infra/
│   ├── docker/               # Dockerfiles (api, web, opcua-collector, scadalts-collector)
│   └── compose/              # docker-compose.yml + TimescaleDB init scripts + Scada-LTS config
├── .github/
│   └── workflows/            # GitHub Actions CI (ci.yml) and staging deploy (deploy-staging.yml)
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Key Design Decisions (ADR-001)

| Area | Decision |
|---|---|
| Backend | Node.js 22 + Fastify v5 + TypeScript |
| Frontend | React 19 + Vite + shadcn/ui + Recharts |
| Database | PostgreSQL 16 + TimescaleDB |
| Broker | EMQX 5 (MQTT) |
| ERP | Adapter Pattern — `MockERPAdapter` default; `SAPAdapter` (SAP S/4HANA OData v4) available |
| SCADA | Scada-LTS REST poller (`scadalts-collector`) + OPC-UA monitored items (`opcua-collector`) |
| Monorepo | Turborepo + pnpm |

## ERP Integration

The `IERPAdapter` interface in `packages/domain/src/erp/IERPAdapter.ts` is the ERP contract.

Two adapters ship:
- `MockERPAdapter` — returns seeded fixture data (default: `ERP_ADAPTER=mock`)
- `SAPAdapter` — SAP S/4HANA OData v4 integration (`ERP_ADAPTER=sap`; requires `SAP_BASE_URL`, `SAP_CLIENT`, `SAP_USERNAME`, `SAP_PASSWORD`)

Set `ERP_ADAPTER` in `.env.local` to switch adapters without code changes.

## SCADA Integration

Two collector services bridge plant-floor data to EMQX:

| Collector | Mechanism | When to use |
|---|---|---|
| `opcua-collector` | OPC-UA monitored-item subscriptions (node-opcua) | Direct OPC-UA server access |
| `scadalts-collector` | Polls Scada-LTS REST API; publishes to `mes/{machineId}/telemetry` | Scada-LTS SCADA server |

Both publish to the same MQTT topic structure. Configure `OPCUA_ENDPOINTS` or `SCADALTS_BASE_URL` in `.env.local`.

## Useful Commands

```bash
pnpm turbo build          # Build all packages and apps
pnpm turbo test           # Run all unit tests
pnpm turbo typecheck      # TypeScript type-check all packages
pnpm turbo e2e            # Run Playwright E2E tests
docker compose -f infra/compose/docker-compose.yml up -d                        # Start core stack
docker compose -f infra/compose/docker-compose.yml --profile scadalts up -d     # Start full stack (incl. Scada-LTS)
docker compose -f infra/compose/docker-compose.yml down                          # Stop stack
docker compose -f infra/compose/docker-compose.yml logs -f                       # Tail all container logs
```

## Environment Variables

Copy `.env.local.template` to `.env.local`. Key variables:

```env
# Database
DATABASE_URL=postgresql://mes:mes@localhost:5432/mes_dev

# MQTT broker
MQTT_URL=mqtt://localhost:1883

# Scada-LTS collector
SCADALTS_BASE_URL=http://localhost:8080
SCADALTS_PASSWORD=admin

# Auth
JWT_SECRET=dev-only-secret-change-me-in-production

# ERP adapter: mock | sap
ERP_ADAPTER=mock

# Frontend (Vite dev server)
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```
