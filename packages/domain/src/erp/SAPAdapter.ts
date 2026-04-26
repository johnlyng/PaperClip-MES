import type { WorkOrder, BOMItem, ProductionResult, ERPHealthStatus } from "@mes/types";
import type { IERPAdapter } from "./IERPAdapter.js";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface SAPAdapterConfig {
  /** SAP S/4HANA base URL, e.g. https://my-tenant.s4hana.ondemand.com */
  baseUrl: string;
  /** "oauth" for S/4HANA Cloud (default), "basic" for on-prem */
  authType?: "oauth" | "basic";
  // OAuth 2.0 client credentials (Cloud)
  clientId?: string;
  clientSecret?: string;
  /** Defaults to {baseUrl}/sap/bc/sec/oauth2/token */
  tokenUrl?: string;
  // Basic auth (on-prem)
  username?: string;
  password?: string;
  /** Request timeout in ms per attempt (default 10 000) */
  timeoutMs?: number;
  /** Max retry attempts for transient failures (default 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 500; set to 0 in tests) */
  retryBaseDelayMs?: number;
}

/**
 * Build a SAPAdapterConfig from environment variables.
 * Throws if SAP_BASE_URL is not set.
 */
export function sapConfigFromEnv(): SAPAdapterConfig {
  const baseUrl = process.env["SAP_BASE_URL"];
  if (!baseUrl) throw new Error("SAP_BASE_URL is not set");

  const authType = (process.env["SAP_AUTH_TYPE"] ?? "oauth") as "oauth" | "basic";
  return {
    baseUrl,
    authType,
    clientId: process.env["SAP_CLIENT_ID"],
    clientSecret: process.env["SAP_CLIENT_SECRET"],
    tokenUrl: process.env["SAP_TOKEN_URL"],
    username: process.env["SAP_USERNAME"],
    password: process.env["SAP_PASSWORD"],
    timeoutMs: process.env["SAP_TIMEOUT_MS"] ? Number(process.env["SAP_TIMEOUT_MS"]) : 10_000,
    maxRetries: process.env["SAP_MAX_RETRIES"] ? Number(process.env["SAP_MAX_RETRIES"]) : 3,
    retryBaseDelayMs: 500,
  };
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  /** Date.now() ms at which the token expires */
  expiresAt: number;
}

/** OData v4 collection response envelope */
interface ODataCollection<T> {
  value: T[];
}

/** SAP ProductionOrder entity (OData v4 field names) */
interface SAPProductionOrder {
  ProductionOrder: string;
  ProductionOrderType?: string;
  Material: string;
  TotalQuantity: string | number;
  ProductionUnit: string;
  PlannedStartDate: string; // ISO date string or /Date(ms)/ format
  PlannedEndDate: string;
  ActualStartDate?: string;
  ActualEndDate?: string;
  ProductionOrderStatus: string;
  MRPController?: string;
  ProductionPlant?: string;
  BillOfMaterialVariant?: string;
}

/** SAP ProductionOrderConfirmation entity */
interface SAPConfirmationPayload {
  ProductionOrder: string;
  ConfirmationQuantity: number | string;
  Scrap?: number | string;
  PostingDate: string; // YYYY-MM-DD
  FinalConfirmation?: boolean;
  Personnel?: string;
}

/** OAuth 2.0 token response */
interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/** Injectable fetch-like function — allows tests to substitute a mock */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Statuses that are safe to retry (server-side transient) */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * SAPAdapter — concrete IERPAdapter implementation for SAP S/4HANA OData v4.
 *
 * ADR-001 Decision 6: one concrete adapter per ERP vendor, wired via ERP_ADAPTER env var.
 *
 * Supported APIs:
 *   - Production Orders:  API_PRODUCTION_ORDER_2_SRV (OData v4)
 *   - Confirmations:      API_PROD_ORDER_CONFIRMATION_2_SRV (OData v4)
 *   - Bill of Materials:  API_BILL_OF_MATERIAL_SRV (OData v4)
 *
 * Auth:
 *   - OAuth 2.0 client_credentials (SAP S/4HANA Cloud) — token cached until expiry,
 *     single-flight promise prevents parallel token requests during cache miss
 *   - HTTP Basic (SAP S/4HANA on-prem) — enabled via SAP_AUTH_TYPE=basic
 *
 * Resilience:
 *   - Exponential backoff with jitter for 429/5xx responses and network errors
 *   - Configurable maxRetries (default 3); per-attempt timeout
 */
export class SAPAdapter implements IERPAdapter {
  private readonly config: Required<SAPAdapterConfig>;
  private readonly fetchFn: FetchFn;
  private tokenCache: TokenCache | null = null;
  /** Single-flight guard: while a token fetch is in-flight, all callers await the same promise */
  private tokenInflight: Promise<string> | null = null;

  // OData v4 service root paths
  private static readonly PROD_ORDER_SVC =
    "/sap/opu/odata4/sap/api_production_order/srvd_a2x/sap/production_order/0001";
  private static readonly CONFIRMATION_SVC =
    "/sap/opu/odata4/sap/api_prod_order_confirmation/srvd_a2x/sap/prod_order_confirmation/0001";
  private static readonly BOM_SVC =
    "/sap/opu/odata4/sap/api_bill_of_material/srvd_a2x/sap/bill_of_material/0001";

  /** Strict allowlist for BOM ID values interpolated into OData filter strings */
  private static readonly BOM_ID_PATTERN = /^[A-Za-z0-9_\-.]+$/;

  constructor(config: SAPAdapterConfig, fetchFn: FetchFn = fetch) {
    this.config = {
      authType: "oauth",
      tokenUrl: `${config.baseUrl}/sap/bc/sec/oauth2/token`,
      clientId: undefined!,
      clientSecret: undefined!,
      username: undefined!,
      password: undefined!,
      timeoutMs: 10_000,
      maxRetries: 3,
      retryBaseDelayMs: 500,
      ...config,
    };
    this.fetchFn = fetchFn;
  }

  // ─── IERPAdapter ────────────────────────────────────────────────────────────

  async getWorkOrdersByDate(from: Date, to: Date): Promise<WorkOrder[]> {
    const fromStr = this.toODataDate(from);
    const toStr = this.toODataDate(to);

    const filter = `PlannedStartDate ge ${fromStr} and PlannedEndDate le ${toStr}`;
    const url =
      `${this.config.baseUrl}${SAPAdapter.PROD_ORDER_SVC}/ProductionOrder` +
      `?$filter=${encodeURIComponent(filter)}&$select=ProductionOrder,Material,TotalQuantity,` +
      `ProductionUnit,PlannedStartDate,PlannedEndDate,ActualStartDate,ActualEndDate,` +
      `ProductionOrderStatus,MRPController,ProductionPlant,BillOfMaterialVariant`;

    const data = await this.get<ODataCollection<SAPProductionOrder>>(url);
    return data.value.map((order) => this.mapProductionOrder(order));
  }

  async pushProductionResult(result: ProductionResult): Promise<void> {
    const payload: SAPConfirmationPayload = {
      ProductionOrder: result.workOrderId,
      ConfirmationQuantity: result.actualQuantity,
      Scrap: result.scrapQuantity,
      PostingDate: result.completedAt.toISOString().slice(0, 10),
      FinalConfirmation: true,
      Personnel: result.operatorId,
    };

    const url = `${this.config.baseUrl}${SAPAdapter.CONFIRMATION_SVC}/ProdnOrdConf2`;
    await this.post(url, payload);
  }

  async getMaterialList(bomId: string): Promise<BOMItem[]> {
    // BLOCKER 1 fix: strict allowlist prevents OData filter injection
    if (!SAPAdapter.BOM_ID_PATTERN.test(bomId)) {
      throw new Error(`Invalid bomId format: ${bomId}`);
    }

    const url =
      `${this.config.baseUrl}${SAPAdapter.BOM_SVC}/MaterialBOM` +
      `?$filter=${encodeURIComponent(`BillOfMaterialVariant eq '${bomId}'`)}` +
      `&$expand=to_BOMItem`;

    const data = await this.get<ODataCollection<{
      BillOfMaterialVariant: string;
      to_BOMItem?: { value: SAPBOMItem[] };
    }>>(url);

    const bom = data.value[0];
    if (!bom) return [];

    const items = bom.to_BOMItem?.value ?? [];
    return items.map((item) => this.mapBOMItem(item));
  }

  async healthCheck(): Promise<ERPHealthStatus> {
    const start = Date.now();
    const url =
      `${this.config.baseUrl}${SAPAdapter.PROD_ORDER_SVC}/ProductionOrder?$top=1&$select=ProductionOrder`;
    try {
      await this.get<ODataCollection<SAPProductionOrder>>(url);
      return { connected: true, latency: Date.now() - start };
    } catch {
      return { connected: false, latency: Date.now() - start };
    }
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  private async getAuthHeader(): Promise<string> {
    if (this.config.authType === "basic") {
      const credentials = Buffer.from(
        `${this.config.username}:${this.config.password}`
      ).toString("base64");
      return `Basic ${credentials}`;
    }
    // OAuth 2.0 client credentials
    const token = await this.getOAuthToken();
    return `Bearer ${token}`;
  }

  /**
   * BLOCKER 2 fix: single-flight OAuth token fetch.
   * If a token fetch is already in-flight, all callers share the same promise
   * instead of each firing a separate request to the token endpoint.
   */
  private getOAuthToken(): Promise<string> {
    const now = Date.now();
    // Return cached token if still valid (with 60 s buffer)
    if (this.tokenCache && this.tokenCache.expiresAt - 60_000 > now) {
      return Promise.resolve(this.tokenCache.accessToken);
    }
    // Coalesce concurrent callers onto a single in-flight request
    if (this.tokenInflight) return this.tokenInflight;

    this.tokenInflight = this.doFetchToken().finally(() => {
      this.tokenInflight = null;
    });
    return this.tokenInflight;
  }

  private async doFetchToken(): Promise<string> {
    const now = Date.now();
    const tokenUrl = this.config.tokenUrl;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await this.fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `SAP OAuth token request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return this.tokenCache.accessToken;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────────

  private async get<T>(url: string): Promise<T> {
    const authHeader = await this.getAuthHeader();
    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "OData-Version": "4.0",
      },
    });
    if (!response.ok) {
      throw new Error(
        `SAP GET ${url} failed: ${response.status} ${response.statusText}`
      );
    }
    return (await response.json()) as T;
  }

  private async post(url: string, body: unknown): Promise<void> {
    const authHeader = await this.getAuthHeader();
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
        "OData-Version": "4.0",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `SAP POST ${url} failed: ${response.status} ${response.statusText}`
      );
    }
  }

  /**
   * BLOCKER 3 fix: exponential backoff with jitter for transient SAP failures.
   * Retries on network errors and 429/5xx responses up to maxRetries times.
   * Delay formula: min(2^attempt * retryBaseDelayMs, 10s) + [0..retryBaseDelayMs] jitter.
   * Set retryBaseDelayMs=0 in tests to avoid slow suites.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, init);
        if (!RETRYABLE_STATUS_CODES.has(response.status)) {
          // Success or non-retryable client error — return immediately
          return response;
        }
        // Retryable server-side status — record and retry after delay
        lastError = new Error(
          `SAP ${init.method ?? "GET"} ${url}: transient ${response.status}`
        );
      } catch (err) {
        // Network-level error (timeout, DNS failure, etc.)
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      if (attempt < this.config.maxRetries) {
        const base = this.config.retryBaseDelayMs;
        const backoff = Math.min(2 ** attempt * base, 10_000);
        const jitter = Math.random() * base;
        await sleep(backoff + jitter);
      }
    }

    throw lastError ?? new Error(`SAP request failed after ${this.config.maxRetries} retries`);
  }

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    return this.fetchFn(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
  }

  // ─── Mapping helpers ──────────────────────────────────────────────────────────

  private mapProductionOrder(order: SAPProductionOrder): WorkOrder {
    const now = new Date();
    return {
      id: order.ProductionOrder,
      workOrderNumber: order.ProductionOrder,
      title: `SAP Production Order ${order.ProductionOrder}`,
      productId: order.Material,
      quantity: Number(order.TotalQuantity),
      unit: order.ProductionUnit,
      scheduledStart: this.parseDate(order.PlannedStartDate),
      scheduledEnd: this.parseDate(order.PlannedEndDate),
      actualStart: order.ActualStartDate ? this.parseDate(order.ActualStartDate) : undefined,
      actualEnd: order.ActualEndDate ? this.parseDate(order.ActualEndDate) : undefined,
      status: this.mapOrderStatus(order.ProductionOrderStatus),
      priority: 1,
      // NOTE: ProductionPlant is a plant/facility code, not a single machine ID.
      // Correct mapping requires an explicit plant→line/machine lookup table.
      // Stored here as-is for the sync flow; callers should treat it as lineId context.
      machineId: order.ProductionPlant,
      bomId: order.BillOfMaterialVariant,
      erpReference: order.ProductionOrder,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mapOrderStatus(
    sapStatus: string
  ): WorkOrder["status"] {
    // SAP order statuses: CRTD=created, REL=released, PCNF=partially confirmed,
    // CNF=confirmed (fully), TECO=technically completed, DLT=deleted.
    // NOTE: PCNF must be checked before CNF because "PCNF" contains "CNF".
    const upper = sapStatus.toUpperCase();
    if (upper.includes("TECO")) return "completed";
    if (upper.includes("PCNF")) return "in_progress"; // partial confirm — work in progress
    if (upper.includes("CNF")) return "completed";    // full confirm — after PCNF check
    if (upper.includes("REL")) return "released";
    if (upper.includes("DLT")) return "cancelled";
    return "draft";
  }

  private mapBOMItem(item: SAPBOMItem): BOMItem {
    return {
      itemNumber: item.BillOfMaterialItemNumber ?? item.BOMItemNumber ?? "",
      description: item.BillOfMaterialItemDescription ?? "",
      quantity: Number(item.BillOfMaterialItemQuantity ?? 1),
      unit: item.BillOfMaterialItemUnit ?? "pcs",
      materialId: item.BillOfMaterialComponent ?? "",
    };
  }

  /** Convert a Date to OData v4 date literal (YYYY-MM-DD) */
  private toODataDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /** Parse a SAP date string (ISO or /Date(ms)/ OData v2 legacy) */
  private parseDate(value: string): Date {
    if (value.startsWith("/Date(")) {
      const ms = Number(value.replace(/\/Date\((\d+)\)\//, "$1"));
      return new Date(ms);
    }
    return new Date(value);
  }
}

// ─── SAP BOM item internal shape ─────────────────────────────────────────────

interface SAPBOMItem {
  BillOfMaterialItemNumber?: string;
  BOMItemNumber?: string;
  BillOfMaterialComponent?: string;
  BillOfMaterialItemDescription?: string;
  BillOfMaterialItemQuantity?: string | number;
  BillOfMaterialItemUnit?: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
