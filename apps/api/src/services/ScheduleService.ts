/**
 * ScheduleService — production_schedules CRUD with machine overlap validation.
 *
 * Key design decisions:
 *  - intervalsOverlap is a pure exported function so unit tests can verify
 *    the overlap algorithm without any database dependency.
 *  - Overlap check excludes 'cancelled' schedules: a cancelled slot does not
 *    block the machine. All other statuses (draft, confirmed, active, completed)
 *    are treated as blocking.
 *  - IScheduleService interface enables injecting a mock in route tests.
 *
 * GST-108
 */

import { and, eq, lt, gt, ne, gte, type SQL } from "drizzle-orm";
import type { Db, ProductionScheduleRow } from "@mes/db";
import { productionSchedules } from "@mes/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScheduleStatus =
  | "draft"
  | "confirmed"
  | "active"
  | "completed"
  | "cancelled";

export interface ScheduleConflict {
  id: string;
  workOrderId: string;
  machineId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
}

export interface ScheduleListFilters {
  workOrderId?: string;
  machineId?: string;
  status?: string;
  /** Filter: scheduledStart >= from */
  from?: Date;
  /** Filter: scheduledStart < to */
  to?: Date;
}

export interface ScheduleCreateData {
  workOrderId: string;
  machineId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  lineId?: string | null;
  sequenceNumber?: number;
  shiftId?: string | null;
  operatorId?: string | null;
  status?: ScheduleStatus;
  notes?: string | null;
}

export interface ScheduleUpdateData {
  machineId?: string;
  lineId?: string | null;
  sequenceNumber?: number;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  shiftId?: string | null;
  operatorId?: string | null;
  status?: ScheduleStatus;
  notes?: string | null;
}

export interface IScheduleService {
  checkMachineOverlap(
    machineId: string,
    scheduledStart: Date,
    scheduledEnd: Date,
    excludeId?: string
  ): Promise<ScheduleConflict | null>;
  list(filters: ScheduleListFilters): Promise<ProductionScheduleRow[]>;
  getById(id: string): Promise<ProductionScheduleRow | undefined>;
  create(data: ScheduleCreateData): Promise<ProductionScheduleRow>;
  update(id: string, data: ScheduleUpdateData): Promise<ProductionScheduleRow | undefined>;
  delete(id: string): Promise<boolean>;
}

// ─── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Returns true if two half-open intervals [aStart, aEnd) and [bStart, bEnd)
 * overlap. Exported for direct unit testing without a database dependency.
 *
 * Standard interval overlap condition:
 *   aStart < bEnd AND aEnd > bStart
 */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ScheduleService implements IScheduleService {
  constructor(private readonly db: Db) {}

  /**
   * Returns the first conflicting schedule on the same machine in the same
   * time window, or null if no conflict exists.
   *
   * Cancelled schedules are excluded from conflict checks — they no longer
   * hold a machine reservation.
   */
  async checkMachineOverlap(
    machineId: string,
    scheduledStart: Date,
    scheduledEnd: Date,
    excludeId?: string
  ): Promise<ScheduleConflict | null> {
    const conditions: SQL[] = [
      eq(productionSchedules.machineId, machineId),
      lt(productionSchedules.scheduledStart, scheduledEnd),
      gt(productionSchedules.scheduledEnd, scheduledStart),
      ne(productionSchedules.status, "cancelled" as ScheduleStatus),
    ];
    if (excludeId) {
      conditions.push(ne(productionSchedules.id, excludeId));
    }

    const rows = await this.db
      .select({
        id: productionSchedules.id,
        workOrderId: productionSchedules.workOrderId,
        machineId: productionSchedules.machineId,
        scheduledStart: productionSchedules.scheduledStart,
        scheduledEnd: productionSchedules.scheduledEnd,
      })
      .from(productionSchedules)
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      workOrderId: row.workOrderId,
      machineId: row.machineId,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
    };
  }

  async list(filters: ScheduleListFilters): Promise<ProductionScheduleRow[]> {
    const conditions: SQL[] = [];

    if (filters.workOrderId) {
      conditions.push(eq(productionSchedules.workOrderId, filters.workOrderId));
    }
    if (filters.machineId) {
      conditions.push(eq(productionSchedules.machineId, filters.machineId));
    }
    if (filters.status) {
      conditions.push(
        eq(productionSchedules.status, filters.status as ScheduleStatus)
      );
    }
    if (filters.from) {
      conditions.push(gte(productionSchedules.scheduledStart, filters.from));
    }
    if (filters.to) {
      conditions.push(lt(productionSchedules.scheduledStart, filters.to));
    }

    return this.db
      .select()
      .from(productionSchedules)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  async getById(id: string): Promise<ProductionScheduleRow | undefined> {
    const rows = await this.db
      .select()
      .from(productionSchedules)
      .where(eq(productionSchedules.id, id))
      .limit(1);
    return rows[0];
  }

  async create(data: ScheduleCreateData): Promise<ProductionScheduleRow> {
    const rows = await this.db
      .insert(productionSchedules)
      .values(data)
      .returning();
    return rows[0];
  }

  async update(
    id: string,
    data: ScheduleUpdateData
  ): Promise<ProductionScheduleRow | undefined> {
    const rows = await this.db
      .update(productionSchedules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productionSchedules.id, id))
      .returning();
    return rows[0];
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(productionSchedules)
      .where(eq(productionSchedules.id, id))
      .returning({ id: productionSchedules.id });
    return rows.length > 0;
  }
}
