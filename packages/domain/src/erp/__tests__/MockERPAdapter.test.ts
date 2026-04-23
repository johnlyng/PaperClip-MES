import { MockERPAdapter } from "../MockERPAdapter.js";
import type { ProductionResult } from "@mes/types";

describe("MockERPAdapter — IERPAdapter interface compliance (AC-ERP-01)", () => {
  let adapter: MockERPAdapter;

  beforeEach(() => {
    adapter = new MockERPAdapter();
  });

  it("getWorkOrdersByDate() returns an array of WorkOrders with required fields", async () => {
    const from = new Date("2026-04-01T00:00:00.000Z");
    const to = new Date("2026-04-01T23:59:59.000Z");

    const workOrders = await adapter.getWorkOrdersByDate(from, to);

    expect(Array.isArray(workOrders)).toBe(true);
    // Must return at least 1 work order per AC-ERP-03
    expect(workOrders.length).toBeGreaterThanOrEqual(1);

    const wo = workOrders[0];
    expect(wo).toHaveProperty("id");
    expect(wo).toHaveProperty("workOrderNumber");
    expect(wo).toHaveProperty("status");
    expect(wo).toHaveProperty("bomId");
    expect(wo.scheduledStart.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(wo.scheduledEnd.getTime()).toBeLessThanOrEqual(to.getTime());
  });

  it("pushProductionResult() resolves without throwing", async () => {
    const result: ProductionResult = {
      workOrderId: "wo-mock-001",
      machineId: "machine-mock-001",
      actualQuantity: 490,
      scrapQuantity: 10,
      completedAt: new Date(),
    };

    await expect(adapter.pushProductionResult(result)).resolves.toBeUndefined();
  });

  it("pushProductionResult() stores result inspectable via getPushedResults()", async () => {
    const result: ProductionResult = {
      workOrderId: "wo-mock-002",
      machineId: "machine-mock-002",
      actualQuantity: 118,
      scrapQuantity: 2,
      completedAt: new Date(),
    };

    await adapter.pushProductionResult(result);

    const pushed = adapter.getPushedResults();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].workOrderId).toBe("wo-mock-002");
    expect(pushed[0].actualQuantity).toBe(118);
  });

  it("getMaterialList() returns a BOMItem array for known BOM IDs", async () => {
    const items = await adapter.getMaterialList("bom-widget-alpha-v1");

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("itemNumber");
    expect(items[0]).toHaveProperty("quantity");
    expect(items[0]).toHaveProperty("unit");
  });

  it("getMaterialList() returns empty array for unknown BOM ID", async () => {
    const items = await adapter.getMaterialList("bom-does-not-exist");
    expect(items).toEqual([]);
  });

  it("healthCheck() returns { connected: true, latency: <number> }", async () => {
    const health = await adapter.healthCheck();

    expect(health.connected).toBe(true);
    expect(typeof health.latency).toBe("number");
  });
});

describe("MockERPAdapter — isolation between instances (AC-ERP-02)", () => {
  it("pushed results do not leak between adapter instances", async () => {
    const a = new MockERPAdapter();
    const b = new MockERPAdapter();

    await a.pushProductionResult({
      workOrderId: "wo-a",
      machineId: "machine-mock-001",
      actualQuantity: 100,
      scrapQuantity: 0,
      completedAt: new Date(),
    });

    expect(a.getPushedResults()).toHaveLength(1);
    expect(b.getPushedResults()).toHaveLength(0);
  });
});
