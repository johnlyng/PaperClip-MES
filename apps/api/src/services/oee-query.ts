/**
 * oee-query.ts — OEE query service.
 *
 * Queries the TimescaleDB Continuous Aggregate views (oee_1min, oee_1hour,
 * oee_1day) and computes OEE components using the OEECalculator.
 *
 * Granularity → view mapping:
 *   "1m"  → oee_1min
 *   "1h"  → oee_1hour
 *   "1d"  → oee_1day
 *
 * OEE computation:
 *   Availability = avg_status (fraction of interval machine was running)
 *   Performance  = min(1, output_count / (interval_min * idealRatePerMin))
 *                  Falls back to avg_status if no ideal rate configured.
 *   Quality      = good_count / output_count  (1.0 if no output recorded)
 *   OEE          = Availability × Performance × Quality
 *
 * Shift queries:
 *   shift = "morning" | "afternoon" | "night"
 *   Maps to configurable UTC hour ranges (default: 6–14 / 14–22 / 22–6).
 */

import { sql } from "drizzle-orm";
import type { Db } from "@mes/db";
import { OEECalculator } from "@mes/domain";
import type { OEESnapshot } from "@mes/types";

export type Granularity = "1m" | "1h" | "1d";
export type Shift = "morning" | "afternoon" | "night";

export interface OEEQueryParams {
  machineId: string;
  from: Date;
  to: Date;
  granularity: Granularity;
  /** Ideal output units per minute (machine-specific).
   *  When omitted, Performance is set to Availability (worst-case assumption). */
  idealRatePerMin?: number;
}

/** Row shape returned from the continuous aggregate views */
interface AggRow extends Record<string, unknown> {
  bucket: Date;
  machine_id: string;
  avg_status: number | null;
  output_count: number | null;
  good_count: number | null;
}

const GRANULARITY_VIEW: Record<Granularity, string> = {
  "1m": "oee_1min",
  "1h": "oee_1hour",
  "1d": "oee_1day",
};

/** Interval in minutes per granularity bucket */
const GRANULARITY_MINUTES: Record<Granularity, number> = {
  "1m": 1,
  "1h": 60,
  "1d": 1440,
};

export class OEEQueryService {
  constructor(private readonly db: Db) {}

  /**
   * Returns OEE snapshots for the given machine and time range.
   * One snapshot per time bucket at the requested granularity.
   */
  async queryOEE(params: OEEQueryParams): Promise<OEESnapshot[]> {
    const view = GRANULARITY_VIEW[params.granularity];
    const intervalMin = GRANULARITY_MINUTES[params.granularity];

    // Raw SQL: TimescaleDB materialized views are not in Drizzle schema
    const rows = await this.db.execute<AggRow>(sql`
      SELECT
        bucket,
        machine_id,
        avg_status,
        output_count,
        good_count
      FROM ${sql.raw(view)}
      WHERE machine_id = ${params.machineId}::uuid
        AND bucket >= ${params.from.toISOString()}::timestamptz
        AND bucket <  ${params.to.toISOString()}::timestamptz
      ORDER BY bucket ASC
    `);

    return (rows as AggRow[]).map((row) => {
      const avgStatus = row.avg_status ?? 0;
      const outputCount = row.output_count ?? 0;
      const goodCount = row.good_count ?? 0;

      const availability = Math.min(1, Math.max(0, avgStatus));

      let performance: number;
      if (params.idealRatePerMin && params.idealRatePerMin > 0 && outputCount > 0) {
        const idealOutput = intervalMin * params.idealRatePerMin;
        performance = Math.min(1, outputCount / idealOutput);
      } else if (outputCount > 0 && params.idealRatePerMin === undefined) {
        // No ideal rate configured: assume performance = availability
        performance = availability;
      } else {
        performance = availability;
      }

      const quality = outputCount > 0 ? Math.min(1, goodCount / outputCount) : 1;

      const result = OEECalculator.compute({ availability, performance, quality });

      const bucketDate = new Date(row.bucket);
      const windowEnd = new Date(bucketDate.getTime() + intervalMin * 60_000);

      return {
        machineId: params.machineId,
        from: bucketDate,
        to: windowEnd,
        granularity: params.granularity,
        availability: result.availability,
        performance: result.performance,
        quality: result.quality,
        oee: result.oee,
        plannedProductionTime: intervalMin * 60,
        actualProductionTime: Math.round(intervalMin * 60 * availability),
        goodCount,
        totalCount: outputCount,
      } satisfies OEESnapshot;
    });
  }

  /**
   * Returns OEE for a single machine aggregated over the entire time window.
   * Useful for a "current shift OEE" summary card.
   */
  async queryOEESummary(
    machineId: string,
    from: Date,
    to: Date,
    idealRatePerMin?: number
  ): Promise<OEESnapshot | null> {
    // Use the 1-hour view for summaries — good balance of freshness and accuracy
    const rows = await this.db.execute<{
      avg_status: number | null;
      total_output: number | null;
      total_good: number | null;
      bucket_count: number;
    }>(sql`
      SELECT
        AVG(avg_status)       AS avg_status,
        SUM(output_count)     AS total_output,
        SUM(good_count)       AS total_good,
        COUNT(*)              AS bucket_count
      FROM oee_1hour
      WHERE machine_id = ${machineId}::uuid
        AND bucket >= ${from.toISOString()}::timestamptz
        AND bucket <  ${to.toISOString()}::timestamptz
    `);

    const row = rows[0];
    if (!row || row.bucket_count === 0) return null;

    const availability = Math.min(1, Math.max(0, row.avg_status ?? 0));
    const outputCount = row.total_output ?? 0;
    const goodCount = row.total_good ?? 0;
    const windowMin = (to.getTime() - from.getTime()) / 60_000;

    let performance = availability;
    if (idealRatePerMin && idealRatePerMin > 0 && outputCount > 0) {
      performance = Math.min(1, outputCount / (windowMin * idealRatePerMin));
    }
    const quality = outputCount > 0 ? Math.min(1, goodCount / outputCount) : 1;

    const result = OEECalculator.compute({ availability, performance, quality });

    return {
      machineId,
      from,
      to,
      granularity: "1h",
      availability: result.availability,
      performance: result.performance,
      quality: result.quality,
      oee: result.oee,
      plannedProductionTime: Math.round(windowMin * 60),
      actualProductionTime: Math.round(windowMin * 60 * availability),
      goodCount,
      totalCount: outputCount,
    };
  }
}
