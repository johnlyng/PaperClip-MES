import { SAPAdapter } from "../SAPAdapter.js";
import type { SAPAdapterConfig, FetchFn } from "../SAPAdapter.js";
import type { ProductionResult } from "@mes/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CONFIG: SAPAdapterConfig = {
  baseUrl: "https://sap-test.example.com",
  authType: "oauth",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  tokenUrl: "https://sap-test.example.com/sap/bc/sec/oauth2/token",
  timeoutMs: 5_000,
  retryBaseDelayMs: 0, // no sleep in tests
};

const TOKEN_RESPONSE = {
  access_token: "test-bearer-token",
  expires_in: 3600,
  token_type: "Bearer",
};

const SAP_PROD_ORDERS = {
  value: [
    {
      ProductionOrder: "1000001",
      Material: "MAT-WIDGET-A",
      TotalQuantity: "500",
      ProductionUnit: "EA",
      PlannedStartDate: "2026-04-01",
      PlannedEndDate: "2026-04-01",
      ActualStartDate: "2026-04-01",
      ActualEndDate: null,
      ProductionOrderStatus: "REL",
      MRPController: "001",
      ProductionPlant: "PLANT-1",
      BillOfMaterialVariant: "BOM-001",
    },
    {
      ProductionOrder: "1000002",
      Material: "MAT-WIDGET-B",
      TotalQuantity: "250",
      ProductionUnit: "EA",
      PlannedStartDate: "2026-04-01",
      PlannedEndDate: "2026-04-01",
      ActualStartDate: null,
      ActualEndDate: null,
      ProductionOrderStatus: "CRTD",
      MRPController: "002",
      ProductionPlant: "PLANT-2",
      BillOfMaterialVariant: "BOM-002",
    },
  ],
};

const SAP_BOM = {
  value: [
    {
      BillOfMaterialVariant: "BOM-001",
      to_BOMItem: {
        value: [
          {
            BillOfMaterialItemNumber: "0010",
            BillOfMaterialComponent: "COMP-001",
            BillOfMaterialItemDescription: "Steel Bracket",
            BillOfMaterialItemQuantity: "2",
            BillOfMaterialItemUnit: "EA",
          },
          {
            BillOfMaterialItemNumber: "0020",
            BillOfMaterialComponent: "COMP-002",
            BillOfMaterialItemDescription: "Rubber Seal",
            BillOfMaterialItemQuantity: "1",
            BillOfMaterialItemUnit: "EA",
          },
        ],
      },
    },
  ],
};

// ─── Mock fetch factory ───────────────────────────────────────────────────────

/**
 * Creates a mock FetchFn that handles OAuth token and OData responses.
 * Any URL containing the path segment triggers the matching response.
 */
function makeMockFetch(overrides: Record<string, unknown> = {}): FetchFn {
  return async (url: string, _init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);

    // OAuth token endpoint
    if (urlStr.includes("/sap/bc/sec/oauth2/token")) {
      return jsonResponse(overrides["token"] ?? TOKEN_RESPONSE);
    }

    // Production orders
    if (urlStr.includes("/ProductionOrder")) {
      if (overrides["ProductionOrder"] instanceof Error) {
        throw overrides["ProductionOrder"] as Error;
      }
      const status = overrides["ProductionOrderStatus"] as number | undefined;
      if (status) {
        return new Response(null, { status });
      }
      return jsonResponse(overrides["ProductionOrder"] ?? SAP_PROD_ORDERS);
    }

    // Confirmation
    if (urlStr.includes("/ProdnOrdConf2")) {
      const status = overrides["ConfirmationStatus"] as number | undefined;
      if (status) {
        return new Response(null, { status, statusText: "Bad Request" });
      }
      return jsonResponse({ value: [] }, 201);
    }

    // BOM
    if (urlStr.includes("/MaterialBOM")) {
      return jsonResponse(overrides["BOM"] ?? SAP_BOM);
    }

    return new Response(null, { status: 404, statusText: "Not Found" });
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SAPAdapter — OAuth token caching", () => {
  it("fetches a token on the first API call and caches it", async () => {
    let tokenCallCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        tokenCallCount++;
        return jsonResponse(TOKEN_RESPONSE);
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(BASE_CONFIG, mockFetch);
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-01");

    await adapter.getWorkOrdersByDate(from, to);
    await adapter.getWorkOrdersByDate(from, to);

    // Token should be fetched only once (second call uses cache)
    expect(tokenCallCount).toBe(1);
  });

  it("re-fetches token when cache has expired", async () => {
    let tokenCallCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        tokenCallCount++;
        // Return a token that expires in 1 second (immediately expires for tests)
        return jsonResponse({ ...TOKEN_RESPONSE, expires_in: 0 });
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(BASE_CONFIG, mockFetch);
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-01");

    await adapter.getWorkOrdersByDate(from, to);
    await adapter.getWorkOrdersByDate(from, to);

    // Token expires immediately so each call fetches a fresh one
    expect(tokenCallCount).toBe(2);
  });
});

describe("SAPAdapter — Basic auth", () => {
  it("sends Basic auth header instead of Bearer when authType=basic", async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const mockFetch: FetchFn = async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) capturedHeaders.push(headers);
      return jsonResponse(SAP_PROD_ORDERS);
    };

    const adapter = new SAPAdapter(
      { ...BASE_CONFIG, authType: "basic", username: "user", password: "pass" },
      mockFetch
    );
    await adapter.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"));

    const authHeader = capturedHeaders.find((h) => h["Authorization"])?.["Authorization"] ?? "";
    expect(authHeader).toMatch(/^Basic /);
    // Should not contain "Bearer"
    expect(authHeader).not.toMatch(/^Bearer /);
  });
});

describe("SAPAdapter — getWorkOrdersByDate", () => {
  let adapter: SAPAdapter;

  beforeEach(() => {
    adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());
  });

  it("returns work orders mapped from SAP OData v4 response", async () => {
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-01");

    const workOrders = await adapter.getWorkOrdersByDate(from, to);

    expect(workOrders).toHaveLength(2);
    const [wo1, wo2] = workOrders;

    expect(wo1.id).toBe("1000001");
    expect(wo1.workOrderNumber).toBe("1000001");
    expect(wo1.productId).toBe("MAT-WIDGET-A");
    expect(wo1.quantity).toBe(500);
    expect(wo1.unit).toBe("EA");
    expect(wo1.erpReference).toBe("1000001");
    expect(wo1.bomId).toBe("BOM-001");
    expect(wo1.machineId).toBe("PLANT-1");

    expect(wo2.quantity).toBe(250);
    expect(wo2.status).toBe("draft");
  });

  it("maps REL status to 'released'", async () => {
    const workOrders = await adapter.getWorkOrdersByDate(
      new Date("2026-04-01"),
      new Date("2026-04-01")
    );
    expect(workOrders[0].status).toBe("released");
  });

  it("maps TECO status to 'completed'", async () => {
    const tecoOrder = {
      ...SAP_PROD_ORDERS.value[0],
      ProductionOrderStatus: "TECO",
    };
    const tecoFetch = makeMockFetch({ ProductionOrder: { value: [tecoOrder] } });
    const a = new SAPAdapter(BASE_CONFIG, tecoFetch);
    const [wo] = await a.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"));
    expect(wo.status).toBe("completed");
  });

  it("maps DLT status to 'cancelled'", async () => {
    const dltOrder = {
      ...SAP_PROD_ORDERS.value[0],
      ProductionOrderStatus: "DLT",
    };
    const dltFetch = makeMockFetch({ ProductionOrder: { value: [dltOrder] } });
    const a = new SAPAdapter(BASE_CONFIG, dltFetch);
    const [wo] = await a.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"));
    expect(wo.status).toBe("cancelled");
  });

  it("throws when SAP returns a non-2xx status", async () => {
    const badFetch = makeMockFetch({ ProductionOrderStatus: 503 });
    const a = new SAPAdapter(BASE_CONFIG, badFetch);
    await expect(
      a.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"))
    ).rejects.toThrow("SAP GET");
  });

  it("includes a date filter in the request URL", async () => {
    const capturedUrls: string[] = [];
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      capturedUrls.push(String(url));
      return makeMockFetch()(url, init);
    };

    const adapter2 = new SAPAdapter(BASE_CONFIG, mockFetch);
    await adapter2.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-30"));

    const dataUrl = capturedUrls.find((u) => u.includes("/ProductionOrder"));
    expect(dataUrl).toContain("filter");
    expect(dataUrl).toContain("2026-04-01");
    expect(dataUrl).toContain("2026-04-30");
  });
});

describe("SAPAdapter — pushProductionResult", () => {
  it("resolves when SAP returns 201", async () => {
    const adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());
    const result: ProductionResult = {
      workOrderId: "1000001",
      machineId: "PLANT-1",
      actualQuantity: 480,
      scrapQuantity: 20,
      completedAt: new Date("2026-04-01T10:00:00Z"),
    };

    await expect(adapter.pushProductionResult(result)).resolves.toBeUndefined();
  });

  it("sends correct payload fields to SAP confirmation endpoint", async () => {
    const capturedBodies: unknown[] = [];
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/ProdnOrdConf2")) {
        capturedBodies.push(JSON.parse(init?.body as string));
        return jsonResponse({ value: [] }, 201);
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(BASE_CONFIG, mockFetch);
    await adapter.pushProductionResult({
      workOrderId: "1000001",
      machineId: "PLANT-1",
      operatorId: "OP-001",
      actualQuantity: 490,
      scrapQuantity: 10,
      completedAt: new Date("2026-04-01T10:00:00Z"),
    });

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0] as Record<string, unknown>;
    expect(body["ProductionOrder"]).toBe("1000001");
    expect(body["ConfirmationQuantity"]).toBe(490);
    expect(body["Scrap"]).toBe(10);
    expect(body["PostingDate"]).toBe("2026-04-01");
    expect(body["FinalConfirmation"]).toBe(true);
    expect(body["Personnel"]).toBe("OP-001");
  });

  it("throws when SAP returns a non-2xx status", async () => {
    const badFetch = makeMockFetch({ ConfirmationStatus: 400 });
    const adapter = new SAPAdapter(BASE_CONFIG, badFetch);
    await expect(
      adapter.pushProductionResult({
        workOrderId: "1000001",
        machineId: "PLANT-1",
        actualQuantity: 490,
        scrapQuantity: 10,
        completedAt: new Date(),
      })
    ).rejects.toThrow("SAP POST");
  });
});

describe("SAPAdapter — getMaterialList", () => {
  it("returns BOM items for a known BOM ID", async () => {
    const adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());
    const items = await adapter.getMaterialList("BOM-001");

    expect(items).toHaveLength(2);
    expect(items[0].itemNumber).toBe("0010");
    expect(items[0].description).toBe("Steel Bracket");
    expect(items[0].quantity).toBe(2);
    expect(items[0].unit).toBe("EA");
    expect(items[0].materialId).toBe("COMP-001");
  });

  it("returns empty array when SAP returns no BOM entry", async () => {
    const emptyBomFetch = makeMockFetch({ BOM: { value: [] } });
    const adapter = new SAPAdapter(BASE_CONFIG, emptyBomFetch);
    const items = await adapter.getMaterialList("BOM-UNKNOWN");
    expect(items).toEqual([]);
  });
});

describe("SAPAdapter — healthCheck", () => {
  it("returns connected=true with a latency value when SAP responds", async () => {
    const adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());
    const health = await adapter.healthCheck();

    expect(health.connected).toBe(true);
    expect(typeof health.latency).toBe("number");
    expect(health.latency).toBeGreaterThanOrEqual(0);
  });

  it("returns connected=false when the SAP endpoint throws", async () => {
    const errorFetch: FetchFn = async (_url: string, _init?: RequestInit) => {
      // Always fail (simulates network error or bad status)
      throw new Error("Network unreachable");
    };
    const adapter = new SAPAdapter(BASE_CONFIG, errorFetch);
    const health = await adapter.healthCheck();

    expect(health.connected).toBe(false);
    expect(typeof health.latency).toBe("number");
  });
});

describe("SAPAdapter — /Date() legacy format parsing", () => {
  it("parses OData v2 legacy /Date(ms)/ strings from SAP", async () => {
    const legacyDate = "/Date(1775001600000)/"; // 2026-04-01T00:00:00Z
    const legacyOrder = {
      ...SAP_PROD_ORDERS.value[0],
      PlannedStartDate: legacyDate,
      PlannedEndDate: legacyDate,
    };
    const legacyFetch = makeMockFetch({ ProductionOrder: { value: [legacyOrder] } });
    const adapter = new SAPAdapter(BASE_CONFIG, legacyFetch);
    const [wo] = await adapter.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"));

    expect(wo.scheduledStart).toBeInstanceOf(Date);
    expect(wo.scheduledStart.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

// ─── BLOCKER 1: OData filter injection guard ──────────────────────────────────

describe("SAPAdapter — getMaterialList input validation (BLOCKER 1)", () => {
  it("throws on bomId containing OData injection characters", async () => {
    const adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());

    await expect(
      adapter.getMaterialList("bom'; $filter=1 eq 1 &")
    ).rejects.toThrow("Invalid bomId format");
  });

  it("throws on bomId with single-quote injection", async () => {
    const adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());
    await expect(adapter.getMaterialList("bom'injection")).rejects.toThrow("Invalid bomId format");
  });

  it("accepts valid bomId matching the allowlist pattern", async () => {
    const adapter = new SAPAdapter(BASE_CONFIG, makeMockFetch());
    // Should not throw
    await expect(adapter.getMaterialList("BOM-001")).resolves.toBeDefined();
    await expect(adapter.getMaterialList("BOM_v2.0")).resolves.toBeDefined();
  });
});

// ─── BLOCKER 2: OAuth single-flight race condition ────────────────────────────

describe("SAPAdapter — OAuth single-flight token fetch (BLOCKER 2)", () => {
  it("concurrent callers share a single token request when cache is cold", async () => {
    let tokenCallCount = 0;
    // Introduce a small delay to make concurrent token requests overlap
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        tokenCallCount++;
        await new Promise((r) => setTimeout(r, 10)); // simulate network latency
        return jsonResponse(TOKEN_RESPONSE);
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(BASE_CONFIG, mockFetch);
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-01");

    // Fire two concurrent requests — both should share the same token fetch
    await Promise.all([
      adapter.getWorkOrdersByDate(from, to),
      adapter.getWorkOrdersByDate(from, to),
    ]);

    // Single-flight means exactly one token request regardless of concurrency
    expect(tokenCallCount).toBe(1);
  });
});

// ─── BLOCKER 3: Retry on transient failures ───────────────────────────────────

describe("SAPAdapter — retry with exponential backoff (BLOCKER 3)", () => {
  it("retries on 503 and succeeds on the next attempt", async () => {
    let callCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        return jsonResponse(TOKEN_RESPONSE);
      }
      callCount++;
      // First call returns 503, second call succeeds
      if (callCount === 1) {
        return new Response(null, { status: 503, statusText: "Service Unavailable" });
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter({ ...BASE_CONFIG, maxRetries: 3, timeoutMs: 5_000, retryBaseDelayMs: 0 }, mockFetch);
    const workOrders = await adapter.getWorkOrdersByDate(
      new Date("2026-04-01"),
      new Date("2026-04-01")
    );

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(workOrders.length).toBeGreaterThan(0);
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    let callCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        return jsonResponse(TOKEN_RESPONSE);
      }
      callCount++;
      if (callCount === 1) {
        return new Response(null, { status: 429, statusText: "Too Many Requests" });
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter({ ...BASE_CONFIG, maxRetries: 3, timeoutMs: 5_000, retryBaseDelayMs: 0 }, mockFetch);
    const workOrders = await adapter.getWorkOrdersByDate(
      new Date("2026-04-01"),
      new Date("2026-04-01")
    );

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(workOrders.length).toBeGreaterThan(0);
  });

  it("throws after exhausting all retries on persistent 503", async () => {
    const mockFetch: FetchFn = async (url: string) => {
      if (String(url).includes("/oauth2/token")) {
        return jsonResponse(TOKEN_RESPONSE);
      }
      return new Response(null, { status: 503, statusText: "Service Unavailable" });
    };

    const adapter = new SAPAdapter({ ...BASE_CONFIG, maxRetries: 1, timeoutMs: 5_000, retryBaseDelayMs: 0 }, mockFetch);
    await expect(
      adapter.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"))
    ).rejects.toThrow("SAP GET");
  });
});

// ─── NEW BLOCKER: POST 500 must not retry (non-idempotent write) ──────────────

describe("SAPAdapter — POST 500 no-retry (new blocker from re-review)", () => {
  it("does NOT retry pushProductionResult on SAP 500 (would duplicate confirmation)", async () => {
    let postCallCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        return jsonResponse(TOKEN_RESPONSE);
      }
      if (init?.method === "POST" && String(url).includes("/ProdnOrdConf2")) {
        postCallCount++;
        return new Response(null, { status: 500, statusText: "Internal Server Error" });
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(
      { ...BASE_CONFIG, maxRetries: 3, retryBaseDelayMs: 0 },
      mockFetch
    );

    await expect(
      adapter.pushProductionResult({
        workOrderId: "1000001",
        machineId: "PLANT-1",
        actualQuantity: 490,
        scrapQuantity: 10,
        completedAt: new Date(),
      })
    ).rejects.toThrow("SAP POST");

    // 500 must NOT trigger retries for POST — exactly 1 attempt
    expect(postCallCount).toBe(1);
  });

  it("DOES retry pushProductionResult on SAP 503 (availability failure, safe to retry)", async () => {
    let postCallCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        return jsonResponse(TOKEN_RESPONSE);
      }
      if (init?.method === "POST" && String(url).includes("/ProdnOrdConf2")) {
        postCallCount++;
        if (postCallCount === 1) {
          return new Response(null, { status: 503, statusText: "Service Unavailable" });
        }
        return jsonResponse({ value: [] }, 201);
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(
      { ...BASE_CONFIG, maxRetries: 3, retryBaseDelayMs: 0 },
      mockFetch
    );

    await expect(
      adapter.pushProductionResult({
        workOrderId: "1000001",
        machineId: "PLANT-1",
        actualQuantity: 490,
        scrapQuantity: 10,
        completedAt: new Date(),
      })
    ).resolves.toBeUndefined();

    expect(postCallCount).toBe(2);
  });

  it("GET 500 is retried (reads are idempotent)", async () => {
    let getCallCount = 0;
    const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
      if (String(url).includes("/oauth2/token")) {
        return jsonResponse(TOKEN_RESPONSE);
      }
      getCallCount++;
      if (getCallCount === 1) {
        return new Response(null, { status: 500, statusText: "Internal Server Error" });
      }
      return makeMockFetch()(url, init);
    };

    const adapter = new SAPAdapter(
      { ...BASE_CONFIG, maxRetries: 3, retryBaseDelayMs: 0 },
      mockFetch
    );

    const orders = await adapter.getWorkOrdersByDate(
      new Date("2026-04-01"),
      new Date("2026-04-01")
    );

    expect(getCallCount).toBeGreaterThanOrEqual(2);
    expect(orders.length).toBeGreaterThan(0);
  });
});

// ─── Non-blocking: PCNF maps to in_progress ───────────────────────────────────

describe("SAPAdapter — PCNF status mapping", () => {
  it("maps PCNF (partially confirmed) to in_progress rather than released", async () => {
    const pcnfOrder = {
      ...SAP_PROD_ORDERS.value[0],
      ProductionOrderStatus: "PCNF",
    };
    const adapter = new SAPAdapter(
      BASE_CONFIG,
      makeMockFetch({ ProductionOrder: { value: [pcnfOrder] } })
    );
    const [wo] = await adapter.getWorkOrdersByDate(new Date("2026-04-01"), new Date("2026-04-01"));
    expect(wo.status).toBe("in_progress");
  });
});
