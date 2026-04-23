/**
 * Structured logger factory — thin wrapper around pino.
 * All collector modules get a child logger with their component name.
 */

import pino from "pino";

const root = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogger(component: string) {
  return root.child({ component });
}
