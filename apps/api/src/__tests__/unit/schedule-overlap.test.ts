/**
 * Unit tests for the pure intervalsOverlap helper in ScheduleService.
 *
 * These tests run with zero database dependency — they verify the overlap
 * algorithm used by ScheduleService.checkMachineOverlap before any SQL query.
 *
 * Coverage:
 *   1.  Adjacent slots (A ends exactly when B starts) — no overlap
 *   2.  Identical windows — overlap
 *   3.  A fully contains B — overlap
 *   4.  B fully contains A — overlap
 *   5.  A overlaps B at start (A starts before B, ends inside B) — overlap
 *   6.  A overlaps B at end (A starts inside B, ends after B) — overlap
 *   7.  A ends before B starts (gap between) — no overlap
 *   8.  B ends before A starts (gap between) — no overlap
 *   9.  Single-millisecond boundary touch — no overlap
 *   10. A ends one ms after B starts — overlap
 *
 * GST-108
 */

import { intervalsOverlap } from "../../services/ScheduleService.js";

const d = (iso: string) => new Date(iso);

describe("intervalsOverlap (GST-108)", () => {
  // Case 1: Adjacent — A ends exactly when B starts → no overlap
  it("returns false when A ends exactly when B starts (adjacent, half-open)", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T10:00:00Z"),
        d("2025-01-01T10:00:00Z"),
        d("2025-01-01T12:00:00Z")
      )
    ).toBe(false);
  });

  // Case 2: Identical windows → overlap
  it("returns true for identical windows", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T10:00:00Z"),
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T10:00:00Z")
      )
    ).toBe(true);
  });

  // Case 3: A fully contains B → overlap
  it("returns true when A fully contains B", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T06:00:00Z"),
        d("2025-01-01T14:00:00Z"),
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T10:00:00Z")
      )
    ).toBe(true);
  });

  // Case 4: B fully contains A → overlap
  it("returns true when B fully contains A", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T10:00:00Z"),
        d("2025-01-01T06:00:00Z"),
        d("2025-01-01T14:00:00Z")
      )
    ).toBe(true);
  });

  // Case 5: A overlaps B at start (A starts before B, ends inside B)
  it("returns true when A starts before B and ends inside B", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T07:00:00Z"),
        d("2025-01-01T09:00:00Z"),
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T12:00:00Z")
      )
    ).toBe(true);
  });

  // Case 6: A overlaps B at end (A starts inside B, ends after B)
  it("returns true when A starts inside B and ends after B", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T10:00:00Z"),
        d("2025-01-01T14:00:00Z"),
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T12:00:00Z")
      )
    ).toBe(true);
  });

  // Case 7: A ends before B starts (gap) → no overlap
  it("returns false when A ends before B starts", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T06:00:00Z"),
        d("2025-01-01T08:00:00Z"),
        d("2025-01-01T09:00:00Z"),
        d("2025-01-01T11:00:00Z")
      )
    ).toBe(false);
  });

  // Case 8: B ends before A starts (gap) → no overlap
  it("returns false when B ends before A starts", () => {
    expect(
      intervalsOverlap(
        d("2025-01-01T10:00:00Z"),
        d("2025-01-01T12:00:00Z"),
        d("2025-01-01T06:00:00Z"),
        d("2025-01-01T08:00:00Z")
      )
    ).toBe(false);
  });

  // Case 9: Single-millisecond boundary touch → no overlap (half-open)
  it("returns false when A ends 1ms before B starts", () => {
    const aEnd = d("2025-01-01T10:00:00.000Z");
    const bStart = new Date(aEnd.getTime() + 1); // 1ms later
    expect(
      intervalsOverlap(
        d("2025-01-01T08:00:00Z"),
        aEnd,
        bStart,
        d("2025-01-01T12:00:00Z")
      )
    ).toBe(false);
  });

  // Case 10: A ends 1ms after B starts → overlap
  it("returns true when A ends 1ms after B starts", () => {
    const bStart = d("2025-01-01T10:00:00.000Z");
    const aEnd = new Date(bStart.getTime() + 1); // 1ms after B starts
    expect(
      intervalsOverlap(
        d("2025-01-01T08:00:00Z"),
        aEnd,
        bStart,
        d("2025-01-01T12:00:00Z")
      )
    ).toBe(true);
  });
});
