/**
 * In-memory resource assignment store — shared between resource-assignment routes.
 * Replace with Drizzle + PostgreSQL (resource_assignments table) when DB integration lands.
 */

export type ResourceType = "machine" | "operator" | "tool" | "material";

export interface ResourceAssignment {
  id: string;
  workOrderId: string;
  resourceType: ResourceType;
  resourceId: string;
  quantity: number;
  unit: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const resourceAssignmentStore: ResourceAssignment[] = [];
