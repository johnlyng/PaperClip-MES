import { OEECalculator } from "../OEECalculator.js";

const TOLERANCE = 0.0001;

describe("OEECalculator — OEE formula correctness (AC-OEE-01)", () => {
  // Reference case from acceptance criteria:
  // Availability = 0.85 (480 min planned, 72 min downtime → 408 min run)
  // Performance  = 0.90
  // Quality      = 0.95
  // Expected OEE = 0.85 × 0.90 × 0.95 = 0.72675 (rounds to 0.7268)
  it("computes reference OEE = 0.7268 within tolerance", () => {
    const result = OEECalculator.compute({
      availability: 0.85,
      performance: 0.90,
      quality: 0.95,
    });
    expect(Math.abs(result.oee - 0.7268)).toBeLessThan(TOLERANCE);
  });

  // Five parameterized cases spanning 0–100%
  const cases: Array<{ availability: number; performance: number; quality: number }> = [
    { availability: 1.0, performance: 1.0, quality: 1.0 },   // perfect
    { availability: 0.0, performance: 1.0, quality: 1.0 },   // zero availability
    { availability: 1.0, performance: 0.0, quality: 1.0 },   // zero performance
    { availability: 1.0, performance: 1.0, quality: 0.0 },   // zero quality
    { availability: 0.5, performance: 0.5, quality: 0.5 },   // all half
  ];

  it.each(cases)(
    "OEE($availability × $performance × $quality) = product",
    ({ availability, performance, quality }) => {
      const result = OEECalculator.compute({ availability, performance, quality });
      const expected = availability * performance * quality;
      expect(Math.abs(result.oee - expected)).toBeLessThan(TOLERANCE);
    }
  );
});

describe("OEECalculator — computeFromRaw()", () => {
  it("derives components from planned time, downtime, cycle time, and output counts", () => {
    // 480 min planned, 72 min downtime → 408 min run time
    // Availability = 408/480 = 0.85
    // idealCycleTime = 0.816 min/unit, 500 units → performance = 0.816*500/408 = 1.0 (capped by test expectation)
    // goodOutput = 475, totalOutput = 500 → quality = 0.95
    const result = OEECalculator.computeFromRaw({
      plannedProductionTimeMin: 480,
      downtimeMin: 72,
      idealCycleTimeMin: 0.816,
      totalOutput: 500,
      goodOutput: 475,
    });
    expect(Math.abs(result.availability - 0.85)).toBeLessThan(TOLERANCE);
    expect(Math.abs(result.quality - 0.95)).toBeLessThan(TOLERANCE);
    expect(result.oee).toBeGreaterThan(0);
  });

  it("returns zero OEE when plannedProductionTime is zero", () => {
    const result = OEECalculator.computeFromRaw({
      plannedProductionTimeMin: 0,
      downtimeMin: 0,
      idealCycleTimeMin: 1,
      totalOutput: 100,
      goodOutput: 90,
    });
    expect(result.oee).toBe(0);
  });

  it("returns zero quality OEE when there is no output", () => {
    const result = OEECalculator.computeFromRaw({
      plannedProductionTimeMin: 480,
      downtimeMin: 0,
      idealCycleTimeMin: 1,
      totalOutput: 0,
      goodOutput: 0,
    });
    expect(result.quality).toBe(0);
    expect(result.oee).toBe(0);
  });
});
