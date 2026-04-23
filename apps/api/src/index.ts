import { buildApp } from "./app.js";

const PORT = Number(process.env.API_PORT ?? 3000);
const HOST = process.env.API_HOST ?? "0.0.0.0";

const app = buildApp();

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`MES API running on http://${HOST}:${PORT}`);
  app.log.info(`OpenAPI docs: http://${HOST}:${PORT}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
