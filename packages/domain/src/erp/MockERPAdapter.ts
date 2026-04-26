import type { WorkOrder, BOMItem, ProductionResult, ERPHealthStatus } from "@mes/types";
import type { IERPAdapter } from "./IERPAdapter.js";

/**
 * MockERPAdapter — In-memory ERP adapter for local development and testing.
 *
 * Returns deterministic fixture data so engineers can build and test MES
 * features without requiring a live ERP connection. Replace with a concrete
 * adapter (SAPAdapter, EpicorAdapter, etc.) once the board selects the target.
 *
 * To activate: set ERP_ADAPTER=mock in .env.local (this is the default).
 */
export class MockERPAdapter implements IERPAdapter {
  private pushedResults: ProductionResult[] = [];

  async getWorkOrdersByDate(from: Date, to: Date): Promise<WorkOrder[]> {
    const now = new Date();
    const fixtures: WorkOrder[] = [
      {
        id: "wo-mock-001",
        workOrderNumber: "WO-2026-001",
        title: "Produce Widget Alpha — Batch 1",
        productId: "prod-widget-alpha",
        quantity: 500,
        unit: "pcs",
        scheduledStart: from,
        scheduledEnd: to,
        priority: 1,
        status: "released",
        machineId: "machine-mock-001",
        bomId: "bom-widget-alpha-v1",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "wo-mock-002",
        workOrderNumber: "WO-2026-002",
        title: "Produce Widget Beta — Rework",
        productId: "prod-widget-beta",
        quantity: 120,
        unit: "pcs",
        priority: 2,
        scheduledStart: from,
        scheduledEnd: to,
        status: "in_progress",
        machineId: "machine-mock-002",
        bomId: "bom-widget-beta-v2",
        actualStart: now,
        createdAt: now,
        updatedAt: now,
      },
      // ── Discrete manufacturing fixture (GST-29 scenario) ───────────────────
      // Represents a SAP Production Order in CRTD (Created) status — not yet
      // released to the floor. Scheduled for 2026-05-01, within the 30-day
      // lookahead window of /api/v1/erp/sync.
      {
        id: "wo-discrete-001",
        workOrderNumber: "WO-DISCRETE-001",
        title: "100-unit aluminium coupling run",
        productId: "ALU-COUPLING-M12",
        quantity: 100,
        unit: "pcs",
        priority: 1,
        scheduledStart: new Date("2026-05-01T06:00:00.000Z"),
        scheduledEnd: new Date("2026-05-01T14:00:00.000Z"),
        // "draft" = SAP CRTD status — supervisor must release before operators can start
        status: "draft",
        machineId: "machine-cnc-001",
        bomId: "BOM-ALU-COUPLING-M12-v1",
        erpReference: "SAP-PROD-ORDER-100001",
        createdAt: now,
        updatedAt: now,
      },
    ];

    return fixtures.filter(
      (wo) => wo.scheduledStart >= from && wo.scheduledEnd <= to
    );
  }

  async pushProductionResult(result: ProductionResult): Promise<void> {
    // Store locally so tests can inspect what was pushed.
    this.pushedResults.push(result);
  }

  async getMaterialList(bomId: string): Promise<BOMItem[]> {
    const fixtures: Record<string, BOMItem[]> = {
      "bom-widget-alpha-v1": [
        { itemNumber: "MAT-001", description: "Steel Bracket 50mm", quantity: 2, unit: "pcs", materialId: "mat-001" },
        { itemNumber: "MAT-002", description: "Rubber Gasket 30mm", quantity: 1, unit: "pcs", materialId: "mat-002" },
        { itemNumber: "MAT-003", description: "Hex Bolt M8x20", quantity: 4, unit: "pcs", materialId: "mat-003" },
      ],
      "bom-widget-beta-v2": [
        { itemNumber: "MAT-004", description: "Aluminium Housing", quantity: 1, unit: "pcs", materialId: "mat-004" },
        { itemNumber: "MAT-005", description: "Circuit Board PCB-7", quantity: 1, unit: "pcs", materialId: "mat-005" },
      ],
      // Discrete manufacturing BOM (GST-29 scenario)
      "BOM-ALU-COUPLING-M12-v1": [
        { itemNumber: "DC-RM-001", description: "Aluminium Rod 25mm diameter", quantity: 0.12, unit: "m", materialId: "mat-alu-rod-25mm" },
        { itemNumber: "DC-RM-002", description: "O-Ring Seal 12mm", quantity: 2, unit: "pcs", materialId: "mat-seal-o-ring-12" },
        { itemNumber: "DC-RM-003", description: "Hex Bolt M6×20mm", quantity: 4, unit: "pcs", materialId: "mat-bolt-m6-20mm" },
      ],
    };
    return fixtures[bomId] ?? [];
  }

  async healthCheck(): Promise<ERPHealthStatus> {
    return { connected: true, latency: 0 };
  }

  /** Test utility: inspect what production results have been pushed. */
  getPushedResults(): ProductionResult[] {
    return [...this.pushedResults];
  }
}
