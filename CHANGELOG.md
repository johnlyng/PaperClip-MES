# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.1.0] — 2026-04-23

### Added

- **Monorepo scaffold** (GST-7): Turborepo + pnpm workspaces with `apps/api`, `apps/web`, `apps/opcua-collector`, `apps/scadalts-collector`, `packages/types`, `packages/domain`, `packages/test-fixtures`
- **CI/CD pipeline** (GST-13): GitHub Actions workflows for CI (lint, typecheck, test, build on every PR) and staging deploy (Docker image build + push to GHCR on merge to main)
- **Local dev stack** (GST-13): Docker Compose with PostgreSQL 16 + TimescaleDB, EMQX 5 MQTT broker, MES API, React frontend (nginx), OPC-UA collector (synthetic mode), Scada-LTS collector
- **Environment variable management**: `.env.example` files per app; root `.env.local.template` for full-stack local dev
- **Dockerfiles**: Multi-stage builds for `api`, `web`, `opcua-collector`, `scadalts-collector`

[0.1.0]: https://github.com/gstack/mes/releases/tag/v0.1.0
