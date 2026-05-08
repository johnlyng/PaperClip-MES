/**
 * mobile-work-orders.spec.ts
 *
 * GST-55: Mobile-responsive shop floor UI — viewport acceptance tests.
 *
 * Runs in two projects (tablet-768 and mobile-375) defined in playwright.config.ts.
 * Covers Steps 2 (start WO) and 5 (close WO) at both breakpoints, plus no-scroll
 * and layout checks per the acceptance criteria.
 *
 * Prerequisite: `docker compose up` with the full production-equivalent stack.
 */
import { test, expect } from "../fixtures/authFixture.js";

const API_BASE = process.env["API_BASE_URL"] ?? "http://localhost:3000";

test.describe("Mobile viewport — shop floor UI (GST-55)", () => {
  let workOrderId: string;

  test("Setup: create and release a work order for mobile flow tests", async ({
    supervisorPage: page,
  }) => {
    const res = await page.request.post(`${API_BASE}/api/v1/work-orders`, {
      data: {
        processOrderNumber: `MOB-E2E-${Date.now()}`,
        bomId: "bom-polymer-grade-a-v3",
        scheduledQuantity: 10,
        targetMachineId: "machine-reactor-001",
        scheduledStart: new Date(Date.now() + 60_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        batchSize: 10,
        unit: "kg",
        type: "process",
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id: string };
    workOrderId = body.id;

    const releaseRes = await page.request.patch(
      `${API_BASE}/api/v1/work-orders/${workOrderId}/transition`,
      {
        data: { event: "release" },
        headers: { "Content-Type": "application/json" },
      }
    );
    expect(releaseRes.status()).toBe(200);
  });

  test("No horizontal scroll at viewport width", async ({ operatorPage: page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="machine-tile"]').first()).toBeVisible({
      timeout: 10_000,
    });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("OEE machine tiles are visible at mobile viewport", async ({ operatorPage: page }) => {
    await page.goto("/");
    const tiles = page.locator('[data-testid="machine-tile"]');
    await expect(tiles.first()).toBeVisible({ timeout: 10_000 });

    // Every tile must not overflow — check bounding box stays within viewport
    const viewportWidth = page.viewportSize()?.width ?? 375;
    const count = await tiles.count();
    for (let i = 0; i < count; i++) {
      const box = await tiles.nth(i).boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1); // 1px tolerance
      }
    }
  });

  test("Work order list renders as cards (not a table) at mobile viewport", async ({
    operatorPage: page,
  }) => {
    await page.goto("/");

    // Cards must be visible; the desktop table is hidden via CSS (hidden md:block)
    const cards = page.locator('[data-testid="work-order-card"]');
    const rows = page.locator('[data-testid="work-order-row"]');

    // Wait for content to load
    await page.waitForTimeout(1_000);

    // If there are work orders, they should appear as cards
    const cardCount = await cards.count();
    const rowCount = await rows.count();

    // At mobile viewport, table rows should not be visible even if present in DOM
    if (rowCount > 0) {
      await expect(rows.first()).not.toBeVisible();
    }

    // Cards should be the visible representation (if any WOs exist)
    if (cardCount > 0) {
      await expect(cards.first()).toBeVisible();
    }
  });

  test("Step 2: Start button is visible and has thumb-sized tap target", async ({
    operatorPage: page,
  }) => {
    test.skip(!workOrderId, "Requires setup step to create work order first");

    await page.goto("/");

    const startBtn = page.locator('[data-testid="start-work-order-btn"]').first();
    await expect(startBtn).toBeVisible({ timeout: 10_000 });

    const box = await startBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Minimum 44x44px tap target per WCAG 2.5.5
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("Step 2: Start work order flow works at mobile viewport", async ({
    operatorPage: page,
  }) => {
    test.skip(!workOrderId, "Requires setup step to create work order first");

    await page.goto("/");

    const startBtn = page.locator('[data-testid="start-work-order-btn"]').first();
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await startBtn.click();

    // After starting, the start button should be gone for this WO;
    // a close button should appear
    await expect(
      page.locator('[data-testid="close-work-order-btn"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Step 5: Close button has thumb-sized tap target and close flow works", async ({
    operatorPage: page,
  }) => {
    test.skip(!workOrderId, "Requires setup step and Step 2 to run first");

    await page.goto("/");

    const closeBtn = page.locator('[data-testid="close-work-order-btn"]').first();
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });

    const box = await closeBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    await closeBtn.click();

    // A completion dialog should appear — on mobile it is full-screen
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Verify no horizontal scroll while dialog is open
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
