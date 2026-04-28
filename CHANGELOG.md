# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.1] - 2026-04-28

### Added

- **Work Order Dashboard UI** (GST-10): React 19 operator dashboard with Work Order table, OEE panel, real-time telemetry feed, and Create Work Order dialog. Served via nginx container on port 8080.
- **OEE engine wired to live MQTT telemetry** (GST-26): End-to-end data flow from MQTT subscriber through OEE calculation engine to TimescaleDB hypertable. OEE metrics visible in real-time on the dashboard.
- **SAPAdapter for SAP S/4HANA OData v4** (GST-27): Concrete `IERPAdapter` implementation for SAP S/4HANA. Activated via `ERP_ADAPTER=sap` env var. Includes POST 500 no-retry logic and route security tests.
- **Discrete manufacturing seed data** (GST-29): Realistic seed dataset for discrete manufacturing scenarios including CNC machine fixtures, work orders, and production schedules.
- **Scada-LTS integration** (GST-46): Full Scada-LTS SCADA server added to local dev stack. Includes `scadalts-collector` service (polls Scada-LTS REST API, publishes telemetry to EMQX), seed configuration, and populate script.
- **`packages/db`**: New `@mes/db` package with Drizzle ORM schema definitions for all entities (`work_orders`, `production_schedules`, `resource_assignments`, `machine_telemetry`).

### Fixed

- **aedes 1.0.2 ESM migration** (GST-44): Updated integration test to use ESM named import `import { Aedes } from "aedes"` with `Aedes.createBroker()` async factory and properly-awaited `broker.close()` teardown.
- **CI: Docker image name casing** (GST-43): Lowercased GHCR image name to fix Docker build failures on `docker-build` workflow.
- **CI: E2E BASE_URL port and pre-build step** (GST-23): Corrected Playwright E2E base URL port and added required pre-build step to CI pipeline.
- **OPC-UA synthetic telemetry** (GST-23): Added `machine-reactor-001` OEE telemetry to synthetic mode so E2E tests pass without a real OPC-UA server.
- **MySQL 8.4 binary logging** (GST-46): Added `--log-bin-trust-function-creators=1` to MySQL 8.4 dev compose for Scada-LTS stored function compatibility.

### Changed

- **Dependency upgrades** (GST-44): All packages and apps upgraded to latest compatible versions — TypeScript 6.0.3, drizzle-orm 0.45, @fastify/jwt 10, pino 10, recharts 3, vite 8, vitest 3.2, aedes 1.0.2.

---

## [0.1.0] — 2026-04-23

### Added

- **Monorepo scaffold** (GST-7): Turborepo + pnpm workspaces with `apps/api`, `apps/web`, `apps/opcua-collector`, `apps/scadalts-collector`, `packages/types`, `packages/domain`, `packages/test-fixtures`
- **CI/CD pipeline** (GST-13): GitHub Actions workflows for CI (lint, typecheck, test, build on every PR) and staging deploy (Docker image build + push to GHCR on merge to main)
- **Local dev stack** (GST-13): Docker Compose with PostgreSQL 16 + TimescaleDB, EMQX 5 MQTT broker, MES API, React frontend (nginx), OPC-UA collector (synthetic mode), Scada-LTS collector
- **Environment variable management**: `.env.example` files per app; root `.env.local.template` for full-stack local dev
- **Dockerfiles**: Multi-stage builds for `api`, `web`, `opcua-collector`, `scadalts-collector`

[0.1.1]: https://github.com/johnlyng/PaperClip-MES/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/gstack/mes/releases/tag/v0.1.0
