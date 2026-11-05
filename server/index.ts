/**
 * Railhouse combined preview server.
 * Serves Vite production build + Casino Rail sandbox API under /v1 (same origin).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../api/src/app.js";
import { config } from "../api/src/config.js";
import { demoCredentials, seedDemoData } from "../api/src/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const staticDir = path.join(root, "web", "dist");

seedDemoData();

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp({ staticDir });

app.listen(port, host, () => {
  const creds = demoCredentials();
  console.log(`[railhouse] listening on http://${host}:${port}`);
  console.log(`[railhouse] health: http://${host}:${port}/health`);
  console.log(`[railhouse] api:    http://${host}:${port}/v1`);
  console.log(
    `[railhouse] DEMO — not Stake. Sandbox client_id=${creds.client_id} player=${creds.player_id}`,
  );
  console.log(
    `[railhouse] chain=${creds.chain} asset=${creds.asset} (deposit stub; no live signing / no private keys)`,
  );
  console.log(`[railhouse] static: ${staticDir}`);
  // Avoid logging JWT secret or client_secret values.
  void config.jwtSecret;
});
