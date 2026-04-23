/**
 * Vitest global test setup for apps/web.
 *
 * Sets up:
 * - fetch mock (prevents real network calls in unit tests)
 * - WebSocket stub (prevents real WS connections)
 * - @testing-library cleanup after each test
 */
import "@testing-library/jest-dom";

// Stub global fetch so App does not make real HTTP calls during unit tests
global.fetch = Object.assign(
  async (_input: RequestInfo | URL): Promise<Response> => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
  { preload: undefined }
) as typeof fetch;

// Stub WebSocket so the App reconnect logic does not attempt real WS connections
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly readyState = MockWebSocket.CLOSED;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  close() {}
  send(_data: string) {}
}

Object.defineProperty(globalThis, "WebSocket", {
  value: MockWebSocket,
  writable: true,
});
