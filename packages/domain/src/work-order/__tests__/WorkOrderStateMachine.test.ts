import { WorkOrderStateMachine } from "../WorkOrderStateMachine.js";
import type { WorkOrderStatus } from "@mes/types";

describe("WorkOrderStateMachine — happy path (AC-WO-02)", () => {
  // Smoke: full process-manufacturing lifecycle
  it("transitions draft → released → in_progress → completed", () => {
    let status: WorkOrderStatus = "draft";

    status = WorkOrderStateMachine.apply(status, "release");
    expect(status).toBe("released");

    status = WorkOrderStateMachine.apply(status, "start");
    expect(status).toBe("in_progress");

    status = WorkOrderStateMachine.apply(status, "complete");
    expect(status).toBe("completed");
  });

  it("supports pause/resume cycle during in_progress", () => {
    let status: WorkOrderStatus = "in_progress";

    status = WorkOrderStateMachine.apply(status, "pause");
    expect(status).toBe("paused");

    status = WorkOrderStateMachine.apply(status, "resume");
    expect(status).toBe("in_progress");
  });

  it("allows cancel from draft", () => {
    const next = WorkOrderStateMachine.apply("draft", "cancel");
    expect(next).toBe("cancelled");
  });

  it("allows cancel from released", () => {
    const next = WorkOrderStateMachine.apply("released", "cancel");
    expect(next).toBe("cancelled");
  });

  it("allows cancel from in_progress (supervisor)", () => {
    const next = WorkOrderStateMachine.apply("in_progress", "cancel");
    expect(next).toBe("cancelled");
  });
});

describe("WorkOrderStateMachine — invalid transitions (AC-WO-02)", () => {
  it("throws on completed → start (no restart from terminal state)", () => {
    expect(() =>
      WorkOrderStateMachine.apply("completed", "start")
    ).toThrow("Invalid work order transition");
  });

  it("throws on cancelled → release (no recovery from cancelled)", () => {
    expect(() =>
      WorkOrderStateMachine.apply("cancelled", "release")
    ).toThrow("Invalid work order transition");
  });

  it("throws on draft → complete (cannot skip states)", () => {
    expect(() =>
      WorkOrderStateMachine.apply("draft", "complete")
    ).toThrow("Invalid work order transition");
  });

  it("returns null from transition() for invalid moves without throwing", () => {
    const result = WorkOrderStateMachine.transition("completed", "start");
    expect(result).toBeNull();
  });
});

describe("WorkOrderStateMachine — validEvents()", () => {
  it("returns release and cancel from draft", () => {
    const events = WorkOrderStateMachine.validEvents("draft");
    expect(events).toContain("release");
    expect(events).toContain("cancel");
    expect(events).toHaveLength(2);
  });

  it("returns no events from completed (terminal state)", () => {
    const events = WorkOrderStateMachine.validEvents("completed");
    expect(events).toHaveLength(0);
  });

  it("returns no events from cancelled (terminal state)", () => {
    const events = WorkOrderStateMachine.validEvents("cancelled");
    expect(events).toHaveLength(0);
  });
});
