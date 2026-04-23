/**
 * @mes/db schema barrel — re-exports all table definitions for use with
 * drizzle-kit and the db client in apps/api.
 *
 * Import pattern:
 *   import { workOrders, workOrderStatusEnum } from "@mes/db/schema";
 *   import { productionSchedules } from "@mes/db/schema";
 *   import { resourceAssignments } from "@mes/db/schema";
 */

export {
  workOrders,
  workOrderStatusEnum,
  type WorkOrderRow,
  type NewWorkOrderRow,
} from "./work-orders.js";

export {
  productionSchedules,
  productionScheduleStatusEnum,
  type ProductionScheduleRow,
  type NewProductionScheduleRow,
} from "./production-schedules.js";

export {
  resourceAssignments,
  resourceTypeEnum,
  type ResourceAssignmentRow,
  type NewResourceAssignmentRow,
} from "./resource-assignments.js";
