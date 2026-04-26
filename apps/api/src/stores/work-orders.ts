import type { WorkOrder } from "@mes/types";
import { WORK_ORDERS } from "@mes/test-fixtures";

/**
 * In-memory work order store — shared between work-orders routes and ERP routes.
 * Replace with Drizzle + PostgreSQL when GST-25 lands.
 */
export const workOrderStore: WorkOrder[] = [...WORK_ORDERS];
