import type {
  WorkOrder,
  BOMItem,
  ProductionResult,
  ERPHealthStatus,
} from "@mes/types";

/**
 * IERPAdapter — ERP integration contract.
 *
 * ADR-001 Decision 6: Adapter Pattern behind this interface so the MES core
 * is ERP-agnostic from Day 1. The target ERP (SAP, Oracle, Epicor, etc.) is
 * TBD pending board decision. MockERPAdapter ships immediately and returns
 * fixture data so the team builds against the interface without blocking on
 * the ERP selection.
 *
 * When the board decides on a target ERP, a single concrete adapter file
 * implements this interface and is wired in via the ERP_ADAPTER env var.
 */
export interface IERPAdapter {
  /**
   * Fetch work orders from the ERP that fall within the given date range.
   * The MES calls this on startup and periodically to sync released orders.
   */
  getWorkOrdersByDate(from: Date, to: Date): Promise<WorkOrder[]>;

  /**
   * Push the actual production result for a completed work order back to
   * the ERP. Called when a work order transitions to `completed` in the MES.
   */
  pushProductionResult(result: ProductionResult): Promise<void>;

  /**
   * Retrieve the bill of materials for a given BOM ID.
   * Used by the scheduling engine to confirm material availability.
   */
  getMaterialList(bomId: string): Promise<BOMItem[]>;

  /**
   * Lightweight connectivity check for health endpoints and alerting.
   * Must resolve in under 5 seconds or reject with a timeout error.
   */
  healthCheck(): Promise<ERPHealthStatus>;
}

export type ERPAdapterType = "mock" | "sap" | "epicor" | "oracle";
