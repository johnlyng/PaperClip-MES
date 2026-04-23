# MES — Manufacturing Execution System

Monorepo scaffold per [ADR-001](./mes-adr.md) · Turborepo + pnpm workspaces

## Quick Start

**Prerequisites:** Node.js 22 LTS, pnpm 9, Docker Desktop

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure (PostgreSQL 16 + TimescaleDB, EMQX 5)
docker compose -f infra/compose/docker-compose.yml up -d

# 3. Copy env template
cp .env.local.template .env.local

# 4. Start all services in dev mode
pnpm turbo dev
```

Services after `pnpm turbo dev`:
| Service | URL |
|---|---|
| API (Fastify) | http://localhost:3000 |
| OpenAPI docs | http://localhost:3000/docs |
| Web dashboard | http://localhost:5173 |
| EMQX dashboard | http://localhost:18083 (admin/public) |
| PostgreSQL | localhost:5432 (mes/mes/mes_dev) |

## Workspace Layout

```
/
├── apps/
│   ├── api/              # Fastify v5 + TypeScript backend
│   ├── web/              # React 19 + Vite operator dashboard
│   └── opcua-collector/  # OPC-UA → MQTT bridge service
├── packages/
│   ├── types/            # @mes/types — shared TypeScript interfaces
│   ├── domain/           # @mes/domain — business logic, state machines, IERPAdapter
│   └── test-fixtures/    # @mes/test-fixtures — mock adapters, seeded data
├── infra/
│   ├── docker/           # Dockerfiles (api, web, opcua-collector)
│   └── compose/          # docker-compose.yml + TimescaleDB init scripts
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Key Design Decisions (ADR-001)

| Area | Decision |
|---|---|
| Backend | Node.js 22 + Fastify v5 + TypeScript |
| Frontend | React 19 + Vite + shadcn/ui (Phase 2) |
| Database | PostgreSQL 16 + TimescaleDB |
| Broker | EMQX 5 (MQTT) |
| ERP | Adapter Pattern — `MockERPAdapter` ships first |
| SCADA | node-opcua monitored items (Phase 2) |
| Monorepo | Turborepo + pnpm |

## ERP Integration

The `IERPAdapter` interface in `packages/domain/src/erp/IERPAdapter.ts` is the ERP contract.  
`MockERPAdapter` is active by default (`ERP_ADAPTER=mock` in `.env.local`).  
Once the board selects a target ERP, a single adapter file implements the interface.

## Useful Commands

```bash
pnpm turbo build          # Build all packages and apps
pnpm turbo test           # Run all tests
pnpm turbo typecheck      # TypeScript type-check all packages
pnpm docker:up            # Start infra containers
pnpm docker:down          # Stop infra containers
pnpm docker:logs          # Tail container logs
```
