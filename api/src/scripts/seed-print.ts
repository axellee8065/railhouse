import { config } from "../config.js";
import { demoCredentials, seedDemoData } from "../seed.js";
import { balanceView, getOrCreateAccount } from "../services/ledger.js";

seedDemoData();
const creds = demoCredentials();
const acc = getOrCreateAccount(creds.operator_id, creds.player_id, config.currency);
const a = getOrCreateAccount(
  config.tenants.A.operatorId,
  config.tenants.A.playerId,
  config.currency,
);
const b = getOrCreateAccount(
  config.tenants.B.operatorId,
  config.tenants.B.playerId,
  config.currency,
);

console.log(
  JSON.stringify(
    {
      ...creds,
      balance: balanceView(acc),
      tenants: {
        A: {
          operator_id: config.tenants.A.operatorId,
          client_id: config.tenants.A.clientId,
          client_secret: config.tenants.A.clientSecret,
          player_id: config.tenants.A.playerId,
          balance: balanceView(a),
        },
        B: {
          operator_id: config.tenants.B.operatorId,
          client_id: config.tenants.B.clientId,
          client_secret: config.tenants.B.clientSecret,
          player_id: config.tenants.B.playerId,
          balance: balanceView(b),
        },
      },
      note: "op_demo_A / op_demo_B ledgers are segregated by operator_id; see npm run tenant-isolation-demo",
    },
    null,
    2,
  ),
);
