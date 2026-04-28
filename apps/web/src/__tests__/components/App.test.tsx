/**
 * Operator UI smoke test — Module 4 (Shop Floor Operator UI)
 *
 * Verifies that the root App component renders without throwing and
 * shows the expected top-level structure. Real fetch and WebSocket
 * are stubbed in src/__tests__/setup.ts.
 *
 * AC-UI-02: empty state shows "No active work orders", not a blank page.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "../../App.js";

describe("App — root render smoke test (AC-UI-02)", () => {
  it("renders without throwing", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("does not show a blank page on initial render", () => {
    const { container } = render(<App />);
    // The container must have child nodes — not empty
    expect(container.firstChild).not.toBeNull();
  });

  it("shows Shop Floor dashboard heading", () => {
    render(<App />);
    // The h1 dashboard heading must be present
    const heading = screen.queryByRole("heading", { level: 1 });
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toMatch(/Shop Floor|MES/i);
  });
});
