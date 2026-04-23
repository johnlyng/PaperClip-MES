/**
 * authFixture.ts — Playwright test fixture for authenticated sessions.
 *
 * Provides a JWT-authenticated page context for operator and supervisor roles.
 * Obtain a JWT by calling POST /api/v1/auth/login and storing the token.
 */
import { test as base, type Page } from "@playwright/test";

interface AuthFixtures {
  /** Page logged in as an operator (role: operator) */
  operatorPage: Page;
  /** Page logged in as a supervisor (role: supervisor) */
  supervisorPage: Page;
}

const API_BASE = process.env["API_BASE_URL"] ?? "http://localhost:3000";

async function loginAndSetToken(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  const response = await page.request.post(`${API_BASE}/api/v1/auth/login`, {
    data: { username, password },
  });
  const { token } = (await response.json()) as { token: string };

  // Store the JWT in localStorage so the app picks it up on navigation
  await page.addInitScript((jwt: string) => {
    localStorage.setItem("mes:token", jwt);
  }, token);
}

export const test = base.extend<AuthFixtures>({
  operatorPage: async ({ page }, use) => {
    await loginAndSetToken(
      page,
      process.env["OPERATOR_USERNAME"] ?? "jsmith",
      process.env["OPERATOR_PASSWORD"] ?? "dev-password"
    );
    await use(page);
  },

  supervisorPage: async ({ page }, use) => {
    await loginAndSetToken(
      page,
      process.env["SUPERVISOR_USERNAME"] ?? "mjones",
      process.env["SUPERVISOR_PASSWORD"] ?? "dev-password"
    );
    await use(page);
  },
});

export { expect } from "@playwright/test";
