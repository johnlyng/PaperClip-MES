import type { WorkOrderStatus } from "@mes/types";

/**
 * WorkOrderStateMachine — Pure state machine for work order lifecycle.
 *
 * No I/O, no side effects. Validates transitions and computes the next state.
 * Consumed by the WorkOrderService in apps/api.
 *
 * State diagram:
 *
 *   draft → released → in_progress → completed
 *                   ↘           ↗
 *                    paused ←──
 *   any state → cancelled (by supervisor/admin only)
 */

export type WorkOrderEvent =
  | "release"
  | "start"
  | "pause"
  | "resume"
  | "complete"
  | "cancel";

const TRANSITIONS: Record<WorkOrderStatus, Partial<Record<WorkOrderEvent, WorkOrderStatus>>> = {
  draft: {
    release: "released",
    cancel: "cancelled",
  },
  released: {
    start: "in_progress",
    cancel: "cancelled",
  },
  in_progress: {
    pause: "paused",
    complete: "completed",
    cancel: "cancelled",
  },
  paused: {
    resume: "in_progress",
    cancel: "cancelled",
  },
  completed: {},
  cancelled: {},
};

export class WorkOrderStateMachine {
  /**
   * Returns the next status for the given event, or null if the transition
   * is not permitted from the current status.
   */
  static transition(
    currentStatus: WorkOrderStatus,
    event: WorkOrderEvent
  ): WorkOrderStatus | null {
    return TRANSITIONS[currentStatus][event] ?? null;
  }

  /**
   * Returns all valid events from the current status.
   */
  static validEvents(currentStatus: WorkOrderStatus): WorkOrderEvent[] {
    return Object.keys(TRANSITIONS[currentStatus]) as WorkOrderEvent[];
  }

  /**
   * Throws if the transition is not permitted. Returns the new status.
   */
  static apply(currentStatus: WorkOrderStatus, event: WorkOrderEvent): WorkOrderStatus {
    const next = WorkOrderStateMachine.transition(currentStatus, event);
    if (!next) {
      throw new Error(
        `Invalid work order transition: ${currentStatus} → ${event}`
      );
    }
    return next;
  }
}
