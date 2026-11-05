import { config } from "../config.js";
import { demoCredentials, seedDemoData } from "../seed.js";
import { balanceView, getOrCreateAccount } from "../services/ledger.js";

seedDemoData();
const creds = demoCredentials();
const acc = getOrCreateAccount(creds.operator_id, creds.player_id, config.currency);

console.log(JSON.stringify({
  ...creds,
  balance: balanceView(acc),
  second_operator: {
    operator_id: "op_demo_02",
    client_id: "studio_demo_02",
    client_secret: "sk_sandbox_demo_secret_b",
    note: "Same player_id has segregated balance under op_demo_02",
  },
}, null, 2));
