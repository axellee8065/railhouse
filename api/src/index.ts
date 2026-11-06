import { createApp } from "./app.js";
import { config } from "./config.js";
import { demoCredentials, seedDemoData } from "./seed.js";
import { startDepositWatcher } from "./services/sui/watcher.js";

seedDemoData();
const app = createApp();

app.listen(config.port, config.host, () => {
  const creds = demoCredentials();
  console.log(`[casino-rail-api] sandbox listening on http://${config.host}:${config.port}`);
  console.log(`[casino-rail-api] health: http://127.0.0.1:${config.port}/health`);
  console.log(`[casino-rail-api] base:   http://127.0.0.1:${config.port}/v1`);
  console.log(
    `[casino-rail-api] demo client_id=${creds.client_id} player=${creds.player_id} balance=${creds.default_balance_minor}`,
  );
  console.log(
    `[casino-rail-api] chain=${creds.chain} asset=${creds.asset} receive=${config.sui.receiveAddress}`,
  );
  console.log(
    `[casino-rail-api] deposits: GraphQL watcher (no withdrawal signing / no private keys)`,
  );
  startDepositWatcher();
});
