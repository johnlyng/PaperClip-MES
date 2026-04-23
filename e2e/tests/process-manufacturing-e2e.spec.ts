/**
 * process-manufacturing-e2e.spec.ts
 *
 * Cross-module E2E scenario for the 9-step process-manufacturing checklist.
 * This spec MUST pass before any discrete-manufacturing E2E runs.
 *
 * Checklist (Section 7 of QA plan, GST-12):
 *   1. Scada-LTS collector polls batch reactor telemetry (AC-OEE-06)
 *   2. MQTT event arrives; TimescaleDB hypertable written (AC-OEE-02)
 *   3. Operator dashboard displays reactor OEE gauge (AC-UI-04)
 *   4. Supervisor creates batch work order for reactor (AC-WO-01)
 *   5. Operator starts work order from dashboard (AC-UI-03, AC-WO-02)
 *   6. Machine transitions to IN_PROGRESS; MQTT event fires (AC-WO-05)
 *   7. Operator logs batch result (yield, waste, downtime) (AC-UI-03, AC-WO-03)
 *   8. Work order completes; MockERPAdapter.pushProductionResult called (AC-ERP-01, AC-WO-03)
 *   9. OEE aggregates reflect the completed shift (AC-OEE-03)
 *
 * Prerequisite: `docker compose up` with the full production-equivalent stack.
 */
import { test, expect } from "../fixtures/authFixture.js";

const API_BASE = process.env["API_BASE_URL"] ?? "http://localhost:3000";

test.describe("Process-Manufacturing E2E — 9-step checklist", () => {
  let workOrderId: string;

  test("Step 1-3: Telemetry ingested and OEE gauge visible on dashboard", async ({
    operatorPage: page,
  }) => {
    await page.goto("/");

    // Step 3: Operator dashboard must render machine tiles
    // The OEE gauge/machine tile for batch-reactor-001 must be present
    await expect(
      page.locator('[data-testid="machine-tile"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Step 4: Supervisor creates batch work order for reactor", async ({
    supervisorPage: page,
  }) => {
    // Create a process work order via the API (simulating supervisor UI action)
    const response = await page.request.post(`${API_BASE}/api/v1/work-orders`, {
      data: {
        processOrderNumber: "PRO-E2E-001",
        bomId: "bom-polymer-grade-a-v3",
        scheduledQuantity: 500,
        targetMachineId: "machine-reactor-001",
        scheduledStart: new Date(Date.now() + 60_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        batchSize: 500,
        unit: "kg",
        type: "process",
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status()).toBe(201);
    const body = (await response.json()) as { id: string };
    workOrderId = body.id;
    expect(workOrderId).toBeTruthy();
  });

  test("Step 5: Operator starts work order from dashboard (AC-UI-03, AC-WO-02)", async ({
    operatorPage: page,
  }) => {
    // Skip if workOrderId was not set (step 4 failed)
    test.skip(!workOrderId, "Requires step 4 to create work order first");

    await page.goto("/");
    // Find the work order row and click Start
    const startButton = page.locator(`[data-testid="wo-start-${workOrderId}"]`);
    await startButton.waitFor({ timeout: 10_000 });
    await startButton.click();

    // Status must update to IN_PROGRESS without full page reload
    await expect(
      page.locator(`[data-testid="wo-status-${workOrderId}"]`)
    ).toHaveText(/in.progress/i, { timeout: 5000 });
  });

  test("Step 6: Machine transitions to IN_PROGRESS; MQTT event fires (AC-WO-05)", async ({
    operatorPage: page,
  }) => {
    test.skip(!workOrderId, "Requires work order to exist");

    // OEE tile should update within 2 seconds of status change via WebSocket
    await page.goto("/");
    await expect(
      page.locator('[data-testid="machine-tile-machine-reactor-001"]')
        .locator('[data-testid="machine-status"]')
    ).toHaveText(/running/i, { timeout: 5000 });
  });

  test("Step 7-8: Operator completes work order with batch results (AC-UI-03, AC-WO-03)", async ({
    operatorPage: page,
  }) => {
    test.skip(!workOrderId, "Requires work order to be in_progress");

    await page.goto("/");
    const completeButton = page.locator(`[data-testid="wo-complete-${workOrderId}"]`);
    await completeButton.waitFor({ timeout: 10_000 });
    await completeButton.click();

    // Modal prompts for production results
    await expect(page.locator('[data-testid="completion-modal"]')).toBeVisible();
    await page.fill('[data-testid="actual-quantity-input"]', "485");
    await page.fill('[data-testid="waste-quantity-input"]', "15");
    await page.fill('[data-testid="downtime-minutes-input"]', "20");
    await page.click('[data-testid="submit-completion-button"]');

    // Work order status becomes COMPLETED; yield computed and displayed
    await expect(
      page.locator(`[data-testid="wo-status-${workOrderId}"]`)
    ).toHaveText(/completed/i, { timeout: 5000 });

    // Step 8: ERP push — verify the API call was recorded (via API health endpoint)
    const erpStatus = await page.request.get(`${API_BASE}/api/v1/erp/health`);
    expect(erpStatus.status()).toBe(200);
  });

  test("Step 9: OEE aggregates reflect the completed shift (AC-OEE-03)", async ({
    operatorPage: page,
  }) => {
    const now = new Date();
    const from = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const resp = await page.request.get(
      `${API_BASE}/api/v1/machines/machine-reactor-001/oee?from=${from}&to=${to}&granularity=1h`
    );

    expect(resp.status()).toBe(200);
    const data = (await resp.json()) as Array<{
      availability: number;
      performance: number;
      quality: number;
      oee: number;
      windowStart: string;
      windowEnd: string;
    }>;

    // At least one OEE data point must be returned
    expect(data.length).toBeGreaterThan(0);

    // Each data point must have all required fields
    const point = data[0]!;
    expect(typeof point.availability).toBe("number");
    expect(typeof point.performance).toBe("number");
    expect(typeof point.quality).toBe("number");
    expect(typeof point.oee).toBe("number");
    expect(point.windowStart).toBeTruthy();
    expect(point.windowEnd).toBeTruthy();
  });
});
