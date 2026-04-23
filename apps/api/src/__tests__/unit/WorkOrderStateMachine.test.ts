/**
 * API layer smoke test — Module 1 (Work Orders)
 *
 * Verifies that the WorkOrderStateMachine imported through the @mes/domain
 * package resolves correctly in the API app context and the happy path
 * transition works. The full state machine spec lives in packages/domain.
 */
import { WorkOrderStateMachine } from "@mes/domain";

describe("API smoke — WorkOrderStateMachine happy path (AC-WO-02)", () => {
  it("transitions released → in_progress → completed", () => {
    const next1 = WorkOrderStateMachine.apply("released", "start");
    expect(next1).toBe("in_progress");

    const next2 = WorkOrderStateMachine.apply("in_progress", "complete");
    expect(next2).toBe("completed");
  });

  it("throws on invalid transition with an informative error", () => {
    expect(() =>
      WorkOrderStateMachine.apply("completed", "start")
    ).toThrow(/invalid work order transition/i);
  });
});
