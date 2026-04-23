/**
 * OEECalculator — Pure OEE formula implementation.
 *
 * OEE = Availability × Performance × Quality
 *
 * Definitions (process-manufacturing):
 *   Availability = Run Time / Planned Production Time
 *   Performance  = (Ideal Cycle Time × Actual Output) / Run Time
 *                = Actual Output / (Run Time / Ideal Cycle Time)
 *   Quality      = Good Output / Total Output
 *                  (for process mfg: (actualQuantity - wasteQuantity) / scheduledQuantity)
 *
 * All inputs are expected in [0, 1] range for Availability/Performance/Quality.
 * The calculator also accepts raw values for convenience — see computeFromRaw.
 */

export interface OEEComponents {
  availability: number;
  performance: number;
  quality: number;
}

export interface OEERawInputs {
  /** Total planned production time in minutes */
  plannedProductionTimeMin: number;
  /** Total downtime in minutes */
  downtimeMin: number;
  /** Ideal cycle time in minutes per unit */
  idealCycleTimeMin: number;
  /** Total actual output (good + waste) */
  totalOutput: number;
  /** Good output (total - waste) */
  goodOutput: number;
}

export interface OEEResult extends OEEComponents {
  oee: number;
}

export class OEECalculator {
  /**
   * Compute OEE from normalized [0,1] component inputs.
   * Returns components and overall OEE rounded to 4 decimal places.
   */
  static compute(components: OEEComponents): OEEResult {
    const { availability, performance, quality } = components;
    const oee = Math.round(availability * performance * quality * 10000) / 10000;
    return { availability, performance, quality, oee };
  }

  /**
   * Compute OEE from raw production inputs.
   * Availability is derived from planned time and downtime.
   * Performance is derived from ideal cycle time and actual output.
   * Quality is derived from good vs total output.
   */
  static computeFromRaw(inputs: OEERawInputs): OEEResult {
    const runTime = inputs.plannedProductionTimeMin - inputs.downtimeMin;
    const availability =
      inputs.plannedProductionTimeMin > 0
        ? runTime / inputs.plannedProductionTimeMin
        : 0;

    const performance =
      runTime > 0 && inputs.idealCycleTimeMin > 0
        ? (inputs.idealCycleTimeMin * inputs.totalOutput) / runTime
        : 0;

    const quality =
      inputs.totalOutput > 0 ? inputs.goodOutput / inputs.totalOutput : 0;

    return OEECalculator.compute({ availability, performance, quality });
  }
}
